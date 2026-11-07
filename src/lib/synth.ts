// ─── Procedural synthwave engine v2 ──────────────────────────────────────────
// Renders a full-length, rights-clean synthwave track as 16-bit stereo WAV.
// v2: seeded lead melody, A/B sections with progression change, beat-synced
// pad pump, station jingle, clap layer, open-hat drive, seeded arrangement.
// Pure math — no samples, no network, no licenses. $0 per call. Seeded → reproducible.

import { EPISODE_TARGET_SEC } from './types'

const SR = 44100

// ── Seeded RNG (mulberry32) ──────────────────────────────────────────────────
export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface SynthSpec {
  bpm: number
  keyRoot: number // midi note of minor root, e.g. 45 = A2
  seed: number
  brightness?: number // 0..1 — filter openness / energy
  variant?: 'A' | 'B' // B-side: swapped progressions + different arp/energy — a DISTINCT track, not a label
}

export interface SynthSection {
  name: string
  atSec: number
}

export interface RenderResult {
  wav: Buffer
  durationSec: number
  bars: number
  bpm: number
  sections: SynthSection[]
}

const midiToFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

// A-section: i – VI – III – VII (Am F C G when root = A)
const PROG_A = [0, -4, 3, -2].map((o) => ({ off: o, minor: [0, 3, 7] }))
// B-section: i – iv – VI – v (Am Dm F Em) — classic synthwave lift
const PROG_B = [0, 5, 8, 7].map((o, i) => ({ off: o, minor: i === 2 ? [0, 4, 7] : [0, 3, 7] }))
// B-side variant tracks flip the two progressions and use a different arp
const ARP_A = [0, 1, 2, 1, 0, 2, 1, 2, 0, 1, 2, 1, 2, 1, 0, 1]
const ARP_B = [2, 0, 1, 0, 2, 1, 0, 1, 2, 0, 1, 0, 1, 2, 1, 2]

export function renderTrack(spec: SynthSpec): RenderResult {
  const bpm = Math.min(126, Math.max(82, spec.bpm))
  const beat = 60 / bpm
  const barSec = 4 * beat
  const variant = spec.variant ?? 'A'
  // B-side derives a stable but distinct seed so the same episode always
  // renders the same B-side, yet its material is audibly different.
  const rng = mulberry32(variant === 'B' ? (spec.seed ^ 0x9e3779b9) >>> 0 : spec.seed)
  const brightness = Math.min(1, (spec.brightness ?? 0.6) + (variant === 'B' ? 0.08 : 0))

  const bars = Math.max(64, Math.ceil((EPISODE_TARGET_SEC - 2.4) / barSec))
  const durSec = bars * barSec + 2.4
  const N = Math.ceil(durSec * SR)

  const L = new Float32Array(N)
  const R = new Float32Array(N)

  const root = spec.keyRoot

  // ── Arrangement (seeded jitter, fractions of total length) ─────────────────
  const jit = (frac: number) =>
    Math.max(2, Math.min(bars - 2, Math.round(bars * frac + (rng() * 2 - 1))))
  const bIntroEnd = 2 + Math.round(rng()) // pad-only + jingle (DJ over this)
  const bBuildEnd = jit(0.16) // lvl 1
  const bLvl2End = jit(0.28) // lvl 2 + lead
  const bBreakEnd = jit(0.34) // breakdown + riser
  const bDropEnd = jit(0.55) // lvl 3 full theme
  const bPullEnd = jit(0.61) // pull-back
  const bBSideEnd = jit(0.84) // B-section (progression change)
  const bLvl2Out = jit(0.91) // lvl 2 out

  const level = new Array<number>(bars).fill(0)
  const inB = new Array<boolean>(bars).fill(false)
  const setLevels = (from: number, to: number, v: number) => {
    for (let b = from; b < Math.min(to, bars); b++) level[b] = v
  }
  setLevels(0, bIntroEnd, 0)
  setLevels(bIntroEnd, bBuildEnd, 1)
  setLevels(bBuildEnd, bLvl2End, 2)
  setLevels(bLvl2End, bBreakEnd, 0)
  setLevels(bBreakEnd, bDropEnd, 3)
  setLevels(bDropEnd, bPullEnd, 1)
  setLevels(bPullEnd, bBSideEnd, 3)
  setLevels(bBSideEnd, bLvl2Out, 2)
  setLevels(bLvl2Out, bars, 1)
  for (let b = bPullEnd; b < bBSideEnd; b++) inB[b] = true

  const sections: SynthSection[] = [
    { name: 'Station ident + jingle', atSec: 0 },
    { name: 'Signal lock — the build', atSec: bIntroEnd * barSec },
    { name: 'Main theme', atSec: bBreakEnd * barSec },
    { name: 'B-side transmission', atSec: bPullEnd * barSec },
    { name: 'Sign-off', atSec: bLvl2Out * barSec },
  ]

  // ── Helpers ────────────────────────────────────────────────────────────────
  const addInto = (
    t0: number,
    lenSec: number,
    gain: number,
    pan: number, // -1..1
    gen: (phase: number, tAbs: number, tRel: number) => number
  ) => {
    const start = Math.max(0, Math.floor(t0 * SR))
    const end = Math.min(N, Math.ceil((t0 + lenSec) * SR))
    const gl = gain * Math.min(1, 1 - pan)
    const gr = gain * Math.min(1, 1 + pan)
    for (let i = start; i < end; i++) {
      const t = i / SR
      const v = gen(t, t, t - t0)
      L[i] += v * gl
      R[i] += v * gr
    }
  }

  const saw = (ph: number) => 2 * (ph - Math.floor(ph + 0.5))
  const sq = (ph: number) => (ph - Math.floor(ph) < 0.5 ? 1 : -1)

  // beat-synced pad pump (ducks right after each kick, recovers ~0.25 beat)
  const pump = (tAbs: number, on: boolean) =>
    on ? 1 - 0.24 * Math.exp(-((tAbs % beat) / (beat * 0.11))) : 1

  // ── Pad: detuned saws, slow attack, LP with slow LFO ──────────────────────
  const padNote = (midi: number, t0: number, len: number, pan: number, detuneCents: number, pumped: boolean) => {
    const f = midiToFreq(midi)
    const cutoff = 700 + 900 * brightness
    const alpha = 1 - Math.exp((-2 * Math.PI * cutoff) / SR)
    let lp = 0
    addInto(t0, len + 1.2, 0.055, pan, (_, ta, tr) => {
      const env =
        tr < 0.9 ? tr / 0.9 : tr < len ? 1 : Math.max(0, 1 - (tr - len) / 1.2)
      if (env <= 0) return 0
      const lfo = 1 + 0.25 * Math.sin(2 * Math.PI * 0.13 * tr)
      const w = saw(f * Math.pow(2, detuneCents / 1200) * tr) * 0.5 + saw(f * tr * 1.003) * 0.5
      lp += alpha * lfo * (w - lp)
      return lp * env * pump(ta, pumped)
    })
  }

  // ── Bass: saw through LP, eighth-note pulse ───────────────────────────────
  const bassNote = (midi: number, t0: number, len: number, accent: boolean) => {
    const f = midiToFreq(midi)
    const cutoff = 300 + 260 * brightness
    const alpha = 1 - Math.exp((-2 * Math.PI * cutoff) / SR)
    let lp = 0
    const g = accent ? 0.34 : 0.26
    addInto(t0, len + 0.1, g, 0, (_, tr) => {
      const env = tr < 0.005 ? tr / 0.005 : Math.exp(-3.2 * tr) * (tr < len ? 1 : 0.4)
      if (env <= 0.001) return 0
      lp += alpha * (saw(f * tr) - lp)
      return lp * env
    })
  }

  // ── Drums ─────────────────────────────────────────────────────────────────
  const kick = (t0: number) => {
    addInto(t0, 0.32, 0.85, 0, (_, tr) => {
      const f = 44 + 116 * Math.exp(-tr * 34)
      return Math.sin(2 * Math.PI * f * tr) * Math.exp(-tr * 11)
    })
    addInto(t0, 0.006, 0.3, 0, (_, tr) => (rng() * 2 - 1) * Math.exp(-tr * 900))
  }

  const hat2 = (t0: number, gain: number, decay = 110) => {
    let prev = 0
    addInto(t0, 0.07, gain, 0.25, (_, tr) => {
      const n = rng() * 2 - 1
      const hp = n - prev
      prev = n
      return hp * Math.exp(-tr * decay)
    })
  }

  const snare = (t0: number) => {
    let prev = 0
    addInto(t0, 0.18, 0.34, -0.1, (_, tr) => {
      const n = rng() * 2 - 1
      const hp = n - prev
      prev = n
      const tone = 0.5 * Math.sin(2 * Math.PI * 185 * tr)
      return (hp * 0.7 + tone) * Math.exp(-tr * 26)
    })
  }

  // clap: 3 quick bandpassed bursts, slightly right
  const clap = (t0: number) => {
    for (let h = 0; h < 3; h++) {
      let prev = 0
      const g = [0.2, 0.15, 0.11][h]
      addInto(t0 + h * 0.013, 0.11, g, 0.12, (_, tr) => {
        const n = rng() * 2 - 1
        const hp = n - prev
        prev = n
        return hp * Math.exp(-tr * 90)
      })
    }
  }

  // ── Arp: 16th-note plucks + ping-pong delay ───────────────────────────────
  const arpPattern = variant === 'B' ? ARP_B : ARP_A
  const pluck = (midi: number, t0: number, gain: number, pan: number, brightBoost = 0, pumped = false) => {
    const f = midiToFreq(midi)
    const cutoff = 1400 + 2200 * Math.min(1, brightness + brightBoost)
    const alpha = 1 - Math.exp((-2 * Math.PI * cutoff) / SR)
    let lp = 0
    addInto(t0, 0.16, gain, pan, (_, ta, tr) => {
      const env = Math.exp(-tr * 22)
      lp += alpha * (sq(f * tr) * 0.4 + saw(f * tr) * 0.6 - lp)
      return lp * env * pump(ta, pumped)
    })
  }

  // ── Lead: dual detuned saws, vibrato, echo — the seeded melody hook ───────
  const leadNote = (midi: number, t0: number, len: number, gain: number, pumped: boolean) => {
    const f = midiToFreq(midi)
    const cutoff = 1700 + 1700 * brightness
    const alpha = 1 - Math.exp((-2 * Math.PI * cutoff) / SR)
    let lp = 0
    const voice = (cents: number, t: number, tr: number) => {
      const ff = f * Math.pow(2, cents / 1200)
      const vib = tr > 0.12 ? 1 + 0.0035 * Math.sin(2 * Math.PI * 5.2 * tr) : 1
      const w = saw(ff * vib * tr) * 0.6 + sq(ff * vib * tr * 0.5) * 0.4
      lp += alpha * (w - lp)
      return lp
    }
    addInto(t0, len + 0.25, gain, 0, (_, ta, tr) => {
      const env =
        tr < 0.008 ? tr / 0.008 : tr < len ? 0.55 + 0.45 * Math.exp(-tr * 1.8) : Math.max(0, (1 - (tr - len) / 0.22) * 0.5)
      if (env <= 0) return 0
      return (voice(-6, ta, tr) + voice(6, ta, tr)) * 0.5 * env * pump(ta, pumped)
    })
    // dotted-eighth echo
    addInto(t0 + beat * 0.75, len + 0.25, gain * 0.32, -0.15, (_, ta, tr) => {
      const env = tr < 0.008 ? tr / 0.008 : tr < len ? 0.5 * Math.exp(-tr * 2.4) : 0
      if (env <= 0) return 0
      return (voice(-6, ta, tr) + voice(6, ta, tr)) * 0.5 * env * pump(ta, pumped)
    })
  }

  // ── Melody generator: 2-bar phrases from the minor scale, call/response ────
  const SCALE = [0, 2, 3, 5, 7, 8, 10, 12, 14, 15] // natural minor, 1.5 octaves
  const genPhrase = (): { deg: number; tSec: number; lenSec: number }[] => {
    const notes: { deg: number; tSec: number; lenSec: number }[] = []
    let deg = 2 + Math.floor(rng() * 4)
    let t = 0
    const phraseLen = 2 * barSec
    while (t < phraseLen - 0.2) {
      const roll = rng()
      if (roll < 0.22) { // rest
        const rt = beat * (rng() < 0.5 ? 0.5 : 1)
        t += rt
        continue
      }
      const step = [-2, -1, -1, 1, 1, 2, 3][Math.floor(rng() * 7)]
      deg = Math.max(0, Math.min(SCALE.length - 1, deg + step))
      const lenBeats = [0.5, 0.75, 1, 1, 1.5, 2][Math.floor(rng() * 6)]
      const lenSec = Math.min(lenBeats * beat, phraseLen - t)
      if (lenSec < 0.1) break
      notes.push({ deg, tSec: t, lenSec })
      t += lenSec + (rng() < 0.3 ? beat * 0.5 : 0)
    }
    return notes
  }
  // pre-roll phrases (deterministic per seed)
  const phrases: { deg: number; tSec: number; lenSec: number }[][] = []
  for (let p = 0; p < Math.ceil(bars / 2) + 2; p++) phrases.push(genPhrase())

  // ── Jingle: station ident stinger (before first beat) ─────────────────────
  const jingle = (t0: number) => {
    // sub hit
    addInto(t0, 0.6, 0.5, 0, (_, tr) => {
      const f = 62 * Math.exp(-tr * 2.2) + 40
      return Math.sin(2 * Math.PI * f * tr) * Math.exp(-tr * 3.4)
    })
    // 4-note rising arp stab (root chord, bright, echoed)
    const stab = [root + 24, root + 27, root + 31, root + 36]
    stab.forEach((m, i) => {
      const tt = t0 + 0.15 + i * 0.22
      pluck(m, tt, 0.3, i % 2 === 0 ? -0.2 : 0.2, 0.5, false)
      pluck(m, tt + beat * 0.75, 0.13, i % 2 === 0 ? 0.25 : -0.25, 0.5, false)
    })
    // pad swell underneath
    padNote(root + 12, t0, 3.2, 0, 8, false)
    padNote(root + 19, t0, 3.2, 0.2, -8, false)
  }
  jingle(0.45)

  // ── Render each bar ────────────────────────────────────────────────────────
  // Variant B flips the harmonic worlds: PROG_B is the main lane, PROG_A the
  // lift — plus an octave-up bass answer every 4th bar for a distinct identity.
  const mainProg = variant === 'B' ? PROG_B : PROG_A
  const liftProg = variant === 'B' ? PROG_A : PROG_B
  const sixteenth = beat / 4
  for (let b = 0; b < bars; b++) {
    const t0 = b * barSec
    const prog = inB[b] ? liftProg : mainProg
    const ci = b % 4
    const cRoot = root + prog[ci].off
    const notes = prog[ci].minor.map((iv) => cRoot + 12 + iv)
    const lvl = level[b]
    const pumped = lvl >= 2

    // pad every bar (two octaves, panned)
    for (let n = 0; n < notes.length; n++) {
      padNote(notes[n], t0, barSec * 0.98, (n - 1) * 0.35, n % 2 === 0 ? -6 : 6, pumped)
      padNote(notes[n] + 12, t0, barSec * 0.98, -(n - 1) * 0.3, n % 2 === 0 ? 7 : -7, pumped)
    }

    // bass eighths (+ octave-up answer on the 4th bar of variant B)
    for (let e = 0; e < 8; e++) {
      const accent = e % 4 === 0
      bassNote(cRoot, t0 + e * beat * 0.5, beat * 0.42, accent)
      if (variant === 'B' && b % 4 === 3 && e % 2 === 1) {
        bassNote(cRoot + 12, t0 + e * beat * 0.5, beat * 0.3, false)
      }
    }

    if (lvl >= 1) {
      for (let k = 0; k < 4; k++) kick(t0 + k * beat)
      for (let k = 0; k < 4; k++) hat2(t0 + k * beat + beat / 2, 0.16)
    }
    if (lvl >= 2) {
      snare(t0 + beat)
      snare(t0 + 3 * beat)
      clap(t0 + beat)
      clap(t0 + 3 * beat)
    }
    if (lvl >= 3) {
      for (let s = 0; s < 16; s++) {
        if (s % 2 === 1) hat2(t0 + s * sixteenth, 0.07) // ghost 16ths
      }
      hat2(t0 + beat / 2, 0.09, 26) // open-hat offbeat drive
    }

    // arp from lvl 1
    if (lvl >= 1) {
      const tones = lvl >= 2 ? [...notes, ...notes.map((x) => x + 12)] : notes
      for (let s = 0; s < 16; s++) {
        const deg = arpPattern[s] % tones.length
        const pan = s % 2 === 0 ? -0.3 : 0.3
        pluck(tones[deg], t0 + s * sixteenth, 0.13, pan, 0, pumped)
        pluck(tones[deg], t0 + s * sixteenth + 3 * sixteenth, 0.05, -pan, 0, pumped)
      }
    }

    // lead melody on lvl >= 2 (call/response over 2-bar phrases)
    if (lvl >= 2 && b % 2 === 0) {
      const phrase = phrases[b / 2]
      const response = (b / 2) % 2 === 1
      const g = response ? 0.055 : 0.1 // quieter on response phrases
      const maxNotes = response ? 2 : 99
      phrase.slice(0, maxNotes).forEach((n) => {
        const midi = root + 24 + SCALE[n.deg]
        leadNote(midi, t0 + n.tSec, n.lenSec * 0.92, g, pumped)
      })
    }
  }

  // ── Riser over breakdown into the drop ────────────────────────────────────
  const riserStart = bLvl2End * barSec
  const riserLen = Math.max(2, bBreakEnd - bLvl2End) * barSec
  let prevN = 0
  addInto(riserStart, riserLen, 0.26, 0, (_, tr) => {
    const p = tr / riserLen
    const n = rng() * 2 - 1
    const hp = n - prevN
    prevN = n
    return hp * p * p * 2.2
  })

  // ── Master: global fade in/out, soft clip, normalize ──────────────────────
  const fadeS = Math.floor(0.6 * SR)
  const outFadeS = Math.floor(2.4 * SR)
  for (let i = 0; i < N; i++) {
    let l = L[i]
    let r = R[i]
    if (i < fadeS) {
      const g = i / fadeS
      l *= g
      r *= g
    }
    const toEnd = N - i
    if (toEnd < outFadeS) {
      const g = toEnd / outFadeS
      l *= g
      r *= g
    }
    L[i] = Math.tanh(1.2 * l) * 0.85
    R[i] = Math.tanh(1.2 * r) * 0.85
  }
  let peak = 0
  for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]))
  if (peak > 0.95) {
    const g = 0.95 / peak
    for (let i = 0; i < N; i++) {
      L[i] *= g
      R[i] *= g
    }
  }

  return { wav: encodeWav(L, R, SR), durationSec: durSec, bars, bpm, sections }
}

// ── Intro sting (#26): 2.8s procedural broadcast opener ─────────────────────
// Risers + sub-drop + impact + key-locked shimmer, all pure math ($0, seeded).
// Sits at t=0 before the DJ's first ident; the voice bus ducks the bed under it.
export function renderSting(spec: { seed: number; keyRoot: number; bpm?: number }): { wav: Buffer; durationSec: number } {
  const rng = mulberry32(spec.seed >>> 0)
  const durSec = 2.8
  const N = Math.round(durSec * SR)
  const L = new Float32Array(N)
  const R = new Float32Array(N)

  // 1 — filtered-noise riser: rises in pitch/level across the first 2.1s
  for (let i = 0; i < N; i++) {
    const t = i / SR
    if (t > 2.1) break
    const p = t / 2.1
    const f = 180 + 2400 * p * p
    // crude bandpassed noise: noise * sine at f, amplitude ramps with p²
    const ph = 2 * Math.PI * f * t
    const carrier = Math.sin(ph) * 0.5 + Math.sin(ph * 1.5) * 0.25 + (rng() * 2 - 1) * 0.25
    const amp = 0.34 * p * p
    L[i] += carrier * amp * (0.8 + 0.2 * rng())
    R[i] += carrier * amp * (0.8 + 0.2 * rng())
  }

  // 2 — sub drop: 110 Hz → 41 Hz exponential, lands with the impact
  for (let i = 0; i < N; i++) {
    const t = i / SR
    const p = Math.min(1, t / 2.2)
    const f = 110 * Math.pow(41 / 110, p)
    const env = 0.5 * Math.min(1, t / 0.08) * (1 - 0.35 * p)
    const v = Math.sin(2 * Math.PI * f * t) * env
    L[i] += v
    R[i] += v
  }

  // 3 — impact at 2.2s: pitch-dropping kick body + noise transient
  const impactAt = 2.2
  for (let i = 0; i < N; i++) {
    const t = i / SR - impactAt
    if (t < 0) continue
    const f = 120 * Math.exp(-t * 9) + 42
    const env = Math.exp(-t * 3.2)
    const v = Math.sin(2 * Math.PI * f * t) * env * 0.9
    L[i] += v
    R[i] += v * 0.94
    // click transient
    if (t < 0.05) {
      const c = (rng() * 2 - 1) * Math.exp(-t * 90) * 0.5
      L[i] += c
      R[i] += c
    }
  }

  // 4 — key-locked shimmer: root + fifth + octave arpeggio bounces after the hit
  const rootF = midiToFreq(spec.keyRoot + 12)
  const notes = [rootF, rootF * 1.5, rootF * 2, rootF * 1.5]
  for (let i = 0; i < N; i++) {
    const t = i / SR
    if (t < impactAt) continue
    const lt = t - impactAt
    const idx = Math.floor(lt / 0.15) % notes.length
    const nt = lt - Math.floor(lt / 0.15) * 0.15
    const env = Math.exp(-nt * 16) * Math.min(1, lt / 0.02) * (1 - lt / 0.6)
    if (env <= 0) continue
    const v = Math.sin(2 * Math.PI * notes[idx] * t) * env * 0.16
    const pan = idx % 2 === 0 ? 0.9 : 0.4
    L[i] += v * pan
    R[i] += v * (1.3 - pan)
  }

  // master: soft-clip + peak-normalize
  let peak = 0
  for (let i = 0; i < N; i++) {
    L[i] = Math.tanh(1.1 * L[i])
    R[i] = Math.tanh(1.1 * R[i])
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]))
  }
  if (peak > 0.9) {
    const g = 0.9 / peak
    for (let i = 0; i < N; i++) { L[i] *= g; R[i] *= g }
  }

  return { wav: encodeWav(L, R, SR), durationSec: durSec }
}

// ── WAV encoder (16-bit PCM stereo) ──────────────────────────────────────────
export function encodeWav(L: Float32Array, R: Float32Array, sampleRate: number): Buffer {
  const n = L.length
  const dataBytes = n * 2 * 2
  const buf = Buffer.alloc(44 + dataBytes)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataBytes, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(2, 22) // stereo
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 4, 28)
  buf.writeUInt16LE(4, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataBytes, 40)
  let o = 44
  for (let i = 0; i < n; i++) {
    const l = Math.max(-1, Math.min(1, L[i]))
    const r = Math.max(-1, Math.min(1, R[i]))
    buf.writeInt16LE((l < 0 ? l * 0x8000 : l * 0x7fff) | 0, o)
    buf.writeInt16LE((r < 0 ? r * 0x8000 : r * 0x7fff) | 0, o + 2)
    o += 4
  }
  return buf
}

// Map a key string like "A minor" to a midi root (octave 2)
export function keyToRoot(key: string): number {
  const notes: Record<string, number> = {
    C: 48, 'C#': 49, Db: 49, D: 50, 'D#': 51, Eb: 51, E: 52, F: 53,
    'F#': 54, Gb: 54, G: 55, 'G#': 56, Ab: 56, A: 57, 'A#': 58, Bb: 58, B: 59,
  }
  const m = key.match(/([A-G][#b]?)/i)
  const base = m ? notes[m[1][0].toUpperCase() + (m[1][1] ?? '')] : 57
  return base - 12 // down an octave → A2 = 45
}
