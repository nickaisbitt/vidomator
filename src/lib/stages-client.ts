// Client-safe stage list (mirrors STAGE_DEFS in lib/pipeline.ts without
// pulling server-only imports into the client bundle)
export const STAGE_LIST = [
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
