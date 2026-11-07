import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createEpisodeForStation, startAutonomousRun, summarizeCost } from '@/lib/pipeline'

// POST /api/episodes — add another episode to an EXISTING station (channel mode)
// and hand the run to the server-owned autonomous runner.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const stationId = String(body?.stationId ?? '')
    const prompt = String(body?.prompt ?? '').slice(0, 400)
    if (!stationId) {
      return NextResponse.json({ error: 'stationId required' }, { status: 400 })
    }

    const episode = await createEpisodeForStation(stationId, prompt)
    startAutonomousRun(episode.id)
    const { units, estUsd } = summarizeCost(episode.costJson)
    return NextResponse.json({ episode, cost: { units, estUsd } })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Episode creation failed'
    return NextResponse.json({ error: msg.slice(0, 300) }, { status: 500 })
  }
}
