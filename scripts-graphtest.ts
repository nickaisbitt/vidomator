import { writeFileSync } from 'fs'
const D = 'public/generated/neon-prophet-r4l9/cmw321pc0000eq3v8qhr34ct8'
const parts: string[] = []
parts.push(`[1:a]aresample=48000,aformat=channel_layouts=stereo[m]`)
const idents = [{ atSec: 4 }, { atSec: 70 }, { atSec: 132 }]
idents.forEach((i, idx) => {
  parts.push(`[${idx + 2}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${i.atSec * 1000}|${i.atSec * 1000},apad=whole_dur=164[i${idx}]`)
})
parts.push(`[i0][i1][i2]amix=inputs=3:duration=longest:normalize=0,volume=1.6[vx]`)
parts.push(`[m][vx]sidechaincompress=threshold=0.03:ratio=8:attack=60:release=550[duck]`)
parts.push(`[duck][vx]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.89,afade=t=out:st=160.5:d=3.5,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[a]`)
const graph = parts.join(';')
writeFileSync('/tmp/runtime-graph.txt', graph)
console.log('graph bytes:', graph.length, '| contains [m]:', graph.includes('[m]'))
