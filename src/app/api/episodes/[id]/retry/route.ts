import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { startAutonomousRun, resumeOrphanedRuns } from '@/lib/pipeline'

// POST /api/episodes/[id]/retry — reset the failed stage (consumes its retry
// budget) and restart the server-owned autonomous run.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const ep = await db.episode.findUnique({ where: { id }, include: { stages: true } })
    if (!ep) return NextResponse.json({ error: 'Episode not found' }, { status: 404 })
    if (ep.status === 'ready') {
      return NextResponse.json({ error: 'Episode already ready' }, { status: 400 })
    }

    if (ep.status === 'failed') {
      const failed = ep.stages.find((s) => s.status === 'failed')
      if (failed) {
        await db.stageRun.update({
          where: { id: failed.id },
          data: { status: 'pending', error: null, retries: { increment: 1 } },
        })
      }
      await db.episode.update({ where: { id }, data: { status: 'running' } })
    }
    startAutonomousRun(id)
    await resumeOrphanedRuns() // revive any other stalled runs while we're here
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Retry failed'
    return NextResponse.json({ error: msg.slice(0, 300) }, { status: 500 })
  }
}
