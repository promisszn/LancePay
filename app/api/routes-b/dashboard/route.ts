import { withRequestId } from '../_lib/with-request-id'
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifyAuthToken } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { buildDashboardSummary } from '../_lib/aggregations'
import { normalizeCurrencyAmount } from '../_lib/amounts'

async function GETHandler(request: NextRequest) {
  const authToken = request.headers.get('authorization')?.replace('Bearer ', '')
  const claims = await verifyAuthToken(authToken || '')
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({ where: { privyId: claims.userId } })
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const now = new Date()
  const sparklineEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
  const sparklineStart = new Date(sparklineEnd)
  sparklineStart.setUTCDate(sparklineStart.getUTCDate() - 14)

  const [dashboard, sparklineRows] = await Promise.all([
    buildDashboardSummary(user.id, now),
    prisma.$queryRaw<Array<{ day: Date; amount: unknown }>>(Prisma.sql`
      SELECT DATE_TRUNC('day', "createdAt") AS day, COALESCE(SUM(amount), 0) AS amount
      FROM "Transaction"
      WHERE "userId" = ${user.id}
        AND type = 'payment'
        AND status = 'completed'
        AND "createdAt" >= ${sparklineStart}
        AND "createdAt" < ${sparklineEnd}
      GROUP BY day
      ORDER BY day ASC
    `),
  ])

  logger.info({ userId: user.id, queryCount: dashboard.queryCount + 1 }, 'routes-b dashboard query profile')

  const sparklineByDate = new Map(
    sparklineRows.map(row => [
      row.day.toISOString().slice(0, 10),
      normalizeCurrencyAmount(row.amount),
    ]),
  )

  const sparklinePoints = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(sparklineStart)
    date.setUTCDate(sparklineStart.getUTCDate() + index)
    const key = date.toISOString().slice(0, 10)

    return {
      date: key,
      amount: sparklineByDate.get(key) ?? 0,
    }
  })

  return NextResponse.json({
    summary: dashboard.summary,
    sparkline: {
      days: 14,
      points: sparklinePoints,
    },
  })
}

export const GET = withRequestId(GETHandler)
