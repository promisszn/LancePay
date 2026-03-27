import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { verifyAuthToken } from '@/lib/auth'
import { logger } from '@/lib/logger'

// ── GET /api/routes-d/branding — get user's branding settings ──

export async function GET(request: NextRequest) {
  try {
    const authToken = request.headers.get('authorization')?.replace('Bearer ', '')
    if (!authToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const claims = await verifyAuthToken(authToken)
    if (!claims) return NextResponse.json({ error: 'Invalid token' }, { status: 401 })

    const user = await prisma.user.findUnique({ where: { privyId: claims.userId } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const branding = await prisma.brandingSettings.findUnique({
      where: { userId: user.id },
      select: {
        id: true,
        logoUrl: true,
        primaryColor: true,
        footerText: true,
        signatureUrl: true,
        createdAt: true,
      },
    })

    // Return null (not 404) when no branding is configured
    return NextResponse.json({ branding: branding ?? null })
  } catch (error) {
    logger.error({ err: error }, 'Branding GET error')
    return NextResponse.json({ error: 'Failed to get branding settings' }, { status: 500 })
  }
}
