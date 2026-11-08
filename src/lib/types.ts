// ─── Shared domain types for the AI Radio Foundry ────────────────────────────

export interface StationCharter {
  name: string
  tagline: string
  genre: string
  vibe: string
  palette: string[] // hex colors, 4-6
  persona: {
    name: string // DJ on-air name
    style: string // how the DJ talks
    catchphrase: string
  }
  visualStyle: string // THE style-lock sentence prepended to every image prompt
  identScripts: {
    intro: string // spoken at 0:04
    mid: string // spoken at midpoint
    outro: string // spoken at the end
  }
  formatNotes: string
}

export interface EpisodeRundown {
  title: string
  trackTitle: string
  tracks: { title: string; atSec: number }[] // A-side/B-side (drives ticker + now-playing)
  bpm: number // 84-118
  key: string // e.g. "A minor"
  mood: string
  scenePrompts: string[] // exactly 4 scene image prompts (no text in image)
  idents: { atSec: number; script: string }[] // 3 idents w/ placement
  chapters: { t: string; label: string }[] // 4-6 youtube chapters
}

export interface MetadataPack {
  youtubeTitle: string
  youtubeDescription: string
  tags: string[]
  chapters: { t: string; label: string }[]
  disclosure: string
}

export interface QcItem {
  id: string
  label: string
  points: number
  earned: number
  detail: string
}

// A frame grabbed from the finished master as evidence — shown in the UI
// next to the VLM verdicts so every QC claim has a visual receipt.
export interface QcFrame {
  tag: string // chrome | endcard | filmstrip
  path: string // URL path under /public
  atSec: number
  note?: string // the VLM verdict tied to this exact frame
  ok?: boolean // verdict outcome for the checked frames
}

export interface QcReport {
  score: number
  total: number
  passed: boolean
  items: QcItem[]
  revisable: string[] // item ids that an auto-revise pass can attempt
  revised?: boolean // true if an auto-revise pass re-rendered + rescored
  vlmNotes?: string[] // perceptual review verdicts
  vlmCalls?: number
  frames?: QcFrame[] // frame evidence receipts (persists on disk)
  probe: {
    width?: number
    height?: number
    durationSec?: number
    lufs?: number
  }
}

export interface CostUnits {
  llm?: number
  image?: number
  vlm?: number
  ttsChars?: number
  video?: number // i2v clips
  ffmpegSec?: number
}

export const EPISODE_TARGET_SEC = 156 // 2:36 — Ship Gate requires ≥ 2:30
export const SCENE_COUNT = 4
export const SEGMENT_SEC = 8
export const XFADE_SEC = 1
export const LOOP_SEC = (SCENE_COUNT + 1) * SEGMENT_SEC - SCENE_COUNT * XFADE_SEC // 36s seamless cycle
