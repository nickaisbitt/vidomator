import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const station = await db.station.findUnique({
    where: { id },
    include: { episodes: { orderBy: { createdAt: 'desc' } } },
  })
  if (!station) return NextResponse.json({ error: 'Station not found' }, { status: 404 })
  return NextResponse.json({ station })
}
