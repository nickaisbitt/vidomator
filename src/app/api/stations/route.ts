import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { generateCharter } from '@/lib/charter'
import { summarizeCost } from '@/lib/pipeline'

export async function GET() {
  const stations = await db.station.findMany({
    orderBy: { createdAt: 'desc' },
    include: { episodes: { orderBy: { createdAt: 'desc' } } },
  })
  // attach per-episode + per-station cost summaries (channel stats for the UI)
  const stationsWithCost = stations.map((s) => {
    const episodes = s.episodes.map((e) => {
      const { units, estUsd } = summarizeCost(e.costJson)
      return { ...e, estUsd }
    })
    const scored = episodes.filter((e) => e.qcScore != null)
    const avgQc = scored.length
      ? Math.round(scored.reduce((sum, e) => sum + (e.qcScore ?? 0), 0) / scored.length)
      : null
    const totalSec = episodes.reduce((sum, e) => sum + (e.durationSec ?? 0), 0)
    return {
      ...s,
      episodes,
      stats: {
        episodeCount: episodes.length,
        readyCount: episodes.filter((e) => e.status === 'ready').length,
        avgQc,
        totalSec,
        estUsd: episodes.reduce((sum, e) => sum + e.estUsd, 0),
      },
    }
  })
  return NextResponse.json({ stations: stationsWithCost })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const prompt = String(body?.prompt ?? '').trim()
    if (prompt.length < 3) {
      return NextResponse.json({ error: 'Describe your station in a few words.' }, { status: 400 })
    }
    if (prompt.length > 600) {
      return NextResponse.json({ error: 'Prompt too long (max 600 chars).' }, { status: 400 })
    }

    const { charter, name, tagline, genre, palette, handle } = await generateCharter(prompt)

    const station = await db.station.create({
      data: {
        name,
        handle,
        tagline,
        genre,
        charterJson: JSON.stringify(charter),
        paletteJson: JSON.stringify(palette),
        costJson: JSON.stringify({ llm: 1 }),
      },
    })
    return NextResponse.json({ station })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Station creation failed'
    return NextResponse.json({ error: msg.slice(0, 300) }, { status: 500 })
  }
}
