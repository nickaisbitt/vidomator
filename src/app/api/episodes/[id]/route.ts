import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { summarizeCost, resumeOrphanedRuns } from '@/lib/pipeline'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const episode = await db.episode.findUnique({
    where: { id },
    include: { station: true, stages: { orderBy: { order: 'asc' } }, assets: true },
  })
  if (!episode) return NextResponse.json({ error: 'Episode not found' }, { status: 404 })

  // polling = self-healing: revive runs orphaned by a hot reload
  if (episode.status === 'running') {
    await resumeOrphanedRuns().catch(() => {})
  }

  const { units, estUsd } = summarizeCost(episode.costJson)
  return NextResponse.json({ episode, cost: { units, estUsd } })
}
