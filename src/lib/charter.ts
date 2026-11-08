// ─── Station Identity Engine ─────────────────────────────────────────────────
// One prompt in → complete Station Charter out (name, palette, persona,
// visual style lock, ident scripts). This is the creative brain of the product.

import { llmJson } from './ai'
import type { StationCharter } from './types'

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

interface RawCharter {
  name?: string
  tagline?: string
  genre?: string
  vibe?: string
  palette?: string[]
  persona?: { name?: string; style?: string; catchphrase?: string }
  visualStyle?: string
  identScripts?: { intro?: string; mid?: string; outro?: string }
  formatNotes?: string
}

export async function generateCharter(prompt: string): Promise<{
  charter: StationCharter
  name: string
  tagline: string
  genre: string
  palette: string[]
  handle: string
}> {
  const raw = await llmJson<RawCharter>(
    'You are a legendary broadcast brand strategist + creative director who designs iconic radio station identities (think: Masters of Prophecy, Lofi Girl). Respond with ONLY valid JSON.',
    `Design a fictional AI-native radio station brand from this creative brief:
"${prompt}"

Return JSON with EXACTLY this shape:
{
  "name": "station name, 2-4 words, iconic, brandable (max 36 chars)",
  "tagline": "one-line slogan (max 70 chars)",
  "genre": "music genre lane (e.g. 'synthwave / dystopian oracle')",
  "vibe": "3-6 words describing the world this station lives in",
  "palette": ["exactly 5 hex colors, cohesive, high contrast on dark"],
  "persona": {
    "name": "DJ on-air name",
    "style": "how the DJ talks: 1 sentence, distinctive voice",
    "catchphrase": "signature sign-on/sign-off line"
  },
  "visualStyle": "ONE dense style-lock sentence (30-45 words) for AI image generation: subject matter, lighting, color mood, camera, era, texture. Must be highly repeatable across many images. Never mention text/letters.",
  "identScripts": {
    "intro": "spoken intro ident, 2 sentences, in persona, mentions station name",
    "mid": "spoken mid-roll ident, 1 sentence, in persona",
    "outro": "spoken outro with catchphrase, 2 sentences"
  },
  "formatNotes": "1 sentence on the show format"
}`,
    { temperature: 0.95 }
  )

  // ── validate / sanitize ───────────────────────────────────────────────────
  const palette = (Array.isArray(raw.palette) ? raw.palette : [])
    .map((c) => (typeof c === 'string' && HEX_RE.test(c.trim()) ? c.trim() : null))
    .filter((c): c is string => Boolean(c))
    .slice(0, 6)
  while (palette.length < 4) {
    palette.push(['#FF7AC6', '#7AF6FF', '#FFB86B', '#1A1030', '#0B0714'][palette.length])
  }

  const name = String(raw.name || 'Night Oracle').replace(/[\\/:*?"<>|]/g, '').slice(0, 36) || 'Night Oracle'
  const charter: StationCharter = {
    name,
    tagline: String(raw.tagline || 'Signal from the other side of midnight').slice(0, 80),
    genre: String(raw.genre || 'synthwave').slice(0, 60),
    vibe: String(raw.vibe || 'neon midnight').slice(0, 60),
    palette,
    persona: {
      name: String(raw.persona?.name || 'The Oracle').slice(0, 40),
      style: String(raw.persona?.style || 'calm, cryptic, late-night warmth').slice(0, 200),
      catchphrase: String(raw.persona?.catchphrase || 'Stay tuned to the frequency.').slice(0, 120),
    },
    visualStyle:
      String(raw.visualStyle || '').slice(0, 320) ||
      'cinematic neon synthwave night, rain-slick streets, volumetric magenta and cyan light, anamorphic lens, 35mm film grain, moody atmosphere',
    identScripts: {
      intro: String(raw.identScripts?.intro || `You're locked into ${name}. Late signals, low light — let's begin.`).slice(0, 400),
      mid: String(raw.identScripts?.mid || 'Still with me? The night is young.').slice(0, 300),
      outro: String(raw.identScripts?.outro || `${String(raw.persona?.catchphrase || 'Stay tuned to the frequency.')} This is ${name}, signing off.`).slice(0, 400),
    },
    formatNotes: String(raw.formatNotes || 'Music blocks with DJ idents').slice(0, 200),
  }

  // unique handle
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28) || 'station'
  const handle = `${base}-${Math.random().toString(36).slice(2, 6)}`

  return {
    charter,
    name: charter.name,
    tagline: charter.tagline,
    genre: charter.genre,
    palette: charter.palette,
    handle,
  }
}
