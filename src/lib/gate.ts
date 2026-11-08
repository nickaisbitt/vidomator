export interface GateItem {
  id: string
  title: string
  detail: string
  points: number
  automated: boolean // measured by the QC stage?
}

export const SHIP_GATE: GateItem[] = [
  { id: 'S1', title: 'Broadcast length', detail: 'Episode ≥ 2:30 — long enough to be a real "episode", short enough to stay cheap.', points: 15, automated: true },
  { id: 'S2', title: 'Loudness spec', detail: '−14 LUFS ±2 (YouTube normalization target), true peak ≤ −1 dBTP.', points: 10, automated: true },
  { id: 'S3', title: 'Radio grammar', detail: 'Sounds like a STATION: DJ idents at intro/mid/outro, music blocks between.', points: 5, automated: true },
  { id: 'V1', title: 'Seamless 1080p motion master', detail: '1920×1080, rotating varied motion blocks (ken-burns + AI i2v), chained crossfades — freeze-measured: no static segment ≥ 3s anywhere in the episode.', points: 15, automated: true },
  { id: 'V2', title: 'Broadcast chrome + perceptual review', detail: 'Station bug, ON AIR lamp, scrolling ticker, VU meter, progress bar, DJ lower-thirds — verified legible by VLM frame review.', points: 10, automated: true },
  { id: 'P1', title: 'SEO metadata pack', detail: 'Title, description, 12+ tags, chapters — generated and copy-paste ready.', points: 10, automated: true },
  { id: 'P2', title: 'Designed thumbnail', detail: '1280×720 branded thumbnail — hero art + station typography + palette (not a frame grab).', points: 10, automated: true },
  { id: 'C1', title: 'Attribution ledger', detail: 'Every asset has tool, model, prompt, license. ATTRIBUTION.md auto-built.', points: 10, automated: true },
  { id: 'C2', title: 'AI disclosure + YPP safety', detail: 'Disclosure guaranteed in description + full-screen AI end card, verified by pointed VLM review + brightness check.', points: 10, automated: true },
  { id: 'A1', title: 'One-prompt automation', detail: 'Prompt in → finished episode out, zero manual steps.', points: 5, automated: true },
  { id: 'B1', title: 'QC self-score', detail: 'ffprobe + R128 measurements, evidence attached to every point.', points: 5, automated: true },
  { id: 'B2', title: 'Reproducible', detail: 'Seeded music render + stored prompts; re-run gives same audio.', points: 5, automated: true },
]

export const GATE_TOTAL = SHIP_GATE.reduce((s, i) => s + i.points, 0) // 110
export const GATE_PASS = 90
