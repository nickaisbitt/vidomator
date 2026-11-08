// ─── ffmpeg broadcast assembly v2 ────────────────────────────────────────────
// All heavy lifting is local ffmpeg: mixed ken-burns + i2v motion loops with
// circular xfade, cinematic FX pass (grain/vignette/chromatic aberration),
// broadcast chrome v2 (animated ticker, VU meter, progress bar, DJ lower
// thirds), radio mixing chain (sidechain ducking + R128 loudnorm). $0/render.

import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'

export const FONT_BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
export const FONT_REG = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'

export async function run(
  cmd: string[],
  opts?: { timeoutMs?: number }
): Promise<{ ok: boolean; stderr: string; ms: number }> {
  const t0 = Date.now()
  const timeout = opts?.timeoutMs ?? 300_000
  return new Promise((resolve) => {
    const proc = spawn(cmd[0], cmd.slice(1), { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr?.on('data', (d) => (stderr += d.toString()))
    const killer = setTimeout(() => proc.kill('SIGKILL'), timeout)
    proc.on('close', (code) => {
      clearTimeout(killer)
      resolve({ ok: code === 0, stderr, ms: Date.now() - t0 })
    })
    proc.on('error', (err) => {
      clearTimeout(killer)
      stderr += String(err)
      resolve({ ok: false, stderr, ms: Date.now() - t0 })
    })
  })
}

export interface ProbeResult {
  width?: number
  height?: number
  durationSec?: number
  hasAudio?: boolean
  codec?: string
}

export async function probe(file: string): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v', 'quiet', '-print_format', 'json',
      '-show_format', '-show_streams', file,
    ])
    let out = ''
    proc.stdout?.on('data', (d) => (out += d.toString()))
    const killer = setTimeout(() => proc.kill('SIGKILL'), 30_000)
    proc.on('close', () => {
      clearTimeout(killer)
      try {
        const j = JSON.parse(out)
        const v = (j.streams ?? []).find((s: { codec_type: string }) => s.codec_type === 'video')
        const a = (j.streams ?? []).find((s: { codec_type: string }) => s.codec_type === 'audio')
        resolve({
          width: v?.width,
          height: v?.height,
          durationSec: parseFloat(j.format?.duration ?? '0'),
          hasAudio: Boolean(a),
          codec: v?.codec_name,
        })
      } catch {
        resolve({})
      }
    })
    proc.on('error', () => {
      clearTimeout(killer)
      resolve({})
    })
  })
}

// EBU R128 integrated loudness (YouTube target: −14 LUFS)
export async function measureLoudness(file: string): Promise<number | undefined> {
  const { stderr } = await run([
    'ffmpeg', '-hide_banner', '-i', file,
    '-af', 'loudnorm=print_format=json', '-f', 'null', '-',
  ], { timeoutMs: 120_000 })
  const m = stderr.match(/\{[\s\S]*"input_i"[\s\S]*\}/)
  if (!m) return undefined
  try {
    const j = JSON.parse(m[0])
    const v = parseFloat(j.input_i)
    return Number.isFinite(v) ? v : undefined
  } catch {
    return undefined
  }
}

export async function writeTextFile(file: string, text: string) {
  await fs.writeFile(file, text, 'utf8')
}

// ── Ping-pong: 5s clip → 10s seamless loop (forward + reverse) ──────────────
export async function pingPong(
  clipPath: string,
  outPath: string,
  opts: { fps?: number } = {}
): Promise<{ ok: boolean; log: string; ms: number }> {
  const fps = opts.fps ?? 30
  const r = await run([
    'ffmpeg', '-y', '-i', clipPath,
    '-filter_complex',
    `[0:v]split[fw][rv];[rv]reverse[rr];[fw][rr]concat=n=2:v=1:a=0,` +
    `scale=1920:1080:force_original_aspect_ratio=decrease,` +
    `pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=${fps},setsar=1,format=yuv420p[v]`,
    '-map', '[v]', '-an',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    outPath,
  ], { timeoutMs: 180_000 })
  return { ok: r.ok, log: r.stderr.slice(-1200), ms: r.ms }
}

// ── Pass A: mixed motion loop (ken-burns stills + i2v clips, circular xfade) ─
// TWO-PASS architecture: (1) every segment rendered standalone, (2) chained
// xfade over normalized video files. Multi-input graphs with several raw
// still-image inputs can deadlock ffmpeg's scheduler — standalone segment
// renders are immune and cheap (~2s each).
export interface LoopSegment {
  type: 'kb' | 'clip'
  path: string
  sec: number
  zoomIn?: boolean // ken-burns direction (default: in)
}

export async function buildLoopVideo(
  segments: LoopSegment[],
  outPath: string,
  opts: { xfadeSec: number; fps?: number }
): Promise<{ ok: boolean; log: string; ms: number; loopSec: number }> {
  const fps = opts.fps ?? 30
  const n = segments.length
  if (n < 2) throw new Error('need ≥2 loop segments')
  const workDir = path.dirname(outPath)

  // ── Pass 1: render each segment to a standalone normalized mp4 ───────────
  const segFiles: string[] = []
  for (let i = 0; i < n; i++) {
    const seg = segments[i]
    const segOut = path.join(workDir, `seg-${i}.mp4`)
    let r: { ok: boolean; stderr: string }
    if (seg.type === 'kb') {
      const frames = Math.round(seg.sec * fps)
      const z = seg.zoomIn === false
        ? `1.10-0.10*on/${frames}` // zoom out (tight → wide)
        : `1+0.10*on/${frames}` // zoom in (wide → tight)
      r = await run([
        'ffmpeg', '-y', '-i', seg.path,
        '-filter_complex',
        `[0:v]scale=3840:2160:force_original_aspect_ratio=increase,crop=3840:2160,` +
        `zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':` +
        `d=${frames}:s=1920x1080:fps=${fps},setsar=1,format=yuv420p[v]`,
        '-map', '[v]', '-an',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
        segOut,
      ], { timeoutMs: 120_000 })
    } else {
      r = await run([
        'ffmpeg', '-y', '-i', seg.path,
        '-filter_complex',
        `[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,` +
        `pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=${fps},` +
        `trim=duration=${seg.sec},setpts=PTS-STARTPTS,fps=${fps},setsar=1,format=yuv420p[v]`,
        '-map', '[v]', '-an',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
        segOut,
      ], { timeoutMs: 120_000 })
    }
    if (!r.ok) {
      return { ok: false, log: `segment ${i} (${seg.type}) failed: ${r.stderr.slice(-600)}`, ms: 0, loopSec: 0 }
    }
    segFiles.push(segOut)
  }

  // ── Pass 2: chained xfade over the normalized video files ────────────────
  const args: string[] = ['-y']
  for (const f of segFiles) args.push('-i', f)
  const parts: string[] = []
  segFiles.forEach((_, i) => {
    parts.push(`[${i}:v]settb=AVTB,fps=${fps},format=yuv420p[v${i}]`)
  })
  let last = 'v0'
  let cur = segments[0].sec
  for (let i = 1; i < n; i++) {
    const out = i === n - 1 ? 'vout' : `x${i}`
    parts.push(`[${last}][v${i}]xfade=transition=fade:duration=${opts.xfadeSec}:offset=${(cur - opts.xfadeSec).toFixed(3)}[${out}]`)
    last = out
    cur = cur - opts.xfadeSec + segments[i].sec
  }
  args.push(
    '-filter_complex', parts.join(';'),
    '-map', '[vout]', '-r', String(fps),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    outPath
  )
  const r = await run(['ffmpeg', ...args], { timeoutMs: 300_000 })
  // clean intermediates
  await Promise.all(segFiles.map((f) => fs.rm(f, { force: true }))).catch(() => {})
  return { ok: r.ok, log: r.stderr.slice(-1500), ms: r.ms, loopSec: cur }
}

// ── Pass A2: EPISODE-LENGTH varied visual track ─────────────────────────────
// v6 fix for the "40s loop streamed 4×" monotony: instead of one loop repeated,
// we render the FULL episode as a rotating schedule of segments (ken-burns
// stills in alternating zoom directions + i2v clip replays in new orders).
// Unique kb segments are rendered once (deduped) and reused as inputs, so the
// whole episode costs only a handful of extra local renders. $0, no re-gen.
export async function buildEpisodeVisual(
  segments: LoopSegment[],
  outPath: string,
  opts: { xfadeSec: number; fps?: number }
): Promise<{ ok: boolean; log: string; ms: number; totalSec: number }> {
  const fps = opts.fps ?? 30
  const n = segments.length
  if (n < 2) throw new Error('need ≥2 segments')
  const workDir = path.dirname(outPath)

  // ── Pass 1: render each UNIQUE kb segment once; clips are reused as-is ──
  const rendered = new Map<string, string>() // cacheKey → normalized segment file
  let kbIdx = 0
  for (let i = 0; i < n; i++) {
    const seg = segments[i]
    const key = `${seg.type}|${seg.path}|${seg.sec}|${seg.zoomIn === false ? 'out' : 'in'}`
    if (rendered.has(key)) continue
    const segOut = path.join(workDir, `ev-seg-${kbIdx++}.mp4`)
    let r: { ok: boolean; stderr: string }
    if (seg.type === 'kb') {
      const frames = Math.round(seg.sec * fps)
      const z = seg.zoomIn === false
        ? `1.10-0.10*on/${frames}` // zoom out (tight → wide)
        : `1+0.10*on/${frames}` // zoom in (wide → tight)
      r = await run([
        'ffmpeg', '-y', '-i', seg.path,
        '-filter_complex',
        `[0:v]scale=3840:2160:force_original_aspect_ratio=increase,crop=3840:2160,` +
        `zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':` +
        `d=${frames}:s=1920x1080:fps=${fps},setsar=1,format=yuv420p[v]`,
        '-map', '[v]', '-an',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
        segOut,
      ], { timeoutMs: 120_000 })
    } else {
      r = await run([
        'ffmpeg', '-y', '-i', seg.path,
        '-filter_complex',
        `[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,` +
        `pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=${fps},` +
        `trim=duration=${seg.sec},setpts=PTS-STARTPTS,fps=${fps},setsar=1,format=yuv420p[v]`,
        '-map', '[v]', '-an',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
        segOut,
      ], { timeoutMs: 120_000 })
    }
    if (!r.ok) {
      return { ok: false, log: `segment ${i} (${seg.type}) failed: ${r.stderr.slice(-600)}`, ms: 0, totalSec: 0 }
    }
    rendered.set(key, segOut)
  }

  // ── Pass 2 (chunked): chained xfade, ≤5 inputs at a time ────────────────
  // A single 16-input xfade graph OOM-kills ffmpeg on a 4GB box (16 parallel
  // 1080p decoders). So: chain each CHUNK of segments into a part file, then
  // chain the parts — the memory-heavy decode never exceeds ~5 inputs.
  const logical = segments.map((s) => {
    const key = `${s.type}|${s.path}|${s.sec}|${s.zoomIn === false ? 'out' : 'in'}`
    return rendered.get(key)!
  })
  const CHUNK = 5
  const chunkRanges: [number, number][] = []
  for (let i = 0; i < n; i += CHUNK) chunkRanges.push([i, Math.min(i + CHUNK, n)])

  const chainXfade = async (files: string[], segSecs: number[], outFile: string): Promise<number> => {
    // returns the chained duration; caller owns deleting outFile
    const args: string[] = ['-y']
    for (const f of files) args.push('-i', f)
    const parts: string[] = []
    files.forEach((_, i) => {
      parts.push(`[${i}:v]settb=AVTB,fps=${fps},format=yuv420p[v${i}]`)
    })
    let last = 'v0'
    let cur = segSecs[0]
    for (let i = 1; i < files.length; i++) {
      const out = i === files.length - 1 ? 'vout' : `x${i}`
      parts.push(`[${last}][v${i}]xfade=transition=fade:duration=${opts.xfadeSec}:offset=${(cur - opts.xfadeSec).toFixed(3)}[${out}]`)
      last = out
      cur = cur - opts.xfadeSec + segSecs[i]
    }
    args.push(
      '-filter_complex', parts.join(';'),
      '-map', '[vout]', '-r', String(fps),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      outFile
    )
    const r = await run(['ffmpeg', ...args], { timeoutMs: 600_000 })
    if (!r.ok) throw new Error(`xfade chain failed: ${r.stderr.slice(-600)}`)
    return cur
  }

  const t0 = Date.now()
  try {
    const partFiles: string[] = []
    const partSecs: number[] = []
    for (let c = 0; c < chunkRanges.length; c++) {
      const [from, to] = chunkRanges[c]
      const chunkFiles = logical.slice(from, to)
      const chunkSecs = segments.slice(from, to).map((s) => s.sec)
      if (chunkFiles.length === 1) {
        // single-segment chunk: normalize-copy (keeps tb/fps consistent)
        const outFile = path.join(workDir, `ev-part-${c}.mp4`)
        const r = await run([
          'ffmpeg', '-y', '-i', chunkFiles[0],
          '-vf', `settb=AVTB,fps=${fps},format=yuv420p`,
          '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
          outFile,
        ], { timeoutMs: 300_000 })
        if (!r.ok) throw new Error(`part copy failed: ${r.stderr.slice(-600)}`)
        partFiles.push(outFile)
        partSecs.push(chunkSecs[0])
      } else {
        const outFile = path.join(workDir, `ev-part-${c}.mp4`)
        const dur = await chainXfade(chunkFiles, chunkSecs, outFile)
        partFiles.push(outFile)
        partSecs.push(dur)
      }
    }
    if (partFiles.length === 1) {
      // small episode — the single chunk IS the output
      await fs.rm(outPath, { force: true }).catch(() => {})
      await fs.rename(partFiles[0], outPath).catch(async () => {
        await run(['ffmpeg', '-y', '-i', partFiles[0], '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', outPath], { timeoutMs: 300_000 })
      })
      return { ok: true, log: 'chunked xfade (1 part)', ms: Date.now() - t0, totalSec: partSecs[0] }
    }
    const total = await chainXfade(partFiles, partSecs, outPath)
    await Promise.all(partFiles.map((f) => fs.rm(f, { force: true }))).catch(() => {})
    return { ok: true, log: `chunked xfade (${chunkRanges.length} parts)`, ms: Date.now() - t0, totalSec: total }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, log: msg.slice(0, 1500), ms: 0, totalSec: 0 }
  } finally {
    // clean intermediates
    await Promise.all([...rendered.values()].map((f) => fs.rm(f, { force: true }))).catch(() => {})
  }
}

// ── Freeze detection (honest "is there motion everywhere" evidence) ─────────
export async function detectFreeze(
  videoPath: string,
  opts: { minDurSec?: number; noiseDb?: string; uptoSec?: number } = {}
): Promise<{ ok: boolean; freezes: { start: number; duration: number }[]; ms: number }> {
  const t0 = Date.now()
  const d = opts.minDurSec ?? 3
  const n = opts.noiseDb ?? '-60dB'
  const args = ['-v', 'info', '-i', videoPath]
  if (opts.uptoSec) args.push('-t', String(opts.uptoSec))
  args.push('-vf', `freezedetect=n=${n}:d=${d}`, '-an', '-f', 'null', '-')
  const r = await run(['ffmpeg', ...args], { timeoutMs: 300_000 })
  const freezes: { start: number; duration: number }[] = []
  const starts: number[] = []
  for (const line of r.stderr.split('\n')) {
    const s = line.match(/freeze_start:\s*([\d.]+)/)
    if (s) starts.push(parseFloat(s[1]))
    const e = line.match(/freeze_duration:\s*([\d.]+)/)
    if (e && starts.length) freezes.push({ start: starts.shift() ?? 0, duration: parseFloat(e[1]) })
  }
  return { ok: freezes.length === 0, freezes, ms: Date.now() - t0 }
}

// ── Broadcast chrome v2 ──────────────────────────────────────────────────────
export interface ChromeSpec {
  stationName: string
  tagline: string
  djName: string
  tracks: { title: string; atSec: number }[]
  identAtSec: number[] // DJ lower-third windows
  durationSec: number
  creditsText?: string // legacy small credits box (unused when endCard is set)
  endCard?: { lines: string[]; fromSec: number } // full-screen AI-disclosure finale
  paletteHex: string // accent color, e.g. 0xFF7AC6
  bigText?: boolean // auto-revise mode: larger type + heavier shadows
  beatSec?: number // #23 — 60/bpm; drives tempo-synced blink + intro card timing
  djImagePath?: string // #25 — DJ booth art shown in a side panel while the DJ talks
  callIns?: { atSec: number; name: string; text: string }[] // #27 — fake listener call-ins (lower-thirds)
  introTitle?: boolean // #26 — big station-name title card over the first bars
}

function dt(args: Record<string, string>): string {
  // default to expansion=none: user text (station names, "100% AI-GENERATED")
  // must never hit drawtext's %{...} expression parser. Callers that NEED
  // expansion (the running timecode) pass expansion: 'normal' explicitly.
  const entries = Object.entries({ expansion: 'none', ...args })
  return 'drawtext=fontfile=' + FONT_BOLD + entries
    .map(([k, v]) => `:${k}=${v}`)
    .join('')
}

export async function burnChrome(
  loopPath: string,
  audioPath: string,
  outPath: string,
  chrome: ChromeSpec,
  workDir: string,
  opts: { fps?: number; noLoop?: boolean } = {}
): Promise<{ ok: boolean; log: string; ms: number }> {
  const fps = opts.fps ?? 30
  const D = chrome.durationSec
  const big = chrome.bigText ? 1.28 : 1
  const accent = /^0x[0-9A-Fa-f]{6}$/.test(chrome.paletteHex) ? chrome.paletteHex : '0xFF7AC6'
  // #23 — beat clock from the actual synth BPM: blinks/pulses land on the beat
  const beat = chrome.beatSec && chrome.beatSec > 0.2 && chrome.beatSec < 1.2 ? chrome.beatSec : 0.6
  const hasDjArt = Boolean(chrome.djImagePath)

  // text files (robust against quotes/colons/emoji in names)
  const stnFile = path.join(workDir, 'chrome-station.txt')
  const onairFile = path.join(workDir, 'chrome-onair.txt')
  const djFile = path.join(workDir, 'chrome-dj.txt')
  const tickerFile = path.join(workDir, 'chrome-ticker.txt')
  const trackFiles: string[] = []
  await writeTextFile(stnFile, chrome.stationName.toUpperCase())
  await writeTextFile(onairFile, 'ON AIR')
  await writeTextFile(djFile, `${chrome.djName} — ON THE MIC`)
  await writeTextFile(
    tickerFile,
    `NOW PLAYING · ${chrome.tracks[0]?.title ?? ''} · ${chrome.stationName.toUpperCase()} · ${chrome.tagline} · 100% AI-GENERATED RADIO · `
  )
  for (let i = 0; i < chrome.tracks.length; i++) {
    const f = path.join(workDir, `chrome-track-${i}.txt`)
    await writeTextFile(f, `NOW PLAYING ▸ ${chrome.tracks[i].title}`)
    trackFiles.push(f)
  }

  const fs1 = Math.round(30 * big) // station bug
  const fs2 = Math.round(28 * big) // on air
  const fs3 = Math.round(25 * big) // ticker
  const fs4 = Math.round(34 * big) // now-playing card
  const fs5 = Math.round(26 * big) // dj lower third

  const fx: string[] = [
    // ── cinematic FX on footage FIRST (text stays crisp on top) ──
    `vignette=PI/4.4`,
    `rgbashift=rh=-2:bh=2`,
  ]

  const overlays: string[] = [
    // ── station bug (top-left) ──
    `drawbox=x=40:y=36:w=310:h=${Math.round(56 * big)}:color=black@0.45:t=fill`,
    dt({
      textfile: stnFile, fontsize: String(fs1), fontcolor: 'white@0.95', x: '58', y: '44',
      shadowcolor: 'black@0.75', shadowx: '2', shadowy: '2',
    }),
    `drawbox=x=40:y=${36 + Math.round(56 * big)}:w=310:h=4:color=${accent}@0.95:t=fill`,
    // ── ON AIR badge (top-right) + pulsing dot ──
    `drawbox=x=iw-218:y=36:w=178:h=${Math.round(50 * big)}:color=0xC0392B@0.9:t=fill`,
    dt({ textfile: onairFile, fontsize: String(fs2), fontcolor: 'white', x: 'w-158', y: '42', shadowcolor: 'black@0.6', shadowx: '1', shadowy: '1' }),
    `drawbox=x=iw-206:y=${Math.round(52 * big)}:w=12:h=12:color=white@0.95:t=fill:enable='lt(mod(t,1.4),0.7)'`,
    // ── ticker strip (bottom, full width) + scrolling marquee ──
    `drawbox=x=0:y=h-72:w=iw:h=44:color=black@0.52:t=fill`,
    dt({ textfile: tickerFile, fontsize: String(fs3), fontcolor: 'white@0.9', x: `'w-mod(t*130,w+tw)'`, y: 'h-61', shadowcolor: 'black@0.5', shadowx: '1', shadowy: '1' }),
    // ── track progress bar (very bottom) ──
    `drawbox=x=0:y=h-10:w='iw*t/${D.toFixed(2)}':h=6:color=${accent}@0.85:t=fill`,
    `drawbox=x=0:y=h-12:w=iw:h=2:color=white@0.18:t=fill`,
    // ── running timecode (bottom-right, above ticker) ──
    dt({ text: `'%{pts\\:hms}'`, expansion: 'normal', fontsize: '22', fontcolor: 'white@0.75', x: 'w-tw-40', y: 'h-104', box: '1', boxcolor: 'black@0.4', boxborderw: '8' }),
  ]

  // DJ lower-third at each ident window
  for (const at of chrome.identAtSec) {
    overlays.push(
      `drawbox=x=40:y=h-168:w=${Math.round(360 * big)}:h=${Math.round(52 * big)}:color=black@0.55:t=fill:enable='between(t,${Math.max(0, at - 1.5).toFixed(1)},${(at + 7).toFixed(1)})'`,
      dt({
        textfile: djFile, fontsize: String(fs5), fontcolor: 'white',
        x: '58', y: 'h-158',
        enable: `'between(t,${Math.max(0, at - 1.5).toFixed(1)},${(at + 7).toFixed(1)})'`,
        shadowcolor: 'black@0.7', shadowx: '2', shadowy: '2',
      })
    )
  }

  // now-playing cards at each track start
  chrome.tracks.forEach((tr, i) => {
    const a = (tr.atSec + 3).toFixed(1)
    const b = Math.min(D - 2, tr.atSec + 24).toFixed(1)
    overlays.push(
      `drawbox=x=40:y=h-236:w=${Math.round(500 * big)}:h=${Math.round(56 * big)}:color=${accent}@0.28:t=fill:enable='between(t,${a},${b})'`,
      `drawbox=x=40:y=h-236:w=6:h=${Math.round(56 * big)}:color=${accent}@0.95:t=fill:enable='between(t,${a},${b})'`,
      dt({
        textfile: trackFiles[i], fontsize: String(fs4), fontcolor: 'white',
        x: '62', y: 'h-224',
        enable: `'between(t,${a},${b})'`,
        shadowcolor: 'black@0.7', shadowx: '2', shadowy: '2',
      })
    )
  })

  // credits: full-screen AI end card for the final seconds (W2 fix — the old
  // 21pt box in the corner was effectively invisible; compliance text must be
  // unmissable). Lines are stacked, centered, over a near-black screen.
  if (chrome.endCard?.lines?.length) {
    const from = Math.max(0, chrome.endCard.fromSec)
    const bigFs = Math.round(54 * big)
    const headFs = Math.round(30 * big)
    const smallFs = Math.round(21 * big)
    type CardLine = { f: string; fs: number; color: string; gap: number }
    const cardLines: CardLine[] = []
    for (let i = 0; i < chrome.endCard.lines.length; i++) {
      const f = path.join(workDir, `chrome-endcard-${i}.txt`)
      await writeTextFile(f, chrome.endCard.lines[i])
      const isName = i === 0
      const isHead = !isName && chrome.endCard.lines[i].length <= 42 && chrome.endCard.lines[i] === chrome.endCard.lines[i].toUpperCase()
      const fs = isName ? bigFs : isHead ? headFs : smallFs
      cardLines.push({
        f, fs,
        color: isName ? 'white' : isHead ? 'white@0.95' : 'white@0.78',
        gap: isName ? 26 : isHead ? 22 : 14,
      })
    }
    const totalH = cardLines.reduce((s, l) => s + l.fs + l.gap, 0)
    let y = Math.max(60, Math.round((1080 - totalH) / 2))
    overlays.push(`drawbox=x=0:y=0:w=iw:h=ih:color=black@0.93:t=fill:enable='gte(t,${from.toFixed(1)})'`)
    for (const l of cardLines) {
      overlays.push(
        dt({
          textfile: l.f, fontsize: String(l.fs), fontcolor: l.color,
          x: '(w-tw)/2', y: String(y),
          shadowcolor: 'black@0.8', shadowx: '2', shadowy: '2',
          enable: `'gte(t,${from.toFixed(1)})'`,
        })
      )
      y += l.fs + l.gap
    }
  }

  // The video chain is ONE comma-separated chain; separate graphs join with ';'
  const videoChain = [
    `trim=duration=${D.toFixed(2)}`,
    `setpts=PTS-STARTPTS`,
    ...fx,
    ...overlays,
    // light film grain over everything so text sits in the same "film" space
    `noise=alls=4:allf=t+u`,
    `fade=t=in:st=0:d=1.2,fade=t=out:st=${(D - 1.4).toFixed(2)}:d=1.4,format=yuv420p`,
  ].join(',')

  const filters = [
    `[0:v]${videoChain}[vfx]`,
    // VU meter from the final radio mix — framed + labeled so it reads as
    // deliberate broadcast hardware, not a floating artifact
    `[1:a]asplit=2[au][am]`,
    // mono-mixdown → single clean bar (stereo renders 2 stacked bars)
    `[au]pan=mono|c0=0.5*c0+0.5*c1,showvolume=rate=${fps}:w=250:h=26:t=0:v=0:p=0.62,format=rgba[vu]`,
    `[vfx][vu]overlay=x='main_w-overlay_w-40':y=${Math.round(46 + 52 * big)}:format=auto,` +
      `drawbox=x=iw-298:y=${Math.round(40 + 52 * big)}:w=266:h=42:color=white@0.35:t=2,` +
      dt({ text: `'VU'`, fontsize: '17', fontcolor: 'white@0.75', x: 'w-336', y: String(Math.round(50 + 52 * big)) }) + ',' +
      `format=yuv420p[v]`,
    // defensive: loudnorm can upsample to 192k — aac caps at 96k
    `[am]aresample=48000[aout]`,
  ].join(';')

  const args = [
    '-y',
    ...(opts.noLoop ? [] : ['-stream_loop', '-1']),
    '-i', loopPath,
    '-i', audioPath,
    '-filter_complex', filters,
    '-map', '[v]', '-map', '[aout]',
    '-r', String(fps),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-t', String(D), '-movflags', '+faststart',
    outPath,
  ]
  const r = await run(['ffmpeg', ...args], { timeoutMs: 600_000 })
  return { ok: r.ok, log: r.stderr.slice(-2000), ms: r.ms }
}

// ── Radio mix chain: sidechain ducking + limiter + R128 loudnorm → WAV ──────
export interface IdentPlacement {
  file: string
  atSec: number
}

// trackB: a genuinely DIFFERENT B-side render, crossfaded in at xfadeAtSec —
// no more cosmetic "B-side" labels over one continuous bed (W4 fix).
export interface TrackB {
  path: string
  xfadeAtSec: number
  xfadeDurSec?: number
}

export async function mixRadio(
  musicPath: string,
  idents: IdentPlacement[],
  outPath: string,
  durationSec: number,
  trackB?: TrackB
): Promise<{ ok: boolean; log: string; ms: number }> {
  const t0 = Date.now()
  const D = durationSec
  const parts: string[] = []
  if (trackB && trackB.xfadeAtSec > 8 && trackB.xfadeAtSec < D - 12) {
    // build the dual-track bed: A-side head → acrossfade → B-side tail
    const xf = trackB.xfadeDurSec ?? 5
    const aEnd = trackB.xfadeAtSec + xf
    parts.push(`[0:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${aEnd.toFixed(2)},asetpts=PTS-STARTPTS[aHead]`)
    parts.push(`[1:a]aresample=48000,aformat=channel_layouts=stereo,atrim=${trackB.xfadeAtSec.toFixed(2)},asetpts=PTS-STARTPTS[aTail]`)
    parts.push(`[aHead][aTail]acrossfade=d=${xf}:c1=tri:c2=tri[bed0]`)
    parts.push(`[bed0]apad=whole_dur=${D.toFixed(2)},atrim=duration=${D.toFixed(2)}[bed]`)
  } else {
    parts.push(`[0:a]aresample=48000,aformat=channel_layouts=stereo[bed]`)
  }
  // input indices: 0 = track A, (trackB ? 1 = track B) then idents shift by 1
  const bShift = trackB ? 1 : 0
  const identLabels: string[] = []
  idents.forEach((idt, i) => {
    const delayMs = Math.max(0, Math.round(idt.atSec * 1000))
    parts.push(
      `[${i + 1 + bShift}:a]aresample=48000,aformat=channel_layouts=stereo,` +
      `adelay=${delayMs}|${delayMs},apad=whole_dur=${D}[i${i}]`
    )
    identLabels.push(`[i${i}]`)
  })
  if (identLabels.length > 1) {
    parts.push(`${identLabels.join('')}amix=inputs=${identLabels.length}:duration=longest:normalize=0,volume=1.6[vx0]`)
  } else if (identLabels.length === 1) {
    parts.push(`${identLabels[0]}volume=1.6[vx0]`)
  } else {
    // no idents: silent voice bus
    parts.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${D}[vx0]`)
  }
  parts.push(`[vx0]asplit=2[vx1][vx2]`)
  // NOTE: the bed is consumed ONCE (sidechain key) — two asplit instances in
  // one graph trip an ffmpeg 7.1.5 filtergraph binding bug, so the bed is
  // deliberately NOT split here.
  parts.push(`[bed][vx1]sidechaincompress=threshold=0.03:ratio=8:attack=60:release=550[duck]`)
  // NOTE: no loudnorm here — the pre-mix is mastered in a measured second pass
  parts.push(`[duck][vx2]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.89,afade=t=out:st=${(D - 3.5).toFixed(2)}:d=3.5,aresample=48000[a]`)

  const preMix = outPath + '.pre.wav'
  const mixArgs = [
    '-y', '-i', musicPath,
    ...(trackB ? ['-i', trackB.path] : []),
    ...idents.flatMap((i) => ['-i', i.file]),
    '-filter_complex', parts.join(';'),
    '-map', '[a]', '-c:a', 'pcm_s16le', '-ar', '48000',
    '-t', String(D),
    preMix,
  ]
  const mix = await run(['ffmpeg', ...mixArgs], { timeoutMs: 300_000 })
  if (!mix.ok) return { ok: false, log: mix.stderr.slice(-2000), ms: Date.now() - t0 }

  // ── Two-pass R128 master: measure, then apply with measured values ────────
  // (single-pass loudnorm on dynamic material can miss by 2-3 LU)
  const meas = await run([
    'ffmpeg', '-hide_banner', '-i', preMix,
    '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json',
    '-f', 'null', '-',
  ], { timeoutMs: 180_000 })
  const mj = meas.stderr.match(/\{[\s\S]*"input_i"[\s\S]*\}/)
  let masterArgs: string[]
  if (mj) {
    try {
      const j = JSON.parse(mj[0])
      const mI = parseFloat(j.input_i), mLRA = parseFloat(j.input_lra)
      const mTP = parseFloat(j.input_tp), mTH = parseFloat(j.input_thresh)
      const off = parseFloat(j.target_offset)
      if ([mI, mLRA, mTP, mTH, off].every(Number.isFinite)) {
        masterArgs = [
          '-af',
          `loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=${mI}:measured_LRA=${mLRA}:measured_TP=${mTP}:measured_thresh=${mTH}:offset=${off}:linear=true`,
        ]
      } else throw new Error('non-finite measurement')
    } catch {
      masterArgs = ['-af', 'loudnorm=I=-14:TP=-1.5:LRA=11'] // fallback single-pass
    }
  } else {
    masterArgs = ['-af', 'loudnorm=I=-14:TP=-1.5:LRA=11'] // fallback single-pass
  }
  const master = await run([
    'ffmpeg', '-y', '-i', preMix, ...masterArgs,
    '-c:a', 'pcm_s16le', '-ar', '48000',
    '-t', String(D),
    outPath,
  ], { timeoutMs: 180_000 })
  await fs.rm(preMix, { force: true })
  return { ok: master.ok, log: master.stderr.slice(-2000), ms: Date.now() - t0 }
}

// ── Re-loudness an existing mix in place (QC auto-revise) ────────────────────
export async function remasterAudio(
  audioPath: string,
  outPath: string
): Promise<{ ok: boolean; log: string; ms: number }> {
  const r = await run([
    'ffmpeg', '-y', '-i', audioPath,
    '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000',
    '-c:a', 'pcm_s16le', '-ar', '48000', outPath,
  ], { timeoutMs: 180_000 })
  return { ok: r.ok, log: r.stderr.slice(-800), ms: r.ms }
}

// ── Swap the audio track of a rendered master without re-rendering video ────
export async function remuxAudio(
  videoPath: string,
  audioPath: string,
  outPath: string,
  durationSec: number
): Promise<{ ok: boolean; log: string; ms: number }> {
  const r = await run([
    'ffmpeg', '-y', '-i', videoPath, '-i', audioPath,
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-t', String(durationSec), '-movflags', '+faststart',
    outPath,
  ], { timeoutMs: 120_000 })
  return { ok: r.ok, log: r.stderr.slice(-800), ms: r.ms }
}

// ── Designed thumbnail: hero + brand typography + accent (not a frame grab) ─
export interface ThumbSpec {
  stationName: string
  title: string
  paletteHex: string
}

export async function designThumbnail(
  heroPath: string,
  outPath: string,
  spec: ThumbSpec
): Promise<{ ok: boolean; log: string; ms: number }> {
  const accent = /^0x[0-9A-Fa-f]{6}$/.test(spec.paletteHex) ? spec.paletteHex : '0xFF7AC6'
  const stnFile = path.join(path.dirname(outPath), 'thumb-station.txt')
  const titleFile = path.join(path.dirname(outPath), 'thumb-title.txt')
  const badgeFile = path.join(path.dirname(outPath), 'thumb-badge.txt')
  await writeTextFile(stnFile, spec.stationName.toUpperCase())
  await writeTextFile(titleFile, spec.title.length > 38 ? spec.title.slice(0, 36) + '…' : spec.title)
  await writeTextFile(badgeFile, '100% AI RADIO')

  const filters = [
    `scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720`,
    `eq=brightness=-0.05:saturation=1.12`,
    // soft dark bed for text
    `drawbox=x=0:y=380:w=1280:h=100:color=black@0.22:t=fill`,
    `drawbox=x=0:y=480:w=1280:h=240:color=black@0.55:t=fill`,
    // accent bar
    `drawbox=x=56:y=498:w=12:h=118:color=${accent}@0.98:t=fill`,
    // station name (big) + episode title
    dt({ textfile: stnFile, fontsize: '58', fontcolor: 'white', x: '88', y: '494', shadowcolor: 'black@0.85', shadowx: '3', shadowy: '3' }),
    dt({ textfile: titleFile, fontsize: '36', fontcolor: 'white@0.94', x: '88', y: '570', shadowcolor: 'black@0.85', shadowx: '2', shadowy: '2' }),
    // badge top-right
    `drawbox=x=1280-236:y=44:w=192:h=44:color=${accent}@0.92:t=fill`,
    dt({ textfile: badgeFile, fontsize: '22', fontcolor: 'white', x: '1280-220', y: '56' }),
    // subtle vignette
    `vignette=PI/5`,
  ].join(',')

  const r = await run([
    'ffmpeg', '-y', '-i', heroPath,
    '-vf', filters,
    '-frames:v', '1', '-q:v', '2',
    outPath,
  ], { timeoutMs: 60_000 })
  return { ok: r.ok, log: r.stderr.slice(-800), ms: r.ms }
}

// ── Frame grab (for QC VLM perceptual review) ────────────────────────────────
export async function grabFrame(
  videoPath: string,
  outPath: string,
  atSec: number
): Promise<{ ok: boolean; ms: number }> {
  const r = await run([
    'ffmpeg', '-y', '-ss', String(Math.max(0, atSec)), '-i', videoPath,
    '-frames:v', '1', '-vf', 'scale=1280:-2', '-q:v', '4',
    outPath,
  ], { timeoutMs: 60_000 })
  return { ok: r.ok, ms: r.ms }
}
