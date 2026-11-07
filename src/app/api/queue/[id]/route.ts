import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ensureQueueWorker } from '@/lib/pipeline'

type Params = { params: Promise<{ id: string }> }

// DELETE /api/queue/[id] — cancel a pending queue item (never a running one —
// the worker owns that episode; use the episode Retry instead)
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const item = await db.queueItem.findUnique({ where: { id } })
  if (!item) return NextResponse.json({ error: 'Queue item not found' }, { status: 404 })
  if (item.status === 'running') {
    return NextResponse.json({ error: 'Item is rendering — let it finish or fail first.' }, { status: 409 })
  }
  if (item.status === 'done') {
    return NextResponse.json({ error: 'Item already rendered.' }, { status: 409 })
  }
  await db.queueItem.delete({ where: { id } })
  return NextResponse.json({ ok: true, cancelled: id })
}

// POST /api/queue/[id] — requeue a failed item for another attempt
export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const item = await db.queueItem.findUnique({ where: { id } })
  if (!item) return NextResponse.json({ error: 'Queue item not found' }, { status: 404 })
  if (item.status === 'running') {
    return NextResponse.json({ error: 'Item is already rendering.' }, { status: 409 })
  }
  await db.queueItem.update({
    where: { id },
    data: { status: 'pending', error: null, episodeId: null },
  })
  await ensureQueueWorker()
  return NextResponse.json({ ok: true, requeued: id })
}
