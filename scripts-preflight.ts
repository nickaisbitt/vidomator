// Local pre-flight: synth v2 + pingPong + burnChrome v2 + thumbnail (no API spend)
import { renderTrack, keyToRoot } from './src/lib/synth'
import { pingPong, buildLoopVideo, burnChrome, designThumbnail, probe } from './src/lib/ffmpeg'
import { writeFileSync, readFileSync, mkdirSync } from 'fs'

const dir = '/tmp/rf-preflight'
mkdirSync(dir, { recursive: true })

console.log('[1] synth v2 …')
const t0 = Date.now()
const music = renderTrack({ bpm: 100, keyRoot: keyToRoot('A minor'), seed: 12345, brightness: 0.62 })
writeFileSync(`${dir}/music.wav`, music.wav)
console.log(`    ok: ${music.bars} bars, ${music.durationSec.toFixed(1)}s, ${music.wav.length / 1e6}MB, ${Date.now() - t0}ms, sections: ${music.sections.map((s) => s.name).join('|')}`)

console.log('[2] ping-pong i2v clip …')
const pp = await pingPong('/tmp/i2v-test.mp4', `${dir}/motion.mp4`)
console.log(`    ${pp.ok ? 'ok' : 'FAIL'} ${pp.ms}ms ${pp.log.slice(-200)}`)
if (!pp.ok) process.exit(1)

console.log('[3] mixed loop …')
// fake a scene still from the i2v frame
await (await import('child_process')).execSync(
  `ffmpeg -y -i /tmp/i2v-test.mp4 -frames:v 1 ${dir}/scene1.png`,
)
const loop = await buildLoopVideo(
  [
    { type: 'kb', path: `${dir}/scene1.png`, sec: 8, zoomIn: true },
    { type: 'clip', path: `${dir}/motion.mp4`, sec: 10 },
    { type: 'kb', path: `${dir}/scene1.png`, sec: 8, zoomIn: false },
    { type: 'kb', path: `${dir}/scene1.png`, sec: 8, zoomIn: true },
    { type: 'kb', path: `${dir}/scene1.png`, sec: 8, zoomIn: false },
  ],
  `${dir}/loop.mp4`,
  { xfadeSec: 1 }
)
console.log(`    ${loop.ok ? 'ok' : 'FAIL'} loopSec=${loop.loopSec.toFixed(1)} ${loop.ms}ms ${loop.log.slice(-200)}`)
if (!loop.ok) process.exit(1)

console.log('[4] radio mix (no idents) + chrome v2 …')
await (await import('child_process')).execSync(
  `ffmpeg -y -i ${dir}/music.wav -af "atrim=duration=32,loudnorm=I=-14:TP=-1.5:LRA=11" -c:a pcm_s16le ${dir}/mix.wav`
)
const chrome = await burnChrome(
  `${dir}/loop.mp4`, `${dir}/mix.wav`, `${dir}/episode.mp4`,
  {
    stationName: 'Neon Prophet FM',
    tagline: 'Prophecies from the midnight market',
    djName: 'The Oracle',
    tracks: [
      { title: 'Bull Run at Midnight', atSec: 0 },
      { title: 'The Flatline Waltz', atSec: 20 },
    ],
    identAtSec: [7, 20],
    durationSec: 32,
    creditsText: 'NEON PROPHET FM — 100% AI-GENERATED BROADCAST\nMUSIC · VISUALS · MOTION · VOICE — ALL SYNTHESIZED\nNO THIRD-PARTY MATERIAL — 14 ASSETS IN LEDGER',
    paletteHex: '0xFF7AC6',
  },
  dir
)
console.log(`    ${chrome.ok ? 'ok' : 'FAIL'} ${chrome.ms}ms ${chrome.log.slice(-400)}`)
if (!chrome.ok) process.exit(1)

console.log('[5] designed thumbnail …')
const thumb = await designThumbnail(`${dir}/scene1.png`, `${dir}/thumb.jpg`, {
  stationName: 'Neon Prophet FM', title: 'The Night the Market Flatlined', paletteHex: '0xFF7AC6',
})
console.log(`    ${thumb.ok ? 'ok' : 'FAIL'}`)

const p = await probe(`${dir}/episode.mp4`)
console.log('[6] probe:', JSON.stringify(p))
console.log('PREFLIGHT PASS')
