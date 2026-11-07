// ─── Attribution engine ──────────────────────────────────────────────────────
// Builds ATTRIBUTION.md + the burned-in credits block from the asset ledger.
// Compliance is a pipeline stage, not a promise.

import type { Asset, Episode, Station } from '@prisma/client'

const TOOL_LABELS: Record<string, string> = {
  'zai-image': 'AI image generation (CogView via z-ai-web-dev-sdk)',
  'zai-tts': 'AI speech synthesis (GLM-TTS via z-ai-web-dev-sdk)',
  'zai-video': 'AI image-to-video generation (CogVideoX via z-ai-web-dev-sdk)',
  'synth-engine': 'In-house procedural synthwave DSP engine v2 (TypeScript, this repo)',
  ffmpeg: 'FFmpeg 7.1.5 (local render — assembly, mixing, chrome, loudness)',
  pipeline: 'Automated pipeline (this application)',
}

export function buildCreditsText(station: Station, assetCount: number): string {
  return [
    `${station.name.toUpperCase()} — 100% AI-GENERATED BROADCAST`,
    'MUSIC · VISUALS · MOTION · VOICE — ALL SYNTHESIZED AT RENDER TIME',
    `NO THIRD-PARTY MATERIAL — ${assetCount} ASSETS IN LEDGER`,
  ].join('\n')
}

export function buildAttributionMd(
  station: Station,
  episode: Episode,
  assets: Asset[]
): string {
  const rows = assets
    .map((a, i) => {
      const prompt = a.prompt ? a.prompt.replace(/\|/g, '/').slice(0, 90) : '—'
      const model = a.model || '—'
      return `| ${i + 1} | ${a.role} | ${a.kind} | ${a.tool} | ${model} | ${a.license} | ${prompt} |`
    })
    .join('\n')

  const tools = [...new Set(assets.map((a) => TOOL_LABELS[a.tool] ?? a.tool))].map(
    (t) => `- ${t}`
  ).join('\n')

  return `# ATTRIBUTION — ${station.name} · "${episode.title}"

> Station: **${station.name}** (${station.handle}) — *${station.tagline}*
> Episode prompt: _${episode.prompt || '(station default programming)'}_

## Rights posture: 100% self-generated

**No third-party or copyrighted material is used anywhere in this episode.**
Every audio, visual and text asset was generated at render time by the
automated pipeline recorded in the ledger below. Nothing was scraped,
downloaded, sampled, or reused from external sources. No "fair use" claims
are required or made — there is nothing to attribute to third parties.

## AI disclosure

This episode is an AI-generated broadcast:

- **Music** — procedurally synthesized by an in-house DSP engine written for
  this project (oscillators, envelopes, filters, arrangement; seeded RNG).
- **Voice** — fully synthetic DJ idents (GLM-TTS). No human narrator.
- **Visuals** — AI-generated stills (CogView) plus AI image-to-video motion
  clips (CogVideoX), animated locally with FFmpeg (Ken Burns motion,
  crossfades, broadcast overlays).
- **Copy** — titles, scripts and metadata drafted by an LLM under pipeline
  templates, then fixed up by deterministic code.

## Asset ledger (${assets.length} assets)

| # | Role | Kind | Tool | Model | License | Prompt / note |
|---|------|------|------|-------|---------|---------------|
${rows}

## Tools used

${tools}

## Reproducibility

- Episode render seed: \`${episode.seed}\`
- Rundown, prompts and cost ledger are stored on the episode record.
- Re-running the pipeline with the same seed reproduces the music bit-exactly.
`
}
