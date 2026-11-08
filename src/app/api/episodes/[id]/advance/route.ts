import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { advanceEpisode, summarizeCost } from '@/lib/pipeline'

export const maxDuration = 300

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const result = await advanceEpisode(id)
    const { units, estUsd } = summarizeCost(result.episode.costJson)
    return NextResponse.json({
      done: result.done,
      episode: result.episode,
      lastStage: result.lastStage ?? null,
      cost: { units, estUsd },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Advance failed'
    return NextResponse.json({ error: msg.slice(0, 300) }, { status: 500 })
  }
}
