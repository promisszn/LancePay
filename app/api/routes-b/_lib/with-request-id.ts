import { AsyncLocalStorage } from 'async_hooks'
import { randomBytes } from 'crypto'
import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'

type RequestContext = {
  requestId: string
}

type RouteHandler = (...args: any[]) => unknown | Promise<unknown>

const requestContext = new AsyncLocalStorage<RequestContext>()
const LOGGER_PATCHED = Symbol.for('routes-b.logger.request-id-patched')
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function generateUuidV7(): string {
  const bytes = randomBytes(16)
  const timestamp = Date.now()

  bytes[0] = Math.floor(timestamp / 0x10000000000) & 0xff
  bytes[1] = Math.floor(timestamp / 0x100000000) & 0xff
  bytes[2] = Math.floor(timestamp / 0x1000000) & 0xff
  bytes[3] = Math.floor(timestamp / 0x10000) & 0xff
  bytes[4] = Math.floor(timestamp / 0x100) & 0xff
  bytes[5] = timestamp & 0xff
  bytes[6] = (bytes[6] & 0x0f) | 0x70
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function isUuid(value: string | null): value is string {
  return Boolean(value && UUID_PATTERN.test(value))
}

function getRequestHeader(args: any[], name: string): string | null {
  const request = args[0]
  return typeof request?.headers?.get === 'function' ? request.headers.get(name) : null
}

function resolveRequestId(args: any[]) {
  const clientRequestId = getRequestHeader(args, 'x-request-id')
  return isUuid(clientRequestId) ? clientRequestId : generateUuidV7()
}

export function getRequestId(): string | null {
  return requestContext.getStore()?.requestId ?? null
}

function patchLogger() {
  const target = logger as any
  if (target[LOGGER_PATCHED]) return

  for (const method of ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const) {
    const original = target[method]
    if (typeof original !== 'function') continue
    if (original.mock || original._isMockFunction) continue

    target[method] = function requestIdLoggerMethod(this: unknown, ...args: any[]) {
      const requestId = getRequestId()
      if (requestId) {
        const first = args[0]
        if (first && typeof first === 'object' && !Array.isArray(first) && !(first instanceof Error)) {
          args[0] = { requestId, ...first }
        } else {
          args.unshift({ requestId })
        }
      }

      return original.apply(this, args)
    }
  }

  target[LOGGER_PATCHED] = true
}

function responseWithRequestId(response: unknown, requestId: string): Response {
  const routeResponse = response instanceof Response
    ? response
    : new Response(null, { status: 204 })

  routeResponse.headers.set('X-Request-Id', requestId)
  return routeResponse
}

patchLogger()

export function withRequestId<T extends RouteHandler>(handler: T): (...args: any[]) => Promise<Response> {
  return (async (...args: any[]) => {
    const requestId = resolveRequestId(args)

    try {
      const response = await requestContext.run({ requestId }, () => handler(...args))
      return responseWithRequestId(response, requestId)
    } catch (error) {
      logger.error({ err: error }, 'Routes B unhandled route error')
      return responseWithRequestId(
        NextResponse.json({ error: 'Internal server error' }, { status: 500 }),
        requestId,
      )
    }
  })
}
