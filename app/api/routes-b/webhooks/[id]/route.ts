import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { verifyAuthToken } from '@/lib/auth'
import { dispatchWebhookDelivery } from '../../_lib/webhook-delivery'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const authToken = request.headers.get('authorization')?.replace('Bearer ', '')
  const claims = await verifyAuthToken(authToken || '')
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({ where: { privyId: claims.userId } })
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const webhook = await prisma.userWebhook.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      targetUrl: true,
      description: true,
      createdAt: true,
    },
  })

  if (!webhook) {
    return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
  }

  if (webhook.userId !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return NextResponse.json({
    webhook: {
      id: webhook.id,
      targetUrl: webhook.targetUrl,
      description: webhook.description,
      isActive: webhook.isActive ?? true,
      subscribedEvents: webhook.subscribedEvents ?? [],
      createdAt: webhook.createdAt,
    },
  })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const authToken = request.headers.get('authorization')?.replace('Bearer ', '')
  const claims = await verifyAuthToken(authToken || '')
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({ where: { privyId: claims.userId } })
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const webhook = await prisma.userWebhook.findUnique({ where: { id } })
  if (!webhook) {
    return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
  }

  if (webhook.userId !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const updateData: {
    targetUrl?: string
    description?: string | null
    isActive?: boolean
    subscribedEvents?: string[]
  } = {}

  if (body.targetUrl !== undefined) {
    if (typeof body.targetUrl !== 'string') {
      return NextResponse.json({ error: 'targetUrl must be a string' }, { status: 400 })
    }
    updateData.targetUrl = body.targetUrl
  }

  if (body.description !== undefined) {
    if (body.description !== null && typeof body.description !== 'string') {
      return NextResponse.json({ error: 'description must be a string or null' }, { status: 400 })
    }
    updateData.description = body.description
  }

  if (body.isActive !== undefined) {
    if (typeof body.isActive !== 'boolean') {
      return NextResponse.json({ error: 'isActive must be a boolean' }, { status: 400 })
    }
    updateData.isActive = body.isActive
  }

  if (body.subscribedEvents !== undefined) {
    if (!Array.isArray(body.subscribedEvents) || body.subscribedEvents.some((value: unknown) => typeof value !== 'string')) {
      return NextResponse.json({ error: 'subscribedEvents must be an array of strings' }, { status: 400 })
    }
    updateData.subscribedEvents = body.subscribedEvents
  }

  const updatedWebhook = await prisma.userWebhook.update({
    where: { id },
    data: updateData,
    select: {
      id: true,
      targetUrl: true,
      description: true,
      isActive: true,
      subscribedEvents: true,
      createdAt: true,
    },
  })

  return NextResponse.json({ webhook: updatedWebhook })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const authToken = request.headers.get('authorization')?.replace('Bearer ', '')
  const claims = await verifyAuthToken(authToken || '')
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({ where: { privyId: claims.userId } })
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const webhook = await prisma.userWebhook.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      targetUrl: true,
      signingSecret: true,
      isActive: true,
    },
  })
  if (!webhook) {
    return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
  }
  if (webhook.userId !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!webhook.isActive) {
    return NextResponse.json({ error: 'Webhook is inactive' }, { status: 422 })
  }

  const body = await request.json()
  const eventType = typeof body?.eventType === 'string' && body.eventType.trim().length > 0
    ? body.eventType.trim()
    : 'webhook.event'
  const payload = body?.payload && typeof body.payload === 'object' ? body.payload : {}

  const outcome = await dispatchWebhookDelivery(webhook, eventType, payload as Record<string, unknown>)
  return NextResponse.json({ outcome })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const authToken = request.headers.get('authorization')?.replace('Bearer ', '')
  const claims = await verifyAuthToken(authToken || '')
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({ where: { privyId: claims.userId } })
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const webhook = await prisma.userWebhook.findUnique({ where: { id } })
  if (!webhook) {
    return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
  }

  if (webhook.userId !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await prisma.userWebhook.delete({ where: { id } })

  return new NextResponse(null, { status: 204 })
}
