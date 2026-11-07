import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { generateCharter } from '@/lib/charter'
import { llmJson } from '@/lib/ai'
import { createStagesForEpisode, startAutonomousRun, summarizeCost } from '@/lib/pipeline'
import type { StationCharter } from '@/lib/types'

// POST /api/studio/generate — THE one-prompt flow.
// prompt in → charter → station → episode → server-owned autonomous run.
// The client just polls GET /api/episodes/[id] from here on.
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

    // 1 ─ station charter from the single prompt
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

    // 2 ─ episode title (cheap LLM pass keeps the library readable)
    let title = 'Untitled Broadcast'
    try {
      const r = await llmJson<{ title?: string }>(
        'You name radio episodes. Respond ONLY with JSON {"title": "..."} (max 48 chars, evocative, no quotes inside).',
        `Station: ${station.name} — ${station.tagline} (genre: ${station.genre}). Episode concept: ${prompt}. DJ: ${charter.persona?.name}.`
      )
      if (r?.title) title = String(r.title).slice(0, 60)
    } catch {
      title = prompt.slice(0, 48)
    }

    // 3 ─ episode + stages, then hand the whole run to the server
    // (seed masked to 31 bits — Prisma Int caps at 2^31−1)
    const seed = ((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0) & 0x7fffffff
    const episode = await db.episode.create({
      data: { stationId: station.id, title, prompt, status: 'running', seed },
    })
    await createStagesForEpisode(episode.id)
    startAutonomousRun(episode.id)

    const full = await db.episode.findUnique({
      where: { id: episode.id },
      include: { station: true, stages: { orderBy: { order: 'asc' } }, assets: true },
    })
    return NextResponse.json({
      station,
      episode: full,
      cost: summarizeCost(full?.costJson ?? '{}'),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Generation failed'
    return NextResponse.json({ error: msg.slice(0, 300) }, { status: 500 })
  }
}
