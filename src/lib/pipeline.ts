// ─── Pipeline runner v2: 11 stages, one prompt → broadcast-grade episode ────
// The SERVER owns the run (startAutonomousRun) — the client only polls.
// Each advance runs at most one bounded unit of work (resumable, observable),
// with fail-soft i2v motion and a QC auto-revise pass.

import { promises as fs } from 'fs'
import path from 'path'
import { db } from './db'
import {
  llmJson, genImage, ttsWav, vlmCheck, genVideoFromImage,
  addUnits, assertBudget, estimateCost,
} from './ai'
import { renderTrack, keyToRoot } from './synth'
import {
  pingPong, buildEpisodeVisual, burnChrome, mixRadio, remuxAudio, remasterAudio,
  designThumbnail, probe, detectFreeze, type LoopSegment,
} from './ffmpeg'
import { buildAttributionMd } from './attribution'
import { runQc } from './qc'
import {
  EPISODE_TARGET_SEC, SCENE_COUNT, XFADE_SEC,
  type StationCharter, type EpisodeRundown, type MetadataPack, type CostUnits,
} from './types'

export const STAGE_DEFS = [
  { key: 'rundown', name: 'Episode rundown + DJ scripts' },
  { key: 'voice', name: 'TTS DJ idents' },
  { key: 'visuals', name: 'Style-locked visuals + VLM check' },
  { key: 'motion', name: 'i2v motion loops (CogVideoX)' },
  { key: 'music', name: 'Dual-track synthwave render (A/B sides)' },
  { key: 'assembly-loop', name: 'Episode visuals — varied motion blocks' },
  { key: 'assembly-audio', name: 'Radio mix — dual-track bed + DJ + loudness' },
  { key: 'assembly-video', name: 'Broadcast chrome + AI end card + mux' },
  { key: 'attribution', name: 'Attribution ledger + credits' },
  { key: 'metadata', name: 'YouTube metadata pack' },
  { key: 'qc', name: 'QC gate: probe + freeze + VLM eyes + revise' },
] as const

export type StageKey = (typeof STAGE_DEFS)[number]['key']

interface Ctx {
  ep: NonNullable<Awaited<ReturnType<typeof loadEpisode>>>
}

async function loadEpisode(id: string) {
  return db.episode.findUnique({
    where: { id },
    include: { station: true, stages: true, assets: true },
  })
}

// ── helpers ──────────────────────────────────────────────────────────────────
function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try { return JSON.parse(raw) as T } catch { return fallback }
}

const absFromUrl = (urlPath: string) =>
  path.join(process.cwd(), 'public', urlPath.replace(/^\//, ''))

async function episodeDir(ctx: Ctx): Promise<string> {
  const dir = path.join(
    process.cwd(), 'public', 'generated', ctx.ep.station.handle, ctx.ep.id
  )
  await fs.mkdir(dir, { recursive: true })
  return dir
}

async function addCost(ctx: Ctx, delta: Partial<CostUnits>) {
  const units = addUnits(parseJson<CostUnits>(ctx.ep.costJson, {}), delta as CostUnits)
  await db.episode.update({
    where: { id: ctx.ep.id },
    data: { costJson: JSON.stringify(units) },
  })
  ctx.ep.costJson = JSON.stringify(units)
}

function unitsFor(kind: 'llm' | 'image' | 'vlm'): Partial<CostUnits> {
  return kind === 'llm' ? { llm: 1 } : kind === 'image' ? { image: 1 } : { vlm: 1 }
}

async function checkBudget(ctx: Ctx, unit: keyof CostUnits, n = 1) {
  assertBudget(parseJson<CostUnits>(ctx.ep.costJson, {}), unit, n)
}

async function logAsset(
  ctx: Ctx,
  data: {
    kind: string; role: string; relPath: string; prompt?: string
    tool: string; model?: string; attribution: string; meta?: Record<string, unknown>
  }
) {
  const abs = absFromUrl('/' + data.relPath)
  let bytes = 0
  try { bytes = (await fs.stat(abs)).size } catch {}
  await db.asset.create({
    data: {
      episodeId: ctx.ep.id,
      kind: data.kind,
      role: data.role,
      path: '/' + data.relPath,
      prompt: data.prompt ?? '',
      tool: data.tool,
      model: data.model ?? '',
      license: 'self-generated',
      attribution: data.attribution,
      metaJson: JSON.stringify({ bytes, ...(data.meta ?? {}) }),
    },
  })
}

const IMG_ATTR = 'AI-generated image (CogView via z-ai-web-dev-sdk) — prompt recorded in ledger'
const TTS_ATTR = 'Synthetic voice (GLM-TTS via z-ai-web-dev-sdk) — script recorded in ledger'
const VID_ATTR = 'AI-generated video (CogVideoX i2v via z-ai-web-dev-sdk) — prompt recorded in ledger'
const SYNTH_ATTR = 'Procedural synthwave render (in-house DSP engine v2, this repo) — seeded'

const rel = (ctx: Ctx, name: string) =>
  path.join('generated', ctx.ep.station.handle, ctx.ep.id, name)

// ── Stage asset hygiene: a resumed stage must never double-log ───────────────
// Removes ledger rows (and files) a previous partial run of the SAME stage
// left behind, so every stage run is idempotent and C1 stays honest.
async function clearStageAssets(
  episodeId: string,
  match: (a: { role: string; metaJson: string }) => boolean
) {
  const stale = await db.asset.findMany({ where: { episodeId } })
  for (const a of stale) {
    if (!match(a)) continue
    await db.asset.delete({ where: { id: a.id } }).catch(() => {})
    await fs.rm(absFromUrl(a.path), { force: true }).catch(() => {})
  }
}

// Full-screen AI end card lines (W2 fix): compliance text that is impossible
// to miss — station brand, 100% AI claim, ledger size, disclosure, tool stack.
function buildEndCard(station: { name: string; tagline: string }, assetCount: number, durationSec: number) {
  return {
    fromSec: Math.max(2, durationSec - 8),
    lines: [
      station.name.toUpperCase(),
      station.tagline,
      '100% AI-GENERATED BROADCAST',
      'MUSIC · VISUALS · VOICE — ALL SYNTHESIZED AT RENDER TIME',
      `NO THIRD-PARTY MATERIAL — ${assetCount} ASSETS IN THE PUBLIC LEDGER`,
      'AI DISCLOSURE: GENERATED WITH GLM / COGVIEW / COGVIDEOX + FFMPEG',
      'FULL ATTRIBUTION IN THE DESCRIPTION & PINNED COMMENT',
    ],
  }
}

// ── Stage runners ────────────────────────────────────────────────────────────
type RunnerResult = { done: true; output: Record<string, unknown> } | { done: false; output: Record<string, unknown> }

const runners: Record<StageKey, (ctx: Ctx) => Promise<RunnerResult>> = {
  // 1 ─ rundown ────────────────────────────────────────────────────────────────
  async rundown(ctx) {
    const charter = parseJson<StationCharter>(ctx.ep.station.charterJson, {} as StationCharter)
    const D = EPISODE_TARGET_SEC
    let raw: Partial<EpisodeRundown> | null = null
    try {
      await checkBudget(ctx, 'llm')
      raw = await llmJson<Partial<EpisodeRundown>>(
        'You are a master radio programmer for AI-generated broadcast stations. Respond with ONLY valid JSON.',
        `Design episode rundown for this station.

STATION CHARTER:
${JSON.stringify(charter, null, 2)}

EPISODE CONCEPT (may be empty): ${ctx.ep.prompt || '(standard programming block)'}

Return JSON with EXACTLY this shape:
{
  "title": "evocative episode title (max 60 chars)",
  "trackTitle": "the main synthwave track name played this episode",
  "tracks": [{"title": "A-side track name (the main theme)", "atSec": 8}, {"title": "B-side track name (a variation / rework)", "atSec": 78}],
  "bpm": integer 88-116,
  "key": "musical key like 'A minor'",
  "mood": "3-6 word mood",
  "scenePrompts": [exactly 4 distinct visual scene descriptions for AI image generation, matching the station visualStyle, each 15-30 words, NEVER include text/letters/logos/watermarks in the description],
  "idents": [
    {"atSec": 7, "script": "DJ intro ident, 2 sentences max, in persona, after the station jingle"},
    {"atSec": 74, "script": "DJ mid-episode ident introducing the B-side track, 1-2 sentences, in persona"},
    {"atSec": 134, "script": "DJ outro ident with sign-off catchphrase, 2 sentences max"}
  ],
  "chapters": [{"t": "0:00", "label": "..."}, ...5-6 entries matching the episode arc]
}`,
        { temperature: 0.9 }
      ) as unknown as Partial<EpisodeRundown>
    } catch (e) {
      // quota wall / outage — deterministic rundown from the charter keeps the
      // pipeline fully autonomous even when the LLM lane is down
      raw = null
    }

    const conceptWord = (ctx.ep.prompt || charter.vibe || 'midnight').split(/\s+/).slice(0, 4).join(' ')
    const fallback: Partial<EpisodeRundown> = {
      title: ctx.ep.title || `${charter.vibe || 'Night Frequency'}`,
      trackTitle: `${charter.name} Transmission ${String(ctx.ep.seed % 97).padStart(2, '0')}`,
      tracks: [
        { title: `${conceptWord} (A-side)`, atSec: 8 },
        { title: `${conceptWord} — rework (B-side)`, atSec: 78 },
      ],
      bpm: 100,
      key: 'A minor',
      mood: charter.vibe || 'midnight drive',
      scenePrompts: [
        `wide establishing shot of ${charter.vibe || 'a neon city at night'}, atmospheric depth, cinematic lighting`,
        `street-level view of ${charter.vibe || 'the neon district'}, rain reflections, volumetric color`,
        `solitary figure inside ${charter.vibe || 'the neon world'}, silhouette rim light`,
        `abstract macro of ${charter.vibe || 'neon signage bokeh'}, shallow focus, film texture`,
      ],
      idents: [
        { atSec: 7, script: charter.identScripts?.intro || `You're locked into ${charter.name}. Let's begin.` },
        { atSec: 74, script: charter.identScripts?.mid || 'Still with me? The night is young.' },
        { atSec: D - 22, script: charter.identScripts?.outro || `${charter.persona?.catchphrase ?? 'Stay tuned.'} This is ${charter.name}, signing off.` },
      ],
      chapters: [
        { t: '0:00', label: 'Station ident + jingle' },
        { t: '0:12', label: 'Signal lock — the build' },
        { t: '0:45', label: 'A-side transmission' },
        { t: '1:15', label: 'B-side rework' },
        { t: '2:10', label: 'Sign-off' },
      ],
    }

    const src = raw ?? fallback
    const trackTitle = String(src.trackTitle || fallback.trackTitle!).slice(0, 80)
    const tracksRaw = (Array.isArray(src.tracks) ? src.tracks : []).slice(0, 2)
    const tracks = [
      { title: String(tracksRaw[0]?.title || trackTitle).slice(0, 80), atSec: 8 },
      { title: String(tracksRaw[1]?.title || `${trackTitle} (B-side)`).slice(0, 80), atSec: 78 },
    ]

    const rundown: EpisodeRundown = {
      title: String(src.title || fallback.title!).slice(0, 70),
      trackTitle,
      tracks,
      bpm: Math.min(116, Math.max(88, Math.round(Number(src.bpm) || fallback.bpm!))),
      key: String(src.key || fallback.key!).slice(0, 30),
      mood: String(src.mood || fallback.mood!).slice(0, 60),
      scenePrompts: (Array.isArray(src.scenePrompts) ? src.scenePrompts : [])
        .slice(0, SCENE_COUNT)
        .map((s) => String(s).slice(0, 300)),
      idents: (Array.isArray(src.idents) ? src.idents : []).slice(0, 3).map((i, idx) => ({
        atSec: Math.min(D - 12, Math.max(2, Math.round(Number(i?.atSec) || [7, 74, D - 22][idx]))),
        script: String(i?.script || charter.identScripts?.[(['intro', 'mid', 'outro'] as const)[idx]] || '').slice(0, 400),
      })),
      chapters: (Array.isArray(src.chapters) ? src.chapters : []).slice(0, 8).map((c) => ({
        t: String(c?.t ?? '0:00').slice(0, 8),
        label: String(c?.label ?? 'Segment').slice(0, 60),
      })),
    }
    while (rundown.scenePrompts.length < SCENE_COUNT) {
      rundown.scenePrompts.push(fallback.scenePrompts![rundown.scenePrompts.length])
    }
    while (rundown.idents.length < 3) {
      const idx = rundown.idents.length
      rundown.idents.push({
        atSec: [7, 74, D - 22][idx],
        script: charter.identScripts?.[(['intro', 'mid', 'outro'] as const)[idx]] || `${charter.persona?.name ?? 'The DJ'} on air.`,
      })
    }
    if (rundown.chapters.length < 3) rundown.chapters = fallback.chapters!

    await db.episode.update({
      where: { id: ctx.ep.id },
      data: { rundownJson: JSON.stringify(rundown), title: rundown.title },
    })
    if (raw) await addCost(ctx, unitsFor('llm'))
    return {
      done: true,
      output: {
        title: rundown.title,
        tracks: rundown.tracks.map((t) => t.title),
        bpm: rundown.bpm,
        key: rundown.key,
        llm: Boolean(raw),
      },
    }
  },

  // 2 ─ voice ──────────────────────────────────────────────────────────────────
  async voice(ctx) {
    const rundown = parseJson<EpisodeRundown>(ctx.ep.rundownJson, null as unknown as EpisodeRundown)
    if (!rundown?.idents?.length) throw new Error('rundown missing')
    await episodeDir(ctx) // ensure the episode dir exists before writing
    await clearStageAssets(ctx.ep.id, (a) => a.role === 'ident') // idempotent resume
    const files: string[] = []
    for (let i = 0; i < rundown.idents.length; i++) {
      const script = rundown.idents[i].script
      await checkBudget(ctx, 'ttsChars', script.length)
      const wav = await ttsWav(script, { voice: 'tongtong', speed: 1.0 })
      const r = rel(ctx, `ident-${i}.wav`)
      await fs.writeFile(absFromUrl('/' + r), wav)
      await logAsset(ctx, {
        kind: 'audio', role: 'ident', relPath: r, prompt: script,
        tool: 'zai-tts', model: 'glm-tts', attribution: TTS_ATTR,
        meta: { atSec: rundown.idents[i].atSec, order: i },
      })
      files.push(r)
      await addCost(ctx, { ttsChars: script.length })
    }
    return { done: true, output: { idents: files.length } }
  },

  // 3 ─ visuals (one image per advance; resumable) ────────────────────────────
  async visuals(ctx) {
    const charter = parseJson<StationCharter>(ctx.ep.station.charterJson, {} as StationCharter)
    const rundown = parseJson<EpisodeRundown>(ctx.ep.rundownJson, null as unknown as EpisodeRundown)
    if (!rundown?.scenePrompts?.length) throw new Error('rundown missing')
    const stage = ctx.ep.stages.find((s) => s.key === 'visuals')!
    const prev = parseJson<{ done?: number; total?: number; log?: string[] }>(stage.outputJson, { done: 0, total: SCENE_COUNT + 1, log: [] })
    const prevLog = Array.isArray(prev.log) ? prev.log : []
    const idx = Number(prev.done ?? 0) // 0 = hero, 1..4 = scenes
    await episodeDir(ctx) // ensure the episode dir exists before writing
    const isHero = idx === 0
    // idempotent resume: drop any asset a previous partial pass logged for this index
    await clearStageAssets(ctx.ep.id, (a) =>
      isHero ? a.role === 'hero' : a.role === 'scene' && parseJson<{ index?: number }>(a.metaJson, {})?.index === idx
    )
    const style = charter.visualStyle || 'cinematic neon synthwave night, volumetric light, film grain'

    const basePrompt = isHero
      ? `Flagship hero artwork for "${ctx.ep.station.name}", a ${ctx.ep.station.genre} radio station. ${style}. ${rundown.mood} mood. Iconic, cover-quality composition. Absolutely no text, no letters, no numbers, no logos, no watermarks.`
      : `${style}. Scene: ${rundown.scenePrompts[idx - 1]}. Absolutely no text, no letters, no numbers, no logos, no watermarks.`

    await checkBudget(ctx, 'image')
    let buf = await genImage(basePrompt, '1344x768')
    await addCost(ctx, unitsFor('image'))

    // VLM style gate (with one strict retry)
    let verdictLog = ''
    try {
      await checkBudget(ctx, 'vlm')
      const dataUrl = `data:image/png;base64,${buf.toString('base64')}`
      const v1 = await vlmCheck(dataUrl, `Does this image strictly match this style: "${style}"? Also: does it contain ANY text, letters or watermarks?`)
      await addCost(ctx, unitsFor('vlm'))
      verdictLog = `v1:${v1.match ? 'pass' : 'fail'}(${v1.reason.slice(0, 60)})`
      if (!v1.match) {
        await checkBudget(ctx, 'image')
        buf = await genImage(`STRICT STYLE ADHERENCE. ${basePrompt} The previous attempt was rejected because: ${v1.reason}. Fix it.`, '1344x768')
        await addCost(ctx, unitsFor('image'))
        verdictLog += ' → regenerated with strict prompt'
      }
    } catch (e) {
      verdictLog = `vlm skipped: ${String(e).slice(0, 60)}`
    }

    const r = rel(ctx, isHero ? 'hero.png' : `scene-${idx}.png`)
    await fs.writeFile(absFromUrl('/' + r), buf)
    await logAsset(ctx, {
      kind: 'image', role: isHero ? 'hero' : 'scene', relPath: r, prompt: basePrompt,
      tool: 'zai-image', model: 'cogview', attribution: IMG_ATTR,
      meta: { index: idx, vlm: verdictLog },
    })

    const done = idx + 1
    const progressOutput = { done, total: SCENE_COUNT + 1, log: [...prevLog, `${isHero ? 'hero' : `scene${idx}`}: ${verdictLog}`] }
    await db.stageRun.update({
      where: { id: stage.id },
      data: { outputJson: JSON.stringify(progressOutput) },
    })
    if (done < SCENE_COUNT + 1) return { done: false, output: progressOutput }
    return { done: true, output: progressOutput }
  },

  // 4 ─ motion: i2v clips from scene-2 + scene-4, ping-pong, fail-soft ────────
  async motion(ctx) {
    const stage = ctx.ep.stages.find((s) => s.key === 'motion')!
    await episodeDir(ctx) // ensure the episode dir exists before writing
    await clearStageAssets(ctx.ep.id, (a) => a.role === 'motion') // idempotent resume
    const assets = await db.asset.findMany({ where: { episodeId: ctx.ep.id } })
    const sceneAsset = (i: number) =>
      assets.find((a) => a.role === 'scene' && parseJson<{ index?: number }>(a.metaJson, {})?.index === i)

    const targets = [sceneAsset(2), sceneAsset(4)]
    const clips: { status: string; ms?: number; fromScene?: number }[] = []
    const log: string[] = []
    const pushProgress = async (extra?: Record<string, unknown>) => {
      await db.stageRun.update({
        where: { id: stage.id },
        data: { outputJson: JSON.stringify({ clips, log, ...(extra ?? {}) }) },
      })
    }

    for (let n = 0; n < targets.length; n++) {
      const scene = targets[n]
      if (!scene) {
        clips.push({ status: 'skipped', fromScene: n === 0 ? 2 : 4 })
        log.push(`source scene missing — clip ${n + 1} skipped`)
        await pushProgress()
        continue
      }
      // attempt with one 429 back-off retry (rate limits are transient)
      let attempt = async () => {
        await checkBudget(ctx, 'video')
        const img = await fs.readFile(absFromUrl(scene.path))
        log.push(`clip ${n + 1}: submitting scene-${n === 0 ? 2 : 4} to CogVideoX…`)
        await pushProgress()
        return await genVideoFromImage(img, {
          durationSec: 5,
          quality: 'speed',
          onPoll: (sec, status) => {
            // fire-and-forget progress so the cockpit feels alive
            db.stageRun.update({
              where: { id: stage.id },
              data: { outputJson: JSON.stringify({ clips, log, polling: { clip: n + 1, elapsedSec: Math.round(sec), status } }) },
            }).catch(() => {})
          },
        })
      }
      try {
        let v: Awaited<ReturnType<typeof attempt>>
        try {
          v = await attempt()
        } catch (firstErr) {
          if (/429|too many/i.test(String(firstErr))) {
            log.push(`clip ${n + 1}: rate-limited — backing off 45s, retrying once…`)
            await pushProgress()
            await new Promise((r) => setTimeout(r, 45_000))
            v = await attempt()
          } else {
            throw firstErr
          }
        }
        await addCost(ctx, { video: 1 })

        const rawClip = rel(ctx, `clip-raw-${n + 1}.mp4`)
        await fs.writeFile(absFromUrl('/' + rawClip), v.mp4)
        const loopClip = rel(ctx, `motion-${n + 1}.mp4`)
        const pp = await pingPong(absFromUrl('/' + rawClip), absFromUrl('/' + loopClip))
        if (!pp.ok) throw new Error(`ping-pong failed: ${pp.log.slice(-200)}`)
        await logAsset(ctx, {
          kind: 'video', role: 'motion', relPath: loopClip,
          prompt: `i2v from scene-${n === 0 ? 2 : 4}`,
          tool: 'zai-video', model: v.model, attribution: VID_ATTR,
          meta: { fromScene: n === 0 ? 2 : 4, ms: v.ms, pingpongMs: pp.ms, clip: n + 1 },
        })
        clips.push({ status: 'ok', ms: v.ms, fromScene: n === 0 ? 2 : 4 })
        log.push(`clip ${n + 1}: done in ${(v.ms / 1000).toFixed(0)}s → ping-pong 10s loop`)
        await pushProgress()
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        clips.push({ status: 'skipped', fromScene: n === 0 ? 2 : 4 })
        log.push(`clip ${n + 1} failed (fail-soft, ken-burns covers it): ${msg.slice(0, 120)}`)
        await pushProgress()
      }
    }

    const ok = clips.filter((c) => c.status === 'ok').length
    return { done: true, output: { clips, log, motionClips: ok } }
  },

  // 5 ─ music (synth v3: A-side + genuinely different B-side render) ──────────
  async music(ctx) {
    const rundown = parseJson<EpisodeRundown>(ctx.ep.rundownJson, null as unknown as EpisodeRundown)
    if (!rundown) throw new Error('rundown missing')
    await episodeDir(ctx) // ensure the episode dir exists before writing
    await clearStageAssets(ctx.ep.id, (a) => a.role === 'music' || a.role === 'musicB') // idempotent resume
    const result = renderTrack({
      bpm: rundown.bpm,
      keyRoot: keyToRoot(rundown.key),
      seed: ctx.ep.seed,
      brightness: 0.62,
    })
    const r = rel(ctx, 'music.wav')
    await fs.writeFile(absFromUrl('/' + r), result.wav)
    await logAsset(ctx, {
      kind: 'audio', role: 'music', relPath: r,
      prompt: `procedural synthwave v3 A-side @ ${result.bpm}bpm in ${rundown.key}, seed ${ctx.ep.seed}`,
      tool: 'synth-engine', model: 'in-house DSP v3', attribution: SYNTH_ATTR,
      meta: {
        bars: result.bars, bpm: result.bpm, durationSec: result.durationSec,
        seed: ctx.ep.seed, sections: result.sections, variant: 'A',
      },
    })

    // B-side: a DISTINCT track — flipped progressions, own derived seed, own
    // arpeggio voice. The ticker's "B-side" label finally tells the truth.
    const seedB = (ctx.ep.seed ^ 0x9e3779b9) >>> 0
    const resultB = renderTrack({
      bpm: rundown.bpm,
      keyRoot: keyToRoot(rundown.key),
      seed: seedB,
      brightness: 0.58,
      variant: 'B',
    })
    const rB = rel(ctx, 'music-b.wav')
    await fs.writeFile(absFromUrl('/' + rB), resultB.wav)
    await logAsset(ctx, {
      kind: 'audio', role: 'musicB', relPath: rB,
      prompt: `procedural synthwave v3 B-side (variant B) @ ${resultB.bpm}bpm in ${rundown.key}, seed ${seedB}`,
      tool: 'synth-engine', model: 'in-house DSP v3', attribution: SYNTH_ATTR,
      meta: {
        bars: resultB.bars, bpm: resultB.bpm, durationSec: resultB.durationSec,
        seed: seedB, sections: resultB.sections, variant: 'B',
      },
    })

    await db.episode.update({
      where: { id: ctx.ep.id },
      data: { durationSec: Math.round(result.durationSec) },
    })
    ctx.ep.durationSec = Math.round(result.durationSec)
    return {
      done: true,
      output: {
        bars: result.bars, bpm: result.bpm,
        durationSec: Math.round(result.durationSec),
        sections: result.sections.map((s) => s.name),
        bytes: result.wav.length,
        bSide: { bars: resultB.bars, seed: seedB, bytes: resultB.wav.length },
      },
    }
  },

  // 6 ─ assembly-loop: EPISODE-LENGTH varied visual track (W1 fix) ────────────
  // The old build streamed one 40s loop 4× — viewers saw the same scenes every
  // 40 seconds. Now we render the FULL episode as three rotating cycles of
  // ken-burns + i2v segments with alternating zoom directions and different
  // scene orders, plus a tail. Same assets, ~3× the variety, still $0.
  async 'assembly-loop'(ctx) {
    const fresh = await loadEpisode(ctx.ep.id)
    if (!fresh) throw new Error('episode vanished')
    await episodeDir({ ep: fresh })
    await clearStageAssets(ctx.ep.id, (a) => a.role === 'footage') // idempotent resume
    const assets = fresh.assets
    const sceneAsset = (i: number) =>
      assets.find((a) => a.role === 'scene' && parseJson<{ index?: number }>(a.metaJson, {})?.index === i)
    const motionAssets = assets
      .filter((a) => a.role === 'motion')
      .sort((a, b) =>
        (parseJson<{ clip?: number }>(a.metaJson, {}).clip ?? 0) -
        (parseJson<{ clip?: number }>(b.metaJson, {}).clip ?? 0))

    const D = fresh.durationSec ?? EPISODE_TARGET_SEC
    const s1 = sceneAsset(1)
    const s3 = sceneAsset(3)
    const s4 = sceneAsset(4)
    if (!s1 || !s3 || !s4) throw new Error('scene images missing')
    const pick = (i: number) => sceneAsset(i) ?? s1

    const kb = (a: NonNullable<typeof s1>, zoomIn: boolean): LoopSegment => ({
      type: 'kb', path: absFromUrl(a.path), sec: 0, zoomIn, // sec filled below
    })
    const clipSeg = (a: (typeof motionAssets)[number] | undefined): LoopSegment | null =>
      a ? { type: 'clip', path: absFromUrl(a.path), sec: 9.5 } : null

    // Three rotating cycles (segment order + zoom directions differ each pass)
    const m0 = motionAssets[0]
    const m1 = motionAssets[1]
    const schedule: (LoopSegment | null)[] = [
      kb(s1, true), clipSeg(m0), kb(s3, false), clipSeg(m1), kb(pick(2), true),
      kb(pick(4), false), clipSeg(m1), kb(pick(2), false), clipSeg(m0), kb(s3, true),
      kb(pick(3), true), clipSeg(m0), kb(pick(4), true), clipSeg(m1), kb(pick(2), false),
      kb(s1, false), // tail — sign-off wide shot
    ]
    const segments: LoopSegment[] = schedule.filter((s): s is LoopSegment => s !== null)

    // Fit durations exactly: clips capped at 9.5s (i2v source length),
    // kb segments share what remains so total − xfades = D.
    const n = segments.length
    const clipSecs = segments.filter((s) => s.type === 'clip').reduce((sum, s) => sum + s.sec, 0)
    const kbCount = segments.filter((s) => s.type === 'kb').length
    const kbSec = Math.max(6, (D + (n - 1) * XFADE_SEC - clipSecs) / kbCount)
    for (const s of segments) if (s.type === 'kb') s.sec = Math.round(kbSec * 100) / 100

    const outAbs = absFromUrl('/' + rel(ctx, 'footage.mp4'))
    const r = await buildEpisodeVisual(segments, outAbs, { xfadeSec: XFADE_SEC })
    if (!r.ok) throw new Error(`ffmpeg episode visuals failed: ${r.log.slice(-400)}`)
    await addCost(ctx, { ffmpegSec: Math.round(r.ms / 1000) })
    const r2 = rel(ctx, 'footage.mp4')
    await logAsset(ctx, {
      kind: 'video', role: 'footage', relPath: r2,
      tool: 'ffmpeg', attribution: 'Local ffmpeg render (episode-length varied motion: 3 rotating cycles of ken-burns + i2v, alternating zoom directions, chained xfades)',
      meta: {
        segments: n, kbSec: Math.round(kbSec * 10) / 10,
        cycleOrder: segments.map((s) => `${path.basename(s.path).split('.')[0]}:${s.zoomIn === false ? 'out' : 'in'}`).join(' → '),
        totalSec: r.totalSec, ms: r.ms,
      },
    })
    return { done: true, output: { ms: r.ms, totalSec: r.totalSec, segments: n, kbSec: Math.round(kbSec * 10) / 10 } }
  },

  // 7 ─ assembly-audio: dual-track radio mix (sidechain + R128) → radio-mix.wav
  async 'assembly-audio'(ctx) {
    const fresh = await loadEpisode(ctx.ep.id)
    if (!fresh) throw new Error('episode vanished')
    await episodeDir({ ep: fresh })
    await clearStageAssets(ctx.ep.id, (a) => a.role === 'radiomix') // idempotent resume
    const assets = fresh.assets
    const music = assets.find((a) => a.role === 'music')
    const musicB = assets.find((a) => a.role === 'musicB')
    const idents = assets.filter((a) => a.role === 'ident')
    if (!music) throw new Error('music missing')
    const durationSec = fresh.durationSec ?? EPISODE_TARGET_SEC
    const rundown = parseJson<EpisodeRundown>(fresh.rundownJson, null as unknown as EpisodeRundown)
    const identsPlacement = idents.map((a) => {
      const meta = parseJson<{ atSec?: number; order?: number }>(a.metaJson, {})
      const fallback = [7, Math.round(durationSec / 2), durationSec - 24]
      return {
        file: absFromUrl(a.path),
        atSec: Math.max(0, Math.min(durationSec - 8, meta.atSec ?? fallback[meta.order ?? 0] ?? 7)),
      }
    })
    // B-side crossfade point = the rundown's B-side marker (fallback: midpoint)
    const bAt = rundown?.tracks?.[1]?.atSec ?? Math.round(durationSec / 2)
    const outAbs = absFromUrl('/' + rel(ctx, 'radio-mix.wav'))
    const r = await mixRadio(
      absFromUrl(music.path), identsPlacement, outAbs, durationSec,
      musicB ? { path: absFromUrl(musicB.path), xfadeAtSec: bAt, xfadeDurSec: 5 } : undefined
    )
    if (!r.ok) throw new Error(`ffmpeg radio mix failed: ${r.log.slice(-400)}`)
    await addCost(ctx, { ffmpegSec: Math.round(r.ms / 1000) })
    const rr = rel(ctx, 'radio-mix.wav')
    await logAsset(ctx, {
      kind: 'audio', role: 'radiomix', relPath: rr,
      tool: 'ffmpeg', attribution: 'Local ffmpeg render (dual-track bed: A-side → acrossfade → B-side; DJ idents sidechain-ducked; R128 loudnorm −14 LUFS)',
      meta: { ms: r.ms, idents: identsPlacement.length, bSideAt: bAt, dualTrack: Boolean(musicB) },
    })
    return { done: true, output: { ms: r.ms, idents: identsPlacement.length, bSideAt: bAt, dualTrack: Boolean(musicB) } }
  },

  // 8 ─ assembly-video: chrome v2 + FX + VU + AI end card + mux + thumbnail ───
  async 'assembly-video'(ctx) {
    const fresh = await loadEpisode(ctx.ep.id)
    if (!fresh) throw new Error('episode vanished')
    const rundown = parseJson<EpisodeRundown>(fresh.rundownJson, null as unknown as EpisodeRundown)
    const assets = fresh.assets
    const footage = assets.find((a) => a.role === 'footage') ?? assets.find((a) => a.role === 'loop')
    const radiomix = assets.find((a) => a.role === 'radiomix')
    const hero = assets.find((a) => a.role === 'hero')
    const idents = assets.filter((a) => a.role === 'ident')
    if (!footage || !radiomix || !rundown) throw new Error('footage/radiomix/rundown missing')
    const durationSec = fresh.durationSec ?? EPISODE_TARGET_SEC

    const charter = parseJson<StationCharter>(fresh.station.charterJson, {} as StationCharter)
    const palette = parseJson<string[]>(fresh.station.paletteJson, [])
    const hexTo0x = (h: string) => /^#[0-9a-fA-F]{6}$/.test(h) ? '0x' + h.slice(1).toUpperCase() : null
    const accent = hexTo0x(palette[0] ?? '') ?? hexTo0x(palette[2] ?? '') ?? '0xFF7AC6'

    const r = await burnChrome(
      absFromUrl(footage.path),
      absFromUrl(radiomix.path),
      absFromUrl('/' + rel(ctx, 'episode.mp4')),
      {
        stationName: fresh.station.name,
        tagline: fresh.station.tagline,
        djName: charter.persona?.name ?? 'The DJ',
        tracks: rundown.tracks,
        identAtSec: idents.map((a) => parseJson<{ atSec?: number }>(a.metaJson, {}).atSec ?? 0),
        durationSec,
        endCard: buildEndCard(fresh.station, fresh.assets.length + 2, durationSec),
        paletteHex: accent,
      },
      await episodeDir({ ep: fresh })
    )
    if (!r.ok) throw new Error(`ffmpeg chrome failed: ${r.log.slice(-400)}`)
    await addCost(ctx, { ffmpegSec: Math.round(r.ms / 1000) })

    // designed thumbnail (brand typography over hero art, not a frame grab)
    let thumbOk = false
    if (hero) {
      const t = await designThumbnail(absFromUrl(hero.path), absFromUrl('/' + rel(ctx, 'thumb.jpg')), {
        stationName: fresh.station.name,
        title: fresh.title,
        paletteHex: accent,
      })
      thumbOk = t.ok
    }

    const p = await probe(absFromUrl('/' + rel(ctx, 'episode.mp4')))
    const rMaster = rel(ctx, 'episode.mp4')
    await logAsset(ctx, {
      kind: 'video', role: 'master', relPath: rMaster,
      tool: 'ffmpeg', attribution: 'Local ffmpeg render (chrome v2: ticker/VU/progress/lower-thirds; FX: grain+ vignette+CA; AAC mux)',
      meta: { ms: r.ms, probe: p, chrome: 'v2' },
    })
    if (thumbOk) {
      await logAsset(ctx, {
        kind: 'image', role: 'thumb', relPath: rel(ctx, 'thumb.jpg'),
        tool: 'ffmpeg', attribution: 'Designed thumbnail (brand typography + palette over hero art)',
        meta: { designed: true },
      })
    }
    await db.episode.update({
      where: { id: ctx.ep.id },
      data: {
        videoPath: '/' + rMaster,
        thumbPath: thumbOk ? '/' + rel(ctx, 'thumb.jpg') : null,
        durationSec: Math.round(p.durationSec ?? durationSec),
      },
    })
    return { done: true, output: { ms: r.ms, probe: p, thumb: thumbOk ? 'designed' : 'failed' } }
  },

  // 9 ─ attribution (after assembly — the ledger covers EVERY asset) ───────────
  async attribution(ctx) {
    const fresh = await loadEpisode(ctx.ep.id)
    if (!fresh) throw new Error('episode vanished')
    await episodeDir({ ep: fresh })
    const md = buildAttributionMd(fresh.station, fresh, fresh.assets)
    const r = rel(ctx, 'ATTRIBUTION.md')
    await fs.writeFile(absFromUrl('/' + r), md)
    await logAsset(ctx, {
      kind: 'doc', role: 'attribution', relPath: r,
      tool: 'pipeline', attribution: 'Auto-generated attribution report',
      meta: { assets: fresh.assets.length },
    })
    await db.episode.update({
      where: { id: ctx.ep.id },
      data: { attributionMd: md },
    })
    return { done: true, output: { assets: fresh.assets.length, mdBytes: md.length } }
  },

  // 10 ─ metadata ──────────────────────────────────────────────────────────────
  async metadata(ctx) {
    const fresh = await loadEpisode(ctx.ep.id)
    if (!fresh) throw new Error('episode vanished')
    const charter = parseJson<StationCharter>(fresh.station.charterJson, {} as StationCharter)
    const rundown = parseJson<EpisodeRundown>(fresh.rundownJson, null as unknown as EpisodeRundown)
    const chapterLines = (rundown?.chapters ?? []).map((c) => `${c.t} ${c.label}`).join('\n')

    // deterministic pack built from local data — guarantees the stage can
    // never hard-fail (quota walls, outages). Used as fallback and to fill gaps.
    const localPack: MetadataPack = {
      youtubeTitle: `${fresh.station.name} — ${fresh.title} (${rundown?.mood ?? 'late night'} synthwave radio)`.slice(0, 100),
      youtubeDescription: [
        `${rundown?.tracks[0]?.title ?? fresh.title} — a ${rundown?.mood ?? 'midnight'} broadcast from ${fresh.station.name}.`,
        '',
        `${fresh.station.tagline}. ${charter.persona?.name ?? 'The DJ'} on the mic; ${rundown?.bpm ?? 100} BPM ${rundown?.key ?? 'minor'} synthwave, rendered live by the station's own DSP engine.`,
        '',
        '100% AI-generated at render time: music (in-house procedural synth engine), visuals (CogView + CogVideoX), voice (GLM-TTS), assembly (ffmpeg). No third-party material.',
        chapterLines ? `\nCHAPTERS\n${chapterLines}` : '',
      ].join('\n').slice(0, 4800),
      tags: [fresh.station.genre, 'synthwave', 'ai music', 'radio drama', '24/7 radio', 'ai generated', charter.persona?.name ?? 'dj', rundown?.mood ?? 'midnight', 'ambient', 'retrowave'].filter(Boolean).slice(0, 12),
      chapters: rundown?.chapters ?? [],
      disclosure: 'All music, visuals and voice in this video are 100% AI-generated at render time — no third-party or copyrighted material is used. Attribution ledger: see pinned comment / ATTRIBUTION.md.',
    }

    let pack: MetadataPack
    let usedLlm = true
    try {
      await checkBudget(ctx, 'llm')
      const raw = await llmJson<Partial<MetadataPack>>(
        'You are a YouTube growth strategist for AI-generated music channels. Respond with ONLY valid JSON.',
        `Create the YouTube metadata pack.

Station: ${fresh.station.name} — ${fresh.station.tagline} (genre: ${fresh.station.genre})
Episode: ${fresh.title}; tracks: ${rundown?.tracks.map((t) => t.title).join(' / ')}; mood: ${rundown?.mood}; duration: ${fresh.durationSec}s
Persona: ${charter.persona?.name} — ${charter.persona?.style}

Chapters (already fixed): ${JSON.stringify(rundown?.chapters ?? [])}

Return JSON:
{
  "youtubeTitle": "max 95 chars, no clickbait lies",
  "youtubeDescription": "3 short paragraphs: hook, what this is, how it was made; end with the chapter list lines",
  "tags": ["12-18 tags"],
  "chapters": [{"t": "0:00", "label": "..."}],
  "disclosure": "one-sentence AI disclosure"
}`,
        { temperature: 0.7, backoffAttempts: 2 }
      ) as unknown as Partial<MetadataPack>

      // deterministic disclosure guarantee (C2 can never fail on LLM whim)
      pack = {
        youtubeTitle: String(raw.youtubeTitle || localPack.youtubeTitle).slice(0, 100),
        youtubeDescription: String(raw.youtubeDescription || localPack.youtubeDescription).slice(0, 4800),
        tags: (Array.isArray(raw.tags) ? raw.tags : []).slice(0, 18).map((t) => String(t).slice(0, 40)),
        chapters: rundown?.chapters ?? [],
        disclosure: localPack.disclosure,
      }
      if (!pack.tags.length) pack.tags = localPack.tags
      if (pack.youtubeDescription.length < 80) pack.youtubeDescription = localPack.youtubeDescription
    } catch (e) {
      // quota wall / outage — the deterministic pack keeps the episode shippable
      usedLlm = false
      pack = localPack
    }
    await db.episode.update({
      where: { id: ctx.ep.id },
      data: { metadataJson: JSON.stringify(pack) },
    })
    if (usedLlm) await addCost(ctx, unitsFor('llm'))
    return { done: true, output: { title: pack.youtubeTitle, tags: pack.tags.length, llm: usedLlm } }
  },

  // 11 ─ qc: probe + VLM perceptual eyes + one auto-revise pass ───────────────
  async qc(ctx) {
    const fresh = await loadEpisode(ctx.ep.id)
    if (!fresh) throw new Error('episode vanished')
    let report = await runQc({
      episode: fresh,
      station: fresh.station,
      assets: fresh.assets,
      stages: fresh.stages,
    })
    await addCost(ctx, { vlm: report.vlmCalls ?? 0 })

    // ── auto-revise: fix what a re-render can fix, then rescore once ────────
    if (!report.passed && report.revisable.length > 0) {
      const dir = await episodeDir({ ep: fresh })
      const rundown = parseJson<EpisodeRundown>(fresh.rundownJson, null as unknown as EpisodeRundown)
      const charter = parseJson<StationCharter>(fresh.station.charterJson, {} as StationCharter)
      const footage = fresh.assets.find((a) => a.role === 'footage') ?? fresh.assets.find((a) => a.role === 'loop')
      const radiomix = fresh.assets.find((a) => a.role === 'radiomix')
      const hero = fresh.assets.find((a) => a.role === 'hero')
      const palette = parseJson<string[]>(fresh.station.paletteJson, [])
      const accent = /^#[0-9a-fA-F]{6}$/.test(palette[0] ?? '') ? '0x' + palette[0].slice(1).toUpperCase() : '0xFF7AC6'
      const durationSec = fresh.durationSec ?? EPISODE_TARGET_SEC
      const masterAbs = fresh.videoPath ? absFromUrl(fresh.videoPath) : null

      for (const item of report.revisable) {
        try {
          if (item === 'V2' && masterAbs && footage && radiomix && rundown) {
            // re-burn chrome with bigger type + heavier shadows
            const rev = await burnChrome(
              absFromUrl(footage.path), absFromUrl(radiomix.path), masterAbs,
              {
                stationName: fresh.station.name,
                tagline: fresh.station.tagline,
                djName: charter.persona?.name ?? 'The DJ',
                tracks: rundown.tracks,
                identAtSec: fresh.assets
                  .filter((a) => a.role === 'ident')
                  .map((a) => parseJson<{ atSec?: number }>(a.metaJson, {}).atSec ?? 0),
                durationSec,
                endCard: buildEndCard(fresh.station, fresh.assets.length, durationSec),
                paletteHex: accent,
                bigText: true,
              },
              dir
            )
            if (rev.ok) await addCost(ctx, { ffmpegSec: Math.round(rev.ms / 1000) })
          } else if (item === 'S2' && masterAbs && radiomix) {
            // re-master loudness, remux without re-rendering video
            const remastered = absFromUrl('/' + rel(ctx, 'radio-mix-2.wav'))
            const rm = await remasterAudio(absFromUrl(radiomix.path), remastered)
            if (rm.ok) {
              const mux = await remuxAudio(masterAbs, remastered, masterAbs + '.rev.mp4', durationSec)
              if (mux.ok) await fs.rename(masterAbs + '.rev.mp4', masterAbs)
            }
          } else if (item === 'P2' && hero) {
            await designThumbnail(absFromUrl(hero.path), absFromUrl('/' + rel(ctx, 'thumb.jpg')), {
              stationName: fresh.station.name, title: fresh.title, paletteHex: accent,
            })
            await db.episode.update({
              where: { id: ctx.ep.id },
              data: { thumbPath: '/' + rel(ctx, 'thumb.jpg') },
            })
          }
        } catch {
          // revision attempt failed — keep the original score
        }
      }

      // rescore after revision
      const after = await loadEpisode(ctx.ep.id)
      if (after) {
        const revisedReport = await runQc({
          episode: after, station: after.station, assets: after.assets, stages: after.stages,
        })
        await addCost(ctx, { vlm: revisedReport.vlmCalls ?? 0 })
        revisedReport.revised = true
        report = revisedReport
      }
    }

    await db.episode.update({
      where: { id: ctx.ep.id },
      data: { qcScore: report.score, qcJson: JSON.stringify(report) },
    })
    return { done: true, output: { score: report.score, passed: report.passed, revised: report.revised ?? false } }
  },
}

// ── Public API: single-step advance (resumable, observable) ──────────────────
export interface AdvanceResult {
  done: boolean
  episode: NonNullable<Awaited<ReturnType<typeof loadEpisode>>>
  lastStage?: { key: string; status: string; error?: string; output?: unknown }
}

// Per-episode advance mutex: the queue worker, the autonomous runner and UI
// polling can all try to drive the same episode — concurrent advances raced
// on the same stages (duplicate ledger assets, one driver's cleanup deleting
// another's render files). All drivers now share one in-flight advance.
const gAdv = globalThis as unknown as { __rfAdvLocks?: Map<string, Promise<AdvanceResult>> }
const advLocks = (gAdv.__rfAdvLocks ??= new Map())

export function advanceEpisode(id: string): Promise<AdvanceResult> {
  const inflight = advLocks.get(id)
  if (inflight) return inflight
  const p = advanceEpisodeInner(id).finally(() => {
    advLocks.delete(id)
  })
  advLocks.set(id, p)
  return p
}

async function advanceEpisodeInner(id: string): Promise<AdvanceResult> {
  let ep = await loadEpisode(id)
  if (!ep) throw new Error('episode not found')
  if (ep.status === 'ready' || ep.status === 'failed') {
    return { done: true, episode: ep }
  }

  const next =
    ep.stages
      .filter((s) => s.status !== 'done')
      .sort((a, b) => a.order - b.order)[0] ?? null

  if (!next) {
    const done = await db.episode.update({ where: { id }, data: { status: 'ready' }, include: { station: true, stages: true, assets: true } })
    return { done: true, episode: done }
  }

  // mark running
  await db.stageRun.update({
    where: { id: next.id },
    data: { status: 'running', startedAt: new Date(), error: null },
  })

  let result: RunnerResult
  try {
    result = await runners[next.key as StageKey]({ ep })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await db.stageRun.update({
      where: { id: next.id },
      data: { status: 'failed', finishedAt: new Date(), error: msg.slice(0, 1000) },
    })
    await db.episode.update({ where: { id }, data: { status: 'failed' } })
    ep = await loadEpisode(id)
    return {
      done: true,
      episode: ep!,
      lastStage: { key: next.key, status: 'failed', error: msg.slice(0, 300) },
    }
  }

  await db.stageRun.update({
    where: { id: next.id },
    data: {
      status: result.done ? 'done' : 'running',
      finishedAt: result.done ? new Date() : null,
      outputJson: JSON.stringify(result.output),
      ms: result.done ? Date.now() - (next.startedAt?.getTime() ?? Date.now()) : null,
    },
  })

  ep = await loadEpisode(id)
  const allDone = ep!.stages.every((s) => s.status === 'done')
  if (allDone) {
    ep = await db.episode.update({ where: { id }, data: { status: 'ready' }, include: { station: true, stages: true, assets: true } })
    return { done: true, episode: ep, lastStage: { key: next.key, status: 'done', output: result.output } }
  }
  return { done: false, episode: ep!, lastStage: { key: next.key, status: result.done ? 'done' : 'running', output: result.output } }
}

export async function createStagesForEpisode(episodeId: string) {
  await db.stageRun.createMany({
    data: STAGE_DEFS.map((d, i) => ({
      episodeId,
      order: i,
      key: d.key,
      name: d.name,
      status: 'pending' as const,
    })),
  })
}

// ── Autonomous server-side runner (the A1 promise, owned by the server) ──────
type RunnerRegistry = Map<string, true>
const g = globalThis as unknown as { __rfRunners?: RunnerRegistry }
const registry: RunnerRegistry = (g.__rfRunners ??= new Map())

async function retryFailedStageOnce(episodeId: string): Promise<boolean> {
  const ep = await loadEpisode(episodeId)
  if (!ep) return false
  const failed = ep.stages.find((s) => s.status === 'failed')
  if (!failed) return false
  if (failed.retries >= 2) return false // budget of 2 — transient 429s can eat one
  await db.stageRun.update({
    where: { id: failed.id },
    data: { status: 'pending', error: null, retries: { increment: 1 } },
  })
  await db.episode.update({ where: { id: episodeId }, data: { status: 'running' } })
  return true
}

export function startAutonomousRun(id: string) {
  if (registry.has(id)) return
  registry.set(id, true)
  ;(async () => {
    for (let i = 0; i < 400; i++) {
      try {
        const res = await advanceEpisode(id)
        if (res.done) {
          if (res.episode.status === 'failed') {
            const ok = await retryFailedStageOnce(id)
            if (ok) continue
          }
          break
        }
      } catch (e) {
        console.error('[runner] episode', id, 'error:', e)
        break
      }
    }
  })()
    .catch((e) => console.error('[runner] fatal', id, e))
    .finally(() => registry.delete(id))
}

// Resume orphaned runs (e.g. after a dev-server hot reload) — called by the
// polling GET endpoint so the UI itself revives stalled pipelines.
export async function resumeOrphanedRuns() {
  const running = await db.episode.findMany({
    where: { status: 'running' },
    select: { id: true },
  })
  for (const e of running) {
    if (!registry.has(e.id)) startAutonomousRun(e.id)
  }
}

export function summarizeCost(costJson: string): { units: CostUnits; estUsd: number } {
  const units = parseJson<CostUnits>(costJson, {})
  return { units, estUsd: estimateCost(units) }
}

// ── Channel factory: shared episode creation (API + queue worker) ────────────
export async function createEpisodeForStation(stationId: string, prompt: string) {
  const station = await db.station.findUnique({ where: { id: stationId } })
  if (!station) throw new Error('station not found')

  // quick LLM pass: episode title from concept (cheap, keeps list readable)
  let title = 'Untitled Broadcast'
  try {
    const charter = parseJson<StationCharter>(station.charterJson, {} as StationCharter)
    const r = await llmJson<{ title?: string }>(
      'You name radio episodes. Respond ONLY with JSON {"title": "..."} (max 48 chars, evocative, no quotes inside).',
      `Station: ${station.name} — ${station.tagline} (genre: ${station.genre}). Episode concept: ${prompt || 'standard late-night programming block'}. DJ: ${charter.persona?.name}.`
    )
    if (r?.title) title = String(r.title).slice(0, 60)
  } catch {
    title = prompt ? prompt.slice(0, 48) : 'Late Night Block'
  }

  // seed masked to 31 bits — Prisma Int caps at 2^31−1
  const seed = ((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0) & 0x7fffffff
  const episode = await db.episode.create({
    data: { stationId, title, prompt, status: 'running', seed },
  })
  await createStagesForEpisode(episode.id)
  const full = await db.episode.findUnique({
    where: { id: episode.id },
    include: { station: true, stages: { orderBy: { order: 'asc' } }, assets: true },
  })
  return full!
}

// ── Queue worker: one prompt → a run of episodes, processed sequentially ─────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function runEpisodeToCompletion(id: string): Promise<'ready' | 'failed'> {
  for (let i = 0; i < 500; i++) {
    const res = await advanceEpisode(id)
    if (res.done) {
      if (res.episode.status === 'failed') {
        const ok = await retryFailedStageOnce(id)
        if (ok) continue
        return 'failed'
      }
      return 'ready'
    }
    await sleep(2500)
  }
  return 'failed'
}

async function queueWorkerLoop() {
  for (let i = 0; i < 60; i++) {
    // resume orphaned 'running' items first (e.g. after a dev-server reload),
    // then take the oldest pending one
    let item = await db.queueItem.findFirst({
      where: { status: 'running' },
      orderBy: { createdAt: 'asc' },
    })
    let resuming = true
    if (!item) {
      item = await db.queueItem.findFirst({
        where: { status: 'pending' },
        orderBy: { createdAt: 'asc' },
      })
      resuming = false
    }
    if (!item) break
    if (!resuming) {
      await db.queueItem.update({ where: { id: item.id }, data: { status: 'running' } })
    }
    try {
      let episodeId = item.episodeId
      if (!episodeId) {
        if (!item.stationId) throw new Error('queue item has no station')
        const ep = await createEpisodeForStation(item.stationId, item.prompt)
        episodeId = ep.id
        await db.queueItem.update({ where: { id: item.id }, data: { episodeId } })
      }
      const outcome = await runEpisodeToCompletion(episodeId)
      await db.queueItem.update({
        where: { id: item.id },
        data: {
          status: outcome === 'ready' ? 'done' : 'failed',
          error: outcome === 'ready' ? null : 'episode pipeline failed — see episode cockpit',
        },
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await db.queueItem.update({
        where: { id: item.id },
        data: { status: 'failed', error: msg.slice(0, 300) },
      })
    }
  }
}

const gq = globalThis as unknown as { __rfQueueBusy?: boolean }

// Starts the queue worker if items are pending and no worker is alive.
// Called by API polling paths so the queue self-heals after hot reloads.
export async function ensureQueueWorker() {
  if (gq.__rfQueueBusy) return
  const pending = await db.queueItem.count({ where: { status: { in: ['pending', 'running'] } } })
  if (pending === 0) return
  gq.__rfQueueBusy = true
  queueWorkerLoop()
    .catch((e) => console.error('[queue] worker error:', e))
    .finally(() => { gq.__rfQueueBusy = false })
}
