// ─── AI layer: thin, typed wrappers over z-ai-web-dev-sdk + cost ledger ──────
// Every call increments cost units so the pipeline can enforce budgets.

import ZAI from 'z-ai-web-dev-sdk'
import type { CostUnits } from './types'

let _zai: ZAI | null = null

export async function getAI(): Promise<ZAI> {
  if (!_zai) _zai = await ZAI.create()
  return _zai
}

// Conservative per-unit estimate in USD (for display only)
export const COST_RATES: Record<keyof CostUnits, number> = {
  llm: 0.006, // per call
  image: 0.02, // per image
  vlm: 0.006, // per call
  ttsChars: 0.000004, // per character
  video: 0.06, // per i2v clip
  ffmpegSec: 0.0, // local compute, free
}

export function estimateCost(units: CostUnits): number {
  return (
    (units.llm ?? 0) * COST_RATES.llm +
    (units.image ?? 0) * COST_RATES.image +
    (units.vlm ?? 0) * COST_RATES.vlm +
    (units.ttsChars ?? 0) * COST_RATES.ttsChars +
    (units.video ?? 0) * COST_RATES.video +
    (units.ffmpegSec ?? 0) * COST_RATES.ffmpegSec
  )
}

// ── Budget guard ─────────────────────────────────────────────────────────────
export const BUDGET_CAPS: CostUnits & { ttsCalls: number } = {
  llm: 10,
  image: 9,
  vlm: 10,
  ttsChars: 2500,
  ttsCalls: 6,
  video: 2, // i2v motion clips per episode (the biggest quality lever, capped)
  ffmpegSec: 0,
}

export function assertBudget(units: CostUnits, unit: keyof CostUnits, n = 1) {
  const used = units[unit] ?? 0
  const cap = BUDGET_CAPS[unit] ?? Infinity
  if (used + n > cap) {
    throw new Error(
      `Cost guard tripped: ${unit} budget ${cap} exceeded (used ${used}).`
    )
  }
}

export function addUnits(units: CostUnits, delta: CostUnits): CostUnits {
  return {
    llm: (units.llm ?? 0) + (delta.llm ?? 0),
    image: (units.image ?? 0) + (delta.image ?? 0),
    vlm: (units.vlm ?? 0) + (delta.vlm ?? 0),
    ttsChars: (units.ttsChars ?? 0) + (delta.ttsChars ?? 0),
    video: (units.video ?? 0) + (delta.video ?? 0),
    ffmpegSec: (units.ffmpegSec ?? 0) + (delta.ffmpegSec ?? 0),
  }
}

// ── 429 back-off wrapper: shared rate limits need patience, not blind retries ─
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function withBackoff<T>(fn: () => Promise<T>, opts?: { attempts?: number; label?: string }): Promise<T> {
  const attempts = opts?.attempts ?? 5
  const waits = [30_000, 60_000, 120_000, 180_000] // patient: quota windows can be minutes long
  let lastErr: unknown
  for (let a = 0; a < attempts; a++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      const msg = String(e)
      const rateLimited = /429|too many|rate/i.test(msg)
      if (!rateLimited || a === attempts - 1) throw e
      const wait = waits[Math.min(a, waits.length - 1)]
      console.warn(`[ai] ${opts?.label ?? 'call'} rate-limited — backing off ${wait / 1000}s (attempt ${a + 1}/${attempts})`)
      await sleep(wait)
    }
  }
  throw lastErr
}

// ── LLM: JSON-typed completion with tolerant parsing + 1 retry ───────────────
function extractJson(raw: string): unknown {
  const trimmed = raw.trim()
  // strip markdown fences if present
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : trimmed
  const start = Math.min(
    ...[body.indexOf('{'), body.indexOf('[')].filter((i) => i >= 0)
  )
  const jsonStart = Number.isFinite(start) ? start : 0
  return JSON.parse(body.slice(jsonStart))
}

export async function llmJson<T>(
  system: string,
  user: string,
  opts?: { temperature?: number; maxTokens?: number; backoffAttempts?: number }
): Promise<T> {
  const zai = await getAI()
  const messages = [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ]
  const attempt = async () => {
    const res = await zai.chat.completions.create({
      messages,
      thinking: { type: 'disabled' },
      temperature: opts?.temperature ?? 0.8,
      ...(opts?.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    })
    const content: string = res?.choices?.[0]?.message?.content ?? ''
    return extractJson(content) as T
  }
  try {
    return await withBackoff(attempt, { label: 'llm', attempts: opts?.backoffAttempts })
  } catch {
    // one plain retry — models occasionally wrap JSON loosely
    return await attempt()
  }
}

export async function llmText(
  system: string,
  user: string,
  opts?: { temperature?: number }
): Promise<string> {
  const zai = await getAI()
  const res = await zai.chat.completions.create({
    messages: [
      { role: 'system' as const, content: system },
      { role: 'user' as const, content: user },
    ],
    thinking: { type: 'disabled' },
    temperature: opts?.temperature ?? 0.8,
  })
  return res?.choices?.[0]?.message?.content ?? ''
}

// ── Image generation ─────────────────────────────────────────────────────────
export type ImageSize =
  | '1024x1024'
  | '768x1344'
  | '864x1152'
  | '1344x768'
  | '1152x864'
  | '1440x720'
  | '720x1440'

export async function genImage(prompt: string, size: ImageSize): Promise<Buffer> {
  const zai = await getAI()
  const res = await withBackoff(() => zai.images.generations.create({ prompt, size }), { label: 'image' })
  const b64 = res?.data?.[0]?.base64
  if (!b64) throw new Error('Image generation returned no data')
  return Buffer.from(b64, 'base64')
}

// ── TTS: returns WAV bytes ───────────────────────────────────────────────────
export async function ttsWav(
  text: string,
  opts?: { voice?: string; speed?: number }
): Promise<Buffer> {
  const zai = await getAI()
  const res = (await withBackoff(() => zai.audio.tts.create({
    input: text,
    voice: opts?.voice ?? 'tongtong',
    speed: opts?.speed ?? 1.0,
    response_format: 'wav',
    stream: false,
  }), { label: 'tts' })) as Response
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < 1000) throw new Error(`TTS returned suspiciously small audio (${buf.length}b)`)
  return buf
}

// ── i2v video generation: image → CogVideoX clip (async, polled) ──────────
export interface VideoGenResult {
  mp4: Buffer
  model: string
  ms: number
}

export async function genVideoFromImage(
  imageBuffer: Buffer,
  opts: {
    durationSec?: number
    quality?: 'speed' | 'quality'
    onPoll?: (elapsedSec: number, status: string) => void
  } = {}
): Promise<VideoGenResult> {
  const zai = await getAI()
  const dataUrl = `data:image/png;base64,${imageBuffer.toString('base64')}`
  const t0 = Date.now()
  const gen = (await zai.video.generations.create({
    image_url: dataUrl,
    size: '1920x1080',
    duration: opts.durationSec ?? 5,
    quality: opts.quality ?? 'speed',
    fps: 30,
    watermark_enabled: false,
  })) as { id?: string; model?: string; task_status?: string }
  if (!gen?.id) throw new Error('Video generation submission failed')

  for (let i = 0; i < 180; i++) {
    await new Promise((r) => setTimeout(r, 5000))
    const res = (await zai.async.result.query(gen.id)) as {
      task_status?: string
      video_result?: { url: string }[]
      video_url?: string
      url?: string
      video?: string
    }
    const status = res?.task_status ?? 'UNKNOWN'
    opts.onPoll?.((Date.now() - t0) / 1000, status)
    if (status === 'FAIL') throw new Error('Video generation task failed')
    if (status === 'SUCCESS') {
      const url = res.video_result?.[0]?.url ?? res.video_url ?? res.url ?? res.video
      if (!url) throw new Error('Video generation succeeded but returned no URL')
      const mp4 = Buffer.from(await (await fetch(url)).arrayBuffer())
      if (mp4.length < 20_000) throw new Error(`Video download suspiciously small (${mp4.length}b)`)
      return { mp4, model: gen.model ?? 'cogvideox-3', ms: Date.now() - t0 }
    }
  }
  throw new Error('Video generation timed out (15 min)')
}

// ── VLM style check ──────────────────────────────────────────────────────────
export interface VlmVerdict {
  match: boolean
  reason: string
}

export async function vlmCheck(
  imageDataUrl: string,
  question: string
): Promise<VlmVerdict> {
  const zai = await getAI()
  const res = await withBackoff(() => zai.chat.completions.createVision({
    model: 'glm-4.5v',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: `${question}\nRespond with ONLY a JSON object: {"match": boolean, "reason": "one short sentence"}` },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ],
      },
    ],
    thinking: { type: 'disabled' },
  }), { label: 'vlm' })
  const content: string = res?.choices?.[0]?.message?.content ?? ''
  try {
    const parsed = extractJson(content) as VlmVerdict
    return { match: Boolean(parsed.match), reason: String(parsed.reason ?? '') }
  } catch {
    return { match: true, reason: 'unparseable verdict — accepted by default' }
  }
}
