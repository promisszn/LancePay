import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { verifyAuthToken } from '@/lib/auth'
import { generateInvoiceNumber } from '@/lib/utils'
import { decodeCursor, encodeCursor } from '../_lib/cursor'

async function getAuthenticatedUser(request: NextRequest) {
  const authToken = request.headers.get('authorization')?.replace('Bearer ', '')
  const claims = await verifyAuthToken(authToken || '')
  if (!claims) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const user = await prisma.user.findUnique({ where: { privyId: claims.userId } })
  if (!user) {
    return { error: NextResponse.json({ error: 'User not found' }, { status: 404 }) }
  }

  return { user }
}

async function getUniqueInvoiceNumber() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const invoiceNumber = generateInvoiceNumber()
    const existingInvoice = await prisma.invoice.findUnique({
      where: { invoiceNumber },
      select: { id: true },
    })

    if (!existingInvoice) {
      return invoiceNumber
    }
  }

  throw new Error('Failed to generate a unique invoice number')
}

export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedUser(request)
  if ('error' in auth) {
    return auth.error
  }

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const limitParam = searchParams.get('limit')
  const cursorParam = searchParams.get('cursor')
  const limit = limitParam === null ? 25 : Number.parseInt(limitParam, 10)

  const validStatuses = ['pending', 'paid', 'overdue', 'cancelled']
  if (status && !validStatuses.includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }
  if (!Number.isFinite(limit) || Number.isNaN(limit) || limit <= 0 || limit > 100) {
    return NextResponse.json({ error: 'limit must be a number between 1 and 100' }, { status: 400 })
  }

  const decodedCursor = cursorParam ? decodeCursor(cursorParam) : null
  if (cursorParam && !decodedCursor) {
    return NextResponse.json({ error: 'Invalid cursor' }, { status: 400 })
  }

  const where = {
    userId: auth.user.id,
    ...(status ? { status } : {}),
    ...(decodedCursor
      ? {
          OR: [
            { createdAt: { lt: new Date(decodedCursor.createdAt) } },
            {
              AND: [
                { createdAt: new Date(decodedCursor.createdAt) },
                { id: { lt: decodedCursor.id } },
              ],
            },
          ],
        }
      : {}),
  }

  const invoices = await prisma.invoice.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    select: {
      id: true,
      invoiceNumber: true,
      clientName: true,
      clientEmail: true,
      amount: true,
      currency: true,
      status: true,
      dueDate: true,
      createdAt: true,
    },
  })

  const hasNextPage = invoices.length > limit
  const pageData = hasNextPage ? invoices.slice(0, limit) : invoices
  const lastInvoice = hasNextPage ? pageData[pageData.length - 1] : null
  const nextCursor = lastInvoice
    ? encodeCursor({ createdAt: lastInvoice.createdAt.toISOString(), id: lastInvoice.id })
    : null

  return NextResponse.json({
    data: pageData.map((invoice) => ({
      ...invoice,
      amount: Number(invoice.amount),
    })),
    nextCursor,
  })
}

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedUser(request)
  if ('error' in auth) {
    return auth.error
  }

  const body = await request.json()
  const { clientEmail, clientName, description, amount, currency = 'USD', dueDate } = body

  if (!clientEmail || !description || amount === undefined || amount === null) {
    return NextResponse.json(
      { error: 'clientEmail, description, and amount are required' },
      { status: 400 },
    )
  }

  const parsedAmount = Number(amount)
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    return NextResponse.json({ error: 'amount must be greater than 0' }, { status: 400 })
  }

  let parsedDueDate: Date | null = null
  if (dueDate) {
    parsedDueDate = new Date(dueDate)
    if (Number.isNaN(parsedDueDate.getTime())) {
      return NextResponse.json({ error: 'dueDate must be a valid date string' }, { status: 400 })
    }
  }

  const invoiceNumber = await getUniqueInvoiceNumber()
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${request.headers.get('host')}`
  const paymentLink = `${baseUrl}/pay/${invoiceNumber}`

  const invoice = await prisma.invoice.create({
    data: {
      userId: auth.user.id,
      invoiceNumber,
      clientEmail: String(clientEmail).toLowerCase(),
      clientName: clientName || null,
      description,
      amount: parsedAmount,
      currency,
      paymentLink,
      dueDate: parsedDueDate,
    },
  })

  return NextResponse.json(
    {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      paymentLink: invoice.paymentLink,
      status: invoice.status,
      amount: Number(invoice.amount),
      currency: invoice.currency,
    },
    { status: 201 },
  )
}
