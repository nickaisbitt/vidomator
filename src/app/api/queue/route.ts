import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { generateCharter } from '@/lib/charter'
import { ensureQueueWorker, resumeOrphanedRuns } from '@/lib/pipeline'

const MAX_CONCEPTS = 7

// GET /api/queue — queue status; polling also self-heals stalled workers/runs
export async function GET() {
  await ensureQueueWorker().catch(() => {})
  await resumeOrphanedRuns().catch(() => {})
  const items = await db.queueItem.findMany({
    orderBy: { createdAt: 'desc' },
    take: 30,
  })
  return NextResponse.json({ items })
}

// POST /api/queue — the channel factory.
// { stationId }        → queue episode concepts on an existing station
// { prompt, concepts } → one prompt designs a NEW station, then renders a run
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    let stationId = body?.stationId ? String(body.stationId) : null
    const stationPrompt = String(body?.prompt ?? '').trim().slice(0, 600)
    const concepts: string[] = (Array.isArray(body?.concepts) ? body.concepts : [])
      .map((c: unknown) => String(c ?? '').trim().slice(0, 400))
      .filter((c: string) => c.length > 0)
      .slice(0, MAX_CONCEPTS)
    if (concepts.length === 0) concepts.push('') // one standard programming block

    if (!stationId) {
      if (stationPrompt.length < 3) {
        return NextResponse.json(
          { error: 'Select a station or describe a new one in the prompt box.' },
          { status: 400 }
        )
      }
      const { charter, name, tagline, genre, palette, handle } = await generateCharter(stationPrompt)
      const station = await db.station.create({
        data: {
          name, handle, tagline, genre,
          charterJson: JSON.stringify(charter),
          paletteJson: JSON.stringify(palette),
          costJson: JSON.stringify({ llm: 1 }),
        },
      })
      stationId = station.id
    } else {
      const exists = await db.station.findUnique({ where: { id: stationId }, select: { id: true } })
      if (!exists) return NextResponse.json({ error: 'Station not found' }, { status: 404 })
    }

    const items = await db.queueItem.createManyAndReturn({
      data: concepts.map((prompt: string) => ({ stationId: stationId as string, prompt })),
    })
    await ensureQueueWorker()
    return NextResponse.json({ stationId, queued: items.length, items })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Queue failed'
    return NextResponse.json({ error: msg.slice(0, 300) }, { status: 500 })
  }
}
