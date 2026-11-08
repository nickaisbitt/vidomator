'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { EpisodeWorkspace } from '@/components/episode-workspace'
import {
  Radio, Sparkles, Mic2, Image as ImageIcon, Music4, FileText, Film,
  Layers, Type, Gauge, CheckCircle2, XCircle, Loader2, Circle,
  Copy, Download, AlertTriangle, Clock, Coins, Library, Wand2, Clapperboard,
  RotateCcw, Eye, Play, ScanSearch, Bell, BellRing, X, Keyboard, Terminal, History,
  ChevronLeft, ChevronRight, ChevronDown, CalendarDays, Dice5, PartyPopper,
} from 'lucide-react'
import { SHIP_GATE, GATE_TOTAL, GATE_PASS } from '@/lib/gate'
import { STAGE_LIST } from '@/lib/stages-client'
import {
  useLiveProgress, notificationsEnabled, enableNotifications, disableNotifications,
  type DoneEvent,
} from '@/hooks/use-live-progress'
import type {
  StationCharter, EpisodeRundown, MetadataPack, QcReport, CostUnits,
} from '@/lib/types'

// ─── client-side mirrors of DB rows ──────────────────────────────────────────
interface StationRow {
  id: string; name: string; handle: string; tagline: string; genre: string
  charterJson: string; paletteJson: string; costJson: string; createdAt: string
  episodes?: EpisodeSummary[]
  stats?: { episodeCount: number; readyCount: number; avgQc: number | null; totalSec: number; estUsd: number }
}
interface EpisodeSummary {
  id: string; title: string; status: string; qcScore: number | null
  durationSec: number | null; createdAt: string; stationId: string
  thumbPath?: string | null; videoPath?: string | null; estUsd?: number
  prompt?: string
}
interface QueueRow {
  id: string; stationId: string | null; prompt: string; status: string
  episodeId: string | null; error: string | null; createdAt: string
}
interface StageRow {
  id: string; key: string; name: string; status: string; retries?: number
  outputJson: string | null; error: string | null; ms: number | null
}
interface AssetRow {
  id: string; kind: string; role: string; path: string; prompt: string
  tool: string; model: string; license: string; attribution: string; metaJson: string
}
interface EpisodeRow {
  id: string; stationId: string; title: string; prompt: string; status: string
  rundownJson: string; qcScore: number | null; qcJson: string | null
  metadataJson: string | null; attributionMd: string | null
  durationSec: number | null; videoPath: string | null; thumbPath: string | null
  costJson: string; seed: number; createdAt: string
  station?: StationRow
  stages: StageRow[]; assets: AssetRow[]
}

const EXAMPLES = [
  'A midnight synthwave station where a cryptic DJ reads fake stock-market prophecies',
  'Tropical vaporwave hotline for insomniacs, hosted by a smooth-voiced AI lifeguard',
  'Desert-dub radio beacon broadcasting to ghost towns, 1968 never ended',
  'Cyber-tamashii: neon Tokyo shrine radio, traditional koto over darkwave',
]

// shared by desktop TabsList + mobile bottom nav (#10)
const TAB_DEFS = [
  { value: 'studio', label: 'Studio', icon: Wand2 },
  { value: 'library', label: 'Library', icon: Library },
  { value: 'gate', label: 'Gate', icon: Gauge },
  { value: 'blueprint', label: 'Blueprint', icon: Layers },
] as const

// #16 — prompt history + draft autosave (localStorage)
const HISTORY_KEY = 'rf-prompt-history'
const DRAFT_KEY = 'rf-prompt-draft'
function loadHistory(): string[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as string[] } catch { return [] }
}
function pushHistory(text: string) {
  const t = text.trim()
  if (t.length < 3) return
  try {
    const hist = loadHistory().filter((h) => h !== t)
    hist.unshift(t)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(hist.slice(0, 12)))
  } catch {}
}

// ─── small pieces ────────────────────────────────────────────────────────────
function fmtDur(sec: number | null | undefined) {
  if (!sec) return '—'
  return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`
}
function fmtMs(ms: number | null | undefined) {
  if (!ms) return ''
  return ms > 60_000 ? `${(ms / 60_000).toFixed(1)}m` : `${(ms / 1000).toFixed(1)}s`
}

function StageIcon({ status }: { status: string }) {
  if (status === 'done') return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
  if (status === 'failed') return <XCircle className="h-4 w-4 shrink-0 text-red-400" />
  if (status === 'running') return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-amber-300" />
  return <Circle className="h-4 w-4 shrink-0 text-zinc-600" />
}

const STAGE_ICONS: Record<string, typeof Radio> = {
  rundown: Type, voice: Mic2, visuals: ImageIcon, motion: Clapperboard,
  music: Music4, 'assembly-loop': Layers, 'assembly-audio': Gauge,
  'assembly-video': Film, attribution: FileText, metadata: Sparkles, qc: Eye,
}

// per-stage live sub-progress chip
function stageChip(key: string, st: StageRow | undefined): { chip?: string; note?: string } {
  if (!st?.outputJson) return {}
  let out: Record<string, unknown>
  try { out = JSON.parse(st.outputJson) } catch { return {} }
  if (key === 'visuals') {
    return { chip: `${out.done ?? '?'}/${out.total ?? 5}`, note: Array.isArray(out.log) ? String(out.log[out.log.length - 1] ?? '') : '' }
  }
  if (key === 'motion') {
    const polling = out.polling as { clip?: number; elapsedSec?: number; status?: string } | undefined
    if (polling) return { chip: `clip ${polling.clip}/2 · ${polling.elapsedSec}s`, note: `CogVideoX ${String(polling.status ?? '').toLowerCase()}…` }
    const clips = Array.isArray(out.clips) ? out.clips as { status: string }[] : []
    const ok = clips.filter((c) => c.status === 'ok').length
    if (clips.length) return { chip: `${ok}/${clips.length} clips`, note: Array.isArray(out.log) ? String(out.log[out.log.length - 1] ?? '') : '' }
    return { note: 'starting…' }
  }
  if (key === 'rundown' && out.tracks) return { chip: String((out.tracks as string[]).length) + ' tracks' }
  if (key === 'music' && out.bpm) return { chip: `${out.bpm} bpm · A+B sides` }
  if (key === 'assembly-loop' && out.segments != null) return { chip: `${out.segments} blocks · ${out.kbSec ?? '?'}s kb` }
  if (key === 'assembly-audio' && out.bSideAt != null) return { chip: `B-side @ ${out.bSideAt}s` }
  if (key === 'qc' && out.score != null) return { chip: `${out.score}/110${out.revised ? ' (revised)' : ''}` }
  return {}
}

function CopyBtn({ text, label }: { text: string; label?: string }) {
  const { toast } = useToast()
  return (
    <Button
      variant="ghost" size="sm"
      className="h-7 gap-1 px-2 text-xs text-zinc-400 hover:text-zinc-100"
      onClick={async () => {
        try { await navigator.clipboard.writeText(text) } catch {}
        toast({ title: label ?? 'Copied' })
      }}
    >
      <Copy className="h-3 w-3" /> Copy
    </Button>
  )
}

// #6 — live log tail: the running stage's own progress lines, verbatim
function LiveLogTail({ stages }: { stages: StageRow[] }) {
  const running = stages.find((s) => s.status === 'running')
  const lines = (() => {
    if (!running?.outputJson) return []
    try {
      const out = JSON.parse(running.outputJson) as { log?: unknown }
      return Array.isArray(out.log) ? out.log.slice(-8).map(String) : []
    } catch { return [] }
  })()
  if (!running || lines.length === 0) return null
  return (
    <div className="mt-3 rounded-md border border-zinc-800 bg-black/60 p-2.5">
      <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-zinc-500">
        <Terminal className="h-3 w-3 text-emerald-400/70" /> live log — {running.name}
      </div>
      <div className="max-h-32 overflow-y-auto font-mono text-[10px] leading-relaxed text-emerald-300/80">
        {lines.map((l, i) => <p key={i} className="break-words">{l}</p>)}
      </div>
    </div>
  )
}

// #5 — cost dashboard: spend across every channel, client-computed
function CostDashboard({ stations }: { stations: StationRow[] }) {
  const withStats = stations.filter((s) => s.stats && s.stats.episodeCount > 0)
  if (withStats.length === 0) return null
  const totalUsd = withStats.reduce((a, s) => a + (s.stats?.estUsd ?? 0), 0)
  const totalEps = withStats.reduce((a, s) => a + (s.stats?.episodeCount ?? 0), 0)
  const totalSec = withStats.reduce((a, s) => a + (s.stats?.totalSec ?? 0), 0)
  return (
    <Card className="border-zinc-800 bg-zinc-900/70">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-amber-300">
          <Coins className="h-4 w-4" /> Cost dashboard
        </CardTitle>
        <CardDescription className="text-xs text-zinc-500">API calls only — ffmpeg, synth and chrome are local and free.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Total spend</div>
            <div className="mt-0.5 font-mono text-sm text-amber-300">~${totalUsd.toFixed(2)}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">On air</div>
            <div className="mt-0.5 font-mono text-sm text-amber-300">{fmtDur(totalSec)}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Avg / episode</div>
            <div className="mt-0.5 font-mono text-sm text-amber-300">~${totalEps > 0 ? (totalUsd / totalEps).toFixed(3) : '0'}</div>
          </div>
        </div>
        <ul className="space-y-1">
          {withStats.map((s) => (
            <li key={s.id} className="flex items-center gap-2 rounded-md border border-zinc-800/70 bg-zinc-950/60 px-2.5 py-1.5 text-xs min-w-0">
              <span className="min-w-0 flex-1 truncate text-zinc-300">{s.name}</span>
              <span className="shrink-0 font-mono text-[10px] text-zinc-500">{s.stats?.episodeCount} ep</span>
              <span className="shrink-0 font-mono text-[10px] text-amber-300/90">~${(s.stats?.estUsd ?? 0).toFixed(2)}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

// #15 — first-run tour: shown once, dismissible forever
const TOUR_KEY = 'rf-tour-done'
function FirstRunTour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const steps = [
    { icon: Wand2, title: '1 · Describe a station', body: 'One sentence designs the whole channel: DJ persona, visual style-lock, dual-track music key, ident scripts.' },
    { icon: Radio, title: '2 · Watch the cockpit', body: 'The server owns the run — 11 stages from rundown to QC. You can close the tab; live progress streams back when you return.' },
    { icon: Library, title: '3 · Ship it', body: 'Hover any library card to scrub the master, open the workspace for frame-evidence QC, metadata pack and ATTRIBUTION.md.' },
  ]
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="dark max-w-md border-zinc-800 bg-zinc-950 text-zinc-200">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base text-zinc-50">
            <PartyPopper className="h-4 w-4 text-amber-300" /> Welcome to Radio Foundry
          </DialogTitle>
          <DialogDescription className="text-xs text-zinc-500">
            Prompt in → broadcast-grade, attributed YouTube episode out. Three things to know:
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-2.5">
          {steps.map((s) => {
            const Icon = s.icon
            return (
              <li key={s.title} className="flex items-start gap-2.5 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 min-w-0">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-zinc-100">{s.title}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-400">{s.body}</p>
                </div>
              </li>
            )
          })}
        </ul>
        <Button
          className="w-full bg-amber-400 font-semibold text-zinc-950 hover:bg-amber-300"
          onClick={onClose}
        >
          Start creating
        </Button>
      </DialogContent>
    </Dialog>
  )
}

// #14 — surprise-me combinator (client-side, zero cost)
const SURPRISE_A = ['a midnight', 'a drowned-city', 'a desert-dub', 'a neon-Tokyo', 'a ghost-lighthouse', 'an orbital', 'a haunted mall', 'a glacier']
const SURPRISE_B = ['synthwave', 'vaporwave', 'darkwave', 'hypnagogic', 'dub', 'ambient', 'electro-swing', 'shoegaze']
const SURPRISE_C = ['station', 'hotline', 'beacon', 'pirate relay', 'test transmission', 'prayer line']
const SURPRISE_D = ['reads fake stock-market prophecies', 'broadcasts to insomniacs', 'interprets weather as omens', 'reads numbers stations to nightshift workers', 'narrates the dreams of appliances', 'answers calls from the year 2087', 'hosts a seance for old satellites']
function surprisePrompt() {
  const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)]
  return `${pick(SURPRISE_A)} ${pick(SURPRISE_B)} ${pick(SURPRISE_C)} where a cryptic DJ ${pick(SURPRISE_D)}`
}

// #18 — episode calendar: month grid with episode dots
function EpisodeCalendar({
  episodes, selectedDay, onSelectDay,
}: {
  episodes: EpisodeSummary[]
  selectedDay: string | null
  onSelectDay: (day: string | null) => void
}) {
  const [month, setMonth] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const byDay = new Map<string, EpisodeSummary[]>()
  for (const e of episodes) {
    const day = e.createdAt.slice(0, 10)
    const arr = byDay.get(day) ?? []
    arr.push(e)
    byDay.set(day, arr)
  }
  const year = month.getFullYear()
  const mIdx = month.getMonth()
  const firstDow = new Date(year, mIdx, 1).getDay()
  const daysInMonth = new Date(year, mIdx + 1, 0).getDate()
  const todayStr = new Date().toISOString().slice(0, 10)
  const cells: (number | null)[] = [
    ...Array.from({ length: firstDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  const dayStr = (n: number) => `${year}-${String(mIdx + 1).padStart(2, '0')}-${String(n).padStart(2, '0')}`
  const monthLabel = month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  return (
    <div className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
          <CalendarDays className="h-3.5 w-3.5 text-amber-300" /> {monthLabel}
        </span>
        <div className="flex items-center gap-1">
          <button aria-label="Previous month" onClick={() => setMonth(new Date(year, mIdx - 1, 1))} className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button aria-label="Next month" onClick={() => setMonth(new Date(year, mIdx + 1, 1))} className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <span key={i} className="py-0.5 text-[9px] uppercase tracking-wider text-zinc-600">{d}</span>
        ))}
        {cells.map((n, i) => {
          if (n === null) return <span key={`x${i}`} />
          const ds = dayStr(n)
          const eps = byDay.get(ds)
          const selected = selectedDay === ds
          const isToday = ds === todayStr
          return (
            <button
              key={ds}
              onClick={() => onSelectDay(selected ? null : ds)}
              disabled={!eps}
              aria-label={eps ? `${ds}: ${eps.length} episode${eps.length === 1 ? '' : 's'}` : ds}
              aria-pressed={selected}
              className={`relative rounded-md py-1.5 text-[11px] transition-colors ${
                eps
                  ? selected
                    ? 'bg-amber-400 font-semibold text-zinc-950'
                    : 'text-zinc-200 hover:bg-zinc-800'
                  : 'text-zinc-700'
              }`}
            >
              {n}
              {eps && !selected && (
                <span className={`absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full ${isToday ? 'bg-fuchsia-400' : 'bg-amber-400/80'}`} />
              )}
            </button>
          )
        })}
      </div>
      {selectedDay && (
        <button onClick={() => onSelectDay(null)} className="mt-2 w-full rounded-md border border-amber-400/30 bg-amber-400/10 py-1 text-[10px] text-amber-200 hover:bg-amber-400/20">
          showing {byDay.get(selectedDay)?.length ?? 0} episode(s) from {selectedDay} — click to clear filter
        </button>
      )}
    </div>
  )
}

// ─── Charter display ─────────────────────────────────────────────────────────
function CharterView({ station }: { station: StationRow }) {
  const charter = (() => {
    try { return JSON.parse(station.charterJson) as StationCharter } catch { return null }
  })()
  const palette = (() => {
    try { return JSON.parse(station.paletteJson) as string[] } catch { return [] }
  })()
  if (!charter) return null
  return (
    <div className="min-w-0 space-y-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-2xl font-bold text-zinc-50">{station.name}</h3>
          <Badge variant="outline" className="border-fuchsia-400/40 text-fuchsia-300">{station.genre}</Badge>
        </div>
        <p className="mt-1 text-sm text-zinc-400">{charter.tagline}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {palette.map((c, i) => (
          <div key={i} className="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1">
            <span className="h-4 w-4 rounded-sm border border-white/10" style={{ backgroundColor: c }} />
            <span className="font-mono text-[11px] text-zinc-400">{c}</span>
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-zinc-500">
          <Mic2 className="h-3.5 w-3.5" /> On-air persona
        </div>
        <p className="mt-2 font-semibold text-zinc-100">{charter.persona?.name}</p>
        <p className="text-sm text-zinc-400">{charter.persona?.style}</p>
        <p className="mt-1 text-sm italic text-amber-300/90">“{charter.persona?.catchphrase}”</p>
      </div>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-zinc-500">
          <ImageIcon className="h-3.5 w-3.5" /> Visual style lock
        </div>
        <p className="mt-2 text-sm leading-relaxed text-zinc-300">{charter.visualStyle}</p>
      </div>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
        <div className="text-xs uppercase tracking-wider text-zinc-500">Ident scripts</div>
        <ul className="mt-2 space-y-1 text-sm text-zinc-300">
          <li><span className="font-mono text-xs text-zinc-500">intro</span> — {charter.identScripts?.intro}</li>
          <li><span className="font-mono text-xs text-zinc-500">mid</span> — {charter.identScripts?.mid}</li>
          <li><span className="font-mono text-xs text-zinc-500">outro</span> — {charter.identScripts?.outro}</li>
        </ul>
      </div>
      {charter.formatNotes && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
          <div className="text-xs uppercase tracking-wider text-zinc-500">Format notes</div>
          <p className="mt-2 text-sm leading-relaxed text-zinc-300">{charter.formatNotes}</p>
        </div>
      )}
      {/* #4 — brand kit footer: handle + one-click charter export */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800/80 pt-2">
        <span className="font-mono text-[11px] text-zinc-500">@{station.handle}</span>
        <CopyBtn text={JSON.stringify({ charter, palette }, null, 2)} label="Brand kit JSON copied" />
      </div>
    </div>
  )
}

// ─── Result panel ────────────────────────────────────────────────────────────
function ResultPanel({ episode, onOpenWorkspace }: { episode: EpisodeRow; onOpenWorkspace?: () => void }) {
  const qc = (() => {
    try { return episode.qcJson ? (JSON.parse(episode.qcJson) as QcReport) : null } catch { return null }
  })()
  const meta = (() => {
    try { return episode.metadataJson ? (JSON.parse(episode.metadataJson) as MetadataPack) : null } catch { return null }
  })()
  const rundown = (() => {
    try { return JSON.parse(episode.rundownJson) as EpisodeRundown } catch { return null }
  })()

  return (
    <div className="min-w-0 space-y-5">
      {/* video + thumbnail */}
      <div className="grid min-w-0 gap-4 lg:grid-cols-[1fr_260px]">
        <div className="overflow-hidden rounded-xl border border-zinc-800 bg-black">
          {episode.videoPath ? (
            <video src={episode.videoPath} controls poster={episode.thumbPath ?? undefined} className="aspect-video w-full" />
          ) : (
            <div className="flex aspect-video items-center justify-center text-sm text-zinc-500">master not rendered</div>
          )}
        </div>
        {episode.thumbPath && (
          <div className="min-w-0 space-y-2">
            <div className="text-xs uppercase tracking-wider text-zinc-500">Designed thumbnail</div>
            <img src={episode.thumbPath} alt="Episode thumbnail" className="w-full rounded-lg border border-zinc-800" />
            <Button asChild variant="outline" size="sm" className="w-full border-zinc-700 text-zinc-200">
              <a href={episode.thumbPath} download><Download className="mr-1 h-4 w-4" /> 1280×720</a>
            </Button>
          </div>
        )}
      </div>

      {/* QC scorecard */}
      {qc && (
        <Card className="border-zinc-800 bg-zinc-900/70">
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-center gap-3 text-base text-zinc-100">
              QC Gate
              <span className={`text-2xl font-bold ${qc.passed ? 'text-emerald-400' : 'text-amber-400'}`}>
                {qc.score}<span className="text-sm text-zinc-500">/{qc.total}</span>
              </span>
              <Badge className={qc.passed ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}>
                {qc.passed ? `PUBLISHABLE (≥${GATE_PASS})` : 'NEEDS REVISION'}
              </Badge>
              {qc.revised && <Badge className="bg-fuchsia-500/15 text-fuchsia-300">auto-revised</Badge>}
            </CardTitle>
            <CardDescription className="text-xs text-zinc-500">
              {qc.probe.width}×{qc.probe.height} · {fmtDur(qc.probe.durationSec)} · {qc.probe.lufs?.toFixed(1) ?? '—'} LUFS · seed {episode.seed}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-1.5 sm:grid-cols-2">
              {qc.items.map((it) => (
                <div key={it.id} className="flex items-start gap-2 rounded-md px-2 py-1 text-xs min-w-0">
                  {it.earned === it.points
                    ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                    : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />}
                  <div className="min-w-0">
                    <span className="text-zinc-200">{it.label}</span>
                    <span className="ml-1 font-mono text-zinc-500">{it.earned}/{it.points}</span>
                    <div className="truncate text-[11px] text-zinc-500">{it.detail}</div>
                  </div>
                </div>
              ))}
            </div>
            {qc.vlmNotes && qc.vlmNotes.length > 0 && (
              <>
                <Separator className="bg-zinc-800" />
                <div className="space-y-1">
                  <div className="text-xs uppercase tracking-wider text-zinc-500">VLM perceptual review</div>
                  {qc.vlmNotes.map((n, i) => (
                    <p key={i} className="break-words font-mono text-[11px] text-zinc-400">{n}</p>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* metadata pack */}
      {meta && (
        <Card className="border-zinc-800 bg-zinc-900/70">
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base text-zinc-100">
              YouTube metadata pack
              <CopyBtn
                text={[
                  meta.youtubeTitle,
                  '',
                  meta.youtubeDescription,
                  '',
                  meta.chapters.map((c) => c.t + ' ' + c.label).join('\n'),
                  '',
                  'TAGS: ' + meta.tags.join(', '),
                  '',
                  'DISCLOSURE: ' + meta.disclosure,
                ].join('\n')}
                label="Full upload kit copied"
              />
            </CardTitle>
            <CardDescription className="text-xs text-zinc-500">Copy button grabs the complete upload kit: title, description, chapters, tags, disclosure.</CardDescription>
          </CardHeader>
          <CardContent className="min-w-0 space-y-3">
            <div className="min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs uppercase tracking-wider text-zinc-500">Title</span>
                <CopyBtn text={meta.youtubeTitle} label="Title copied" />
              </div>
              <p className="mt-1 break-words text-sm font-medium text-zinc-100">{meta.youtubeTitle}</p>
            </div>
            <Separator className="bg-zinc-800" />
            <div className="min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs uppercase tracking-wider text-zinc-500">Description</span>
                <CopyBtn text={`${meta.youtubeDescription}\n\n${meta.chapters.map((c) => c.t + ' ' + c.label).join('\n')}\n\n${meta.disclosure}`} label="Description copied" />
              </div>
              <p className="mt-1 max-h-32 overflow-y-auto break-words whitespace-pre-wrap text-xs leading-relaxed text-zinc-300">{meta.youtubeDescription}</p>
            </div>
            <div className="min-w-0">
              <span className="text-xs uppercase tracking-wider text-zinc-500">Tags</span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {meta.tags.map((t, i) => (
                  <Badge key={i} variant="secondary" className="bg-zinc-800 text-[11px] text-zinc-300">{t}</Badge>
                ))}
              </div>
            </div>
            {meta.chapters.length > 0 && (
              <div className="min-w-0">
                <span className="text-xs uppercase tracking-wider text-zinc-500">Chapters</span>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-300">
                  {meta.chapters.map((c, i) => (
                    <span key={i} className="font-mono">{c.t} <span className="text-zinc-400">{c.label}</span></span>
                  ))}
                </div>
              </div>
            )}
            <div className="rounded-md border border-emerald-900/50 bg-emerald-950/30 p-2.5">
              <p className="text-xs leading-relaxed text-emerald-200/90">{meta.disclosure}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* attribution */}
      {episode.attributionMd && (
        <Card className="border-zinc-800 bg-zinc-900/70">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between gap-2 text-base text-zinc-100">
              ATTRIBUTION.md
              <CopyBtn text={episode.attributionMd} label="Attribution copied" />
            </CardTitle>
            <CardDescription className="text-xs text-zinc-500">
              {episode.assets.length} assets in ledger · 100% self-generated · AI disclosure enforced
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-zinc-950 p-3 text-[11px] leading-relaxed text-zinc-400">
              {episode.attributionMd}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* downloads */}
      <div className="flex flex-wrap gap-2">
        {onOpenWorkspace && (
          <Button size="sm" className="bg-amber-400 font-semibold text-zinc-950 hover:bg-amber-300" onClick={onOpenWorkspace}>
            <ScanSearch className="mr-1 h-4 w-4" /> Open full workspace
          </Button>
        )}
        {episode.videoPath && (
          <Button asChild variant="outline" size="sm" className="border-zinc-700 text-zinc-200">
            <a href={episode.videoPath} download><Download className="mr-1 h-4 w-4" /> Master MP4</a>
          </Button>
        )}
        {episode.attributionMd && (
          <Button asChild variant="outline" size="sm" className="border-zinc-700 text-zinc-200">
            <a
              href={`data:text/markdown;charset=utf-8,${encodeURIComponent(episode.attributionMd)}`}
              download="ATTRIBUTION.md"
            >
              <Download className="mr-1 h-4 w-4" /> ATTRIBUTION.md
            </a>
          </Button>
        )}
        {rundown && (
          <Button asChild variant="outline" size="sm" className="border-zinc-700 text-zinc-200">
            <a
              href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify({ rundown, metadata: meta, seed: episode.seed }, null, 2))}`}
              download={`episode-${episode.id.slice(0, 8)}.json`}
            >
              <Download className="mr-1 h-4 w-4" /> Metadata JSON
            </a>
          </Button>
        )}
      </div>
    </div>
  )
}

// ─── hover-scrub preview (#2): seek the real master under the cursor ─────────
function ScrubPreview({ src, frac }: { src: string; frac: number }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [dur, setDur] = useState(0)
  useEffect(() => {
    const v = ref.current
    if (!v) return
    const d = v.duration
    if (d && Number.isFinite(d)) {
      try { v.currentTime = Math.min(frac * d, d - 0.1) } catch {}
    }
  }, [frac, dur])
  return (
    <video
      ref={ref}
      src={src}
      muted
      playsInline
      preload="metadata"
      onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
      className="absolute inset-0 h-full w-full object-cover"
    />
  )
}

// ─── library card with hover-scrub + workspace open (#1 + #2) ────────────────
function LibraryCard({ e, onOpen }: { e: EpisodeSummary; onOpen: () => void }) {
  const [hover, setHover] = useState(false)
  const [frac, setFrac] = useState(0)
  const canScrub = Boolean(e.videoPath) && e.status === 'ready'
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open episode workspace: ${e.title}`}
      onClick={onOpen}
      onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onOpen() } }}
      onMouseEnter={() => canScrub && setHover(true)}
      onMouseLeave={() => setHover(false)}
      onMouseMove={(ev) => {
        if (!canScrub) return
        const rect = ev.currentTarget.getBoundingClientRect()
        setFrac(Math.min(0.98, Math.max(0, (ev.clientX - rect.left) / rect.width)))
      }}
      className="group min-w-0 cursor-pointer overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/60 text-left transition-colors hover:border-amber-400/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
    >
      <div className="relative aspect-video w-full overflow-hidden bg-zinc-900">
        {e.thumbPath ? (
          <img src={e.thumbPath} alt={e.title} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
        ) : (
          <div className="flex h-full items-center justify-center text-zinc-600"><Radio className="h-8 w-8" /></div>
        )}
        {hover && canScrub && <ScrubPreview src={e.videoPath!} frac={frac} />}
        {canScrub && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
            <span className="flex h-12 w-12 items-center justify-center rounded-full border border-white/25 bg-black/55 backdrop-blur-sm">
              <Play className="h-5 w-5 fill-white text-white" />
            </span>
          </span>
        )}
        {hover && canScrub && (
          <>
            <span className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[10px] text-amber-200">
              ⏱ {fmtDur(frac * (e.durationSec ?? 0))} · hover-scrub
            </span>
            <span className="pointer-events-none absolute bottom-0 left-0 right-0 h-1 bg-black/60">
              <span className="block h-full bg-amber-400" style={{ width: `${frac * 100}%` }} />
            </span>
          </>
        )}
        <span className="absolute right-2 top-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
          {fmtDur(e.durationSec)}
        </span>
        {e.status !== 'ready' && (
          <span className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-amber-300">{e.status}</span>
        )}
      </div>
      <div className="min-w-0 space-y-1 p-3">
        <p className="truncate text-sm font-medium text-zinc-100">{e.title}</p>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[11px] text-zinc-500">{e.prompt ? e.prompt.slice(0, 42) : 'standard programming'}</span>
          {e.qcScore != null && (
            <span className={`shrink-0 font-mono text-xs ${e.qcScore >= GATE_PASS ? 'text-emerald-400' : 'text-amber-400'}`}>
              {e.qcScore}/{GATE_TOTAL}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── main page ───────────────────────────────────────────────────────────────
export default function Home() {
  const { toast } = useToast()
  const [tab, setTab] = useState('studio')
  const [stations, setStations] = useState<StationRow[]>([])
  const [prompt, setPrompt] = useState('')
  const [generating, setGenerating] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [episode, setEpisode] = useState<EpisodeRow | null>(null)
  const [cost, setCost] = useState<{ units: CostUnits; estUsd: number } | null>(null)
  const [activeStationId, setActiveStationId] = useState<string | null>(null)
  const [queueItems, setQueueItems] = useState<QueueRow[]>([])
  const [queueInput, setQueueInput] = useState('')
  const [queueBusy, setQueueBusy] = useState(false)
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [stationsLoading, setStationsLoading] = useState(true)
  const [history, setHistory] = useState<string[]>([])
  const pollRef = useRef(false)
  const promptRef = useRef<HTMLTextAreaElement>(null)

  const openWorkspace = useCallback((id: string) => {
    setWorkspaceId(id)
    setWorkspaceOpen(true)
  }, [])

  const station = episode?.station ?? stations.find((s) => s.id === episode?.stationId) ?? null
  const activeStation = activeStationId ? stations.find((s) => s.id === activeStationId) ?? null : null

  const refreshStations = useCallback(async () => {
    try {
      const res = await fetch('/api/stations')
      const data = await res.json()
      setStations(data.stations ?? [])
    } catch {}
    setStationsLoading(false)
  }, [])

  const refreshQueue = useCallback(async () => {
    try {
      const res = await fetch('/api/queue')
      const data = await res.json()
      setQueueItems(data.items ?? [])
    } catch {}
  }, [])

  useEffect(() => { refreshStations(); refreshQueue() }, [refreshStations, refreshQueue])

  const episodeRef = useRef<EpisodeRow | null>(null)
  episodeRef.current = episode

  // #19 — completion events pushed by the progress service (any episode, any channel)
  const handleDone = useCallback((ev: DoneEvent) => {
    refreshStations()
    refreshQueue()
    if (ev.status === 'ready') {
      toast({ title: 'Episode ready', description: `QC ${ev.qcScore ?? '?'}/110 — ${ev.title}` })
    } else {
      toast({ title: 'Episode failed', description: ev.stationName ? `${ev.title} · ${ev.stationName} — retry available` : 'Open the cockpit to retry', variant: 'destructive' })
    }
    // if the completed episode is the one open in the cockpit, pull its full row
    fetch(`/api/episodes/${ev.episodeId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.episode && episodeRef.current?.id === d.episode.id) {
          setEpisode(d.episode)
          setCost(d.cost)
        }
      })
      .catch(() => {})
  }, [refreshStations, refreshQueue, toast])

  // #20 — live progress over websocket (HTTP polling below stays as fallback)
  const live = useLiveProgress(handleDone)

  // socket → cockpit merge: patch the open episode with pushed stage updates
  useEffect(() => {
    const lep = live.connected ? live.running[episode?.id ?? ''] : undefined
    if (!lep || !episode || lep.id !== episode.id) return
    setEpisode((prev) => prev && prev.id === lep.id
      ? {
          ...prev,
          status: lep.status,
          qcScore: lep.qcScore,
          durationSec: lep.durationSec,
          videoPath: lep.videoPath,
          thumbPath: lep.thumbPath,
          stages: lep.stages.map((s) => ({ ...s })),
        }
      : prev)
  }, [live.connected, live.running, episode])

  // browser-notification opt-in state
  const [notifOn, setNotifOn] = useState(false)
  useEffect(() => { setNotifOn(notificationsEnabled()) }, [])
  const toggleNotif = useCallback(async () => {
    if (notifOn) {
      disableNotifications()
      setNotifOn(false)
      toast({ title: 'Notifications off' })
      return
    }
    const ok = await enableNotifications()
    setNotifOn(ok)
    toast(ok
      ? { title: 'Notifications on', description: 'You will be pinged when any episode finishes.' }
      : { title: 'Permission denied', description: 'Allow notifications in your browser to use this.', variant: 'destructive' })
  }, [notifOn, toast])

  // queue panel follows the socket when connected, HTTP rows otherwise
  const activeQueueRows = live.connected ? live.queue : queueItems

  // queue polling: keep the channel-factory panel alive while work is pending
  // (slower when the socket is feeding us live updates)
  const queueActive = activeQueueRows.some((q) => q.status === 'pending' || q.status === 'running')
  useEffect(() => {
    if (!queueActive || live.connected) return
    const iv = setInterval(refreshQueue, 4000)
    return () => clearInterval(iv)
  }, [queueActive, live.connected, refreshQueue])

  const openEpisode = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/episodes/${id}`)
      if (!res.ok) return
      const data = await res.json()
      setEpisode(data.episode)
      setCost(data.cost)
      setTab('studio')
    } catch {}
  }, [])

  // #7 — cancel / retry queue items
  const cancelQueueItem = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/queue/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'failed')
      refreshQueue()
      toast({ title: 'Queued episode cancelled' })
    } catch (e) {
      toast({ title: 'Cancel failed', description: String(e).slice(0, 120), variant: 'destructive' })
    }
  }, [refreshQueue, toast])

  const retryQueueItem = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/queue/${id}`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'failed')
      refreshQueue()
      toast({ title: 'Requeued for another attempt' })
    } catch (e) {
      toast({ title: 'Requeue failed', description: String(e).slice(0, 120), variant: 'destructive' })
    }
  }, [refreshQueue, toast])

  // #13 — keyboard shortcuts: 1-4 tabs · n focuses the prompt
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return
      const map: Record<string, string> = { '1': 'studio', '2': 'library', '3': 'gate', '4': 'blueprint' }
      if (map[ev.key]) setTab(map[ev.key])
      else if (ev.key === 'n') {
        ev.preventDefault()
        setTab('studio')
        promptRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // #16 — restore history + draft once mounted (microtask keeps hydration clean)
  useEffect(() => {
    let on = true
    Promise.resolve().then(() => {
      if (!on) return
      setHistory(loadHistory())
      const draft = localStorage.getItem(DRAFT_KEY)
      if (draft) setPrompt((p) => p || draft)
      // #15 — first-run tour, once ever
      if (!localStorage.getItem(TOUR_KEY)) setTourOpen(true)
    })
    return () => { on = false }
  }, [])

  const [tourOpen, setTourOpen] = useState(false)
  const closeTour = useCallback(() => {
    setTourOpen(false)
    try { localStorage.setItem(TOUR_KEY, '1') } catch {}
  }, [])

  // #18 — library view state
  const [libView, setLibView] = useState<'grid' | 'calendar'>('grid')
  const [calDay, setCalDay] = useState<string | null>(null)

  // #16 — debounced draft autosave
  useEffect(() => {
    const iv = setTimeout(() => {
      try {
        if (prompt.trim().length >= 3) localStorage.setItem(DRAFT_KEY, prompt)
      } catch {}
    }, 600)
    return () => clearTimeout(iv)
  }, [prompt])

  // ── polling: the server owns the run, we just watch ───────────────────────
  const isRunning = episode?.status === 'running'
  useEffect(() => {
    if (!episode || !isRunning || pollRef.current) return
    pollRef.current = true
    let stop = false
    const iv = setInterval(async () => {
      try {
        const res = await fetch(`/api/episodes/${episode.id}`)
        if (!res.ok) return
        const data = await res.json()
        if (stop) return
        setEpisode(data.episode)
        setCost(data.cost)
        if (data.episode?.status === 'ready') {
          clearInterval(iv)
          pollRef.current = false
          refreshStations()
          toast({
            title: 'Episode ready',
            description: `QC ${data.episode.qcScore}/110 — ${data.episode.title}`,
          })
        } else if (data.episode?.status === 'failed') {
          clearInterval(iv)
          pollRef.current = false
          refreshStations()
          toast({ title: 'Pipeline failed', description: 'Open the cockpit for the failing stage — Retry available.', variant: 'destructive' })
        }
      } catch {}
    }, live.connected ? 8000 : 2500) // socket pushes sub-second updates; HTTP is just a safety net
    return () => { stop = true; clearInterval(iv); pollRef.current = false }
  }, [episode?.id, isRunning, refreshStations, toast, live.connected])

  const generateOne = async () => {
    if (prompt.trim().length >= 3) pushHistory(prompt)
    if (activeStationId) {
      // CHANNEL MODE: another episode on the selected station (concept optional)
      setGenerating(true)
      try {
        const res = await fetch('/api/episodes', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stationId: activeStationId, prompt }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'failed')
        setEpisode(data.episode)
        setCost(data.cost)
        refreshStations()
        toast({
          title: `New episode on ${activeStation?.name ?? 'station'}`,
          description: 'Server is running the full pipeline — watch the cockpit.',
        })
      } catch (e) {
        toast({ title: 'Generation failed', description: String(e).slice(0, 160), variant: 'destructive' })
      } finally {
        setGenerating(false)
      }
      return
    }
    if (prompt.trim().length < 3) {
      toast({ title: 'Describe your station in a few words first', variant: 'destructive' })
      return
    }
    setGenerating(true)
    try {
      const res = await fetch('/api/studio/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'failed')
      setEpisode(data.episode)
      setCost(data.cost)
      setActiveStationId(data.station.id)
      refreshStations()
      toast({
        title: `Station online: ${data.station.name}`,
        description: 'Server is running the full pipeline — watch the cockpit.',
      })
    } catch (e) {
      toast({ title: 'Generation failed', description: String(e).slice(0, 160), variant: 'destructive' })
    } finally {
      setGenerating(false)
    }
  }

  const queueEpisodes = async () => {
    const concepts = queueInput.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 7)
    if (prompt.trim().length >= 3) pushHistory(prompt)
    concepts.forEach(pushHistory)
    if (!activeStationId && prompt.trim().length < 3) {
      toast({ title: 'Pick a station below, or describe a new one in the prompt box', variant: 'destructive' })
      return
    }
    setQueueBusy(true)
    try {
      const res = await fetch('/api/queue', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(activeStationId ? { stationId: activeStationId, concepts } : { prompt, concepts }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'failed')
      setQueueInput('')
      setActiveStationId(data.stationId)
      refreshQueue()
      refreshStations()
      toast({ title: `${data.queued} episode${data.queued === 1 ? '' : 's'} queued`, description: 'The channel factory renders them one by one — you can close this tab.' })
    } catch (e) {
      toast({ title: 'Queue failed', description: String(e).slice(0, 160), variant: 'destructive' })
    } finally {
      setQueueBusy(false)
    }
  }

  const retry = async () => {
    if (!episode) return
    setRetrying(true)
    try {
      const res = await fetch(`/api/episodes/${episode.id}/retry`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'failed')
      setEpisode({ ...episode, status: 'running' })
      toast({ title: 'Retry started', description: 'Server resumed the pipeline.' })
    } catch (e) {
      toast({ title: 'Retry failed', description: String(e).slice(0, 160), variant: 'destructive' })
    } finally {
      setRetrying(false)
    }
  }

  const doneCount = episode?.stages.filter((s) => s.status === 'done').length ?? 0
  const pct = Math.round((doneCount / STAGE_LIST.length) * 100)
  const failedStage = episode?.stages.find((s) => s.status === 'failed')

  const u = cost?.units
  const costChips = [
    u?.image ? `${u.image} img` : '',
    u?.video ? `${u.video} i2v` : '',
    u?.llm ? `${u.llm} llm` : '',
    u?.vlm ? `${u.vlm} vlm` : '',
    u?.ttsChars ? `${u.ttsChars} tts chars` : '',
  ].filter(Boolean)

  return (
    <div className="dark flex min-h-screen flex-col bg-gradient-to-b from-zinc-950 via-zinc-950 to-black text-zinc-200">
      {/* header */}
      <header className="sticky top-0 z-20 border-b border-zinc-800/80 bg-zinc-950/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-amber-400/30 bg-amber-400/10">
            <Radio className="h-5 w-5 text-amber-300" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-base font-bold tracking-tight text-zinc-50">RADIO FOUNDRY</h1>
              <Badge variant="outline" className="border-amber-400/40 text-[10px] text-amber-300">v6</Badge>
            </div>
            <p className="truncate text-[11px] text-zinc-500">One prompt → an attributed, broadcast-grade episode — or a whole channel run</p>
          </div>
          <button
            onClick={toggleNotif}
            aria-label={notifOn ? 'Disable completion notifications' : 'Enable completion notifications'}
            title={notifOn ? 'Notifications on — click to disable' : 'Get notified when episodes finish'}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 text-zinc-400 transition-colors hover:text-zinc-100"
          >
            {notifOn ? <BellRing className="h-4 w-4 text-amber-300" /> : <Bell className="h-4 w-4" />}
          </button>
          <div className="ml-auto hidden items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 sm:flex">
            <span className={`h-2 w-2 rounded-full ${live.connected ? 'bg-emerald-400' : 'animate-pulse bg-red-500'}`} />
            <span className="text-[11px] font-semibold tracking-wider text-zinc-300">{live.connected ? 'LIVE' : 'ON AIR'}</span>
            <span className="text-[11px] text-zinc-500">· gate ≥ {GATE_PASS}/{GATE_TOTAL}</span>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 pb-24 sm:pb-6">
        <Tabs value={tab} onValueChange={setTab} className="min-w-0">
          <TabsList className="mb-5 hidden flex-wrap bg-zinc-900 sm:flex">
            <TabsTrigger value="studio" className="gap-1.5"><Wand2 className="h-3.5 w-3.5" /> Studio</TabsTrigger>
            <TabsTrigger value="library" className="gap-1.5"><Library className="h-3.5 w-3.5" /> Library</TabsTrigger>
            <TabsTrigger value="gate" className="gap-1.5"><Gauge className="h-3.5 w-3.5" /> Ship Gate</TabsTrigger>
            <TabsTrigger value="blueprint" className="gap-1.5"><Layers className="h-3.5 w-3.5" /> Blueprint</TabsTrigger>
          </TabsList>

          {/* ── STUDIO ─────────────────────────────────────────────────── */}
          <TabsContent value="studio" className="min-w-0 space-y-6 data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:slide-in-from-bottom-2 data-[state=active]:duration-300">
            {/* one-prompt hero card */}
            <Card className="border-amber-400/25 bg-gradient-to-br from-amber-400/10 via-zinc-900/80 to-fuchsia-500/10">
              <CardHeader className="pb-3">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base text-zinc-50">
                  <Sparkles className="h-4 w-4 text-amber-300" />
                  {activeStation ? (
                    <>Channel mode — new episode for <span className="text-amber-300">{activeStation.name}</span></>
                  ) : (
                    <>One prompt → a finished episode</>
                  )}
                </CardTitle>
                <CardDescription className="text-xs text-zinc-400">
                  {activeStation
                    ? 'Concept optional — leave empty for standard programming. Charter, visuals, dual-track music, chrome, attribution, SEO, QC — all server-side.'
                    : 'Charter, DJ idents, style-locked visuals, i2v motion, dual-track synthwave, broadcast chrome, AI end card, attribution, SEO pack, QC — all server-side. Close the tab; the run keeps going.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Textarea
                  ref={promptRef}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={activeStation ? 'Episode concept (optional) — e.g. "the night the oracles went silent"…' : 'e.g. A midnight synthwave station where a cryptic DJ reads fake stock-market prophecies…'}
                  className="min-h-[84px] resize-none border-zinc-800 bg-zinc-950 text-sm text-zinc-100 placeholder:text-zinc-600"
                  maxLength={600}
                />
                <div className="flex flex-wrap gap-1.5">
                  {EXAMPLES.map((ex, i) => (
                    <button
                      key={i}
                      onClick={() => setPrompt(ex)}
                      className="max-w-full truncate rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 text-[11px] text-zinc-400 transition-colors hover:border-amber-400/40 hover:text-amber-200"
                    >
                      {ex.slice(0, 52)}…
                    </button>
                  ))}
                </div>
                {history.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-600">
                      <History className="h-3 w-3" /> recent
                    </span>
                    {history.slice(0, 5).map((h, i) => (
                      <button
                        key={i}
                        onClick={() => setPrompt(h)}
                        title={h}
                        className="max-w-[220px] truncate rounded-full border border-zinc-800/80 bg-zinc-950 px-2.5 py-1 text-[10px] text-zinc-500 transition-colors hover:border-amber-400/30 hover:text-amber-200"
                      >
                        {h}
                      </button>
                    ))}
                  </div>
                )}
                {/* #14 — advanced drawer: surprise-me + quick queue sizes */}
                <Collapsible>
                  <CollapsibleTrigger className="group flex items-center gap-1 text-[11px] text-zinc-500 transition-colors hover:text-zinc-300">
                    <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" />
                    Advanced
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-3 pt-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="outline" size="sm"
                        className="h-7 gap-1 border-zinc-700 text-xs text-zinc-300"
                        onClick={() => setPrompt(surprisePrompt())}
                      >
                        <Dice5 className="h-3.5 w-3.5" /> Surprise me
                      </Button>
                      <span className="text-[10px] text-zinc-600">roll a random station concept — free, client-side</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[10px] uppercase tracking-wider text-zinc-600">queue factory:</span>
                      {[3, 5, 7].map((n) => (
                        <Button
                          key={n}
                          variant="outline" size="sm"
                          disabled={!activeStationId}
                          className="h-7 border-zinc-700 px-2 text-[11px] text-zinc-300"
                          onClick={() => setQueueInput(Array.from({ length: n }, () => surprisePrompt().slice(0, 120)).join('\n'))}
                        >
                          {n} concepts
                        </Button>
                      ))}
                      <span className="text-[10px] text-zinc-600">{activeStationId ? 'fills the queue box with random episode concepts' : 'select a station first'}</span>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
                <Button onClick={generateOne} disabled={generating || isRunning} className="w-full bg-amber-400 font-semibold text-zinc-950 hover:bg-amber-300">
                  {generating || isRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Film className="mr-2 h-4 w-4" />}
                  {generating ? 'Designing charter…' : isRunning ? 'Pipeline running…' : activeStation ? 'Generate next episode' : 'Generate episode'}
                </Button>
              </CardContent>
            </Card>

            <div className="grid min-w-0 gap-6 lg:grid-cols-2">
              {/* left: cockpit */}
              <div className="min-w-0 space-y-6">
                <Card className="border-zinc-800 bg-zinc-900/70">
                  <CardHeader className="pb-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <CardTitle className="text-sm font-semibold uppercase tracking-wider text-amber-300">Pipeline cockpit</CardTitle>
                      <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {fmtDur(episode?.durationSec)}</span>
                        <span className="flex items-center gap-1"><Coins className="h-3 w-3" /> {cost ? `~$${cost.estUsd.toFixed(3)}` : '$0'}</span>
                        {costChips.length > 0 && <span className="font-mono text-zinc-600">{costChips.join(' · ')}</span>}
                      </div>
                    </div>
                    <Progress value={pct} className="mt-2 h-1.5 bg-zinc-800 [&_[data-slot=progress-indicator]]:bg-amber-400" />
                  </CardHeader>
                  <CardContent>
                    {!episode ? (
                      <div className="py-6 text-center text-sm text-zinc-500">No episode running — generate one above.</div>
                    ) : (
                      <>
                        <ul className="max-h-[420px] space-y-1 overflow-y-auto pr-1">
                        {failedStage && (
                          <li className="mb-2 space-y-2 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2">
                            <div className="flex items-start gap-2">
                              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-red-300">{failedStage.name} failed</p>
                                <p className="mt-0.5 break-words text-[11px] text-red-400/80">{failedStage.error}</p>
                              </div>
                            </div>
                            <Button size="sm" className="h-7 w-full gap-1 bg-red-500/90 text-white hover:bg-red-500" onClick={retry} disabled={retrying}>
                              {retrying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                              Retry stage (server resumes)
                            </Button>
                          </li>
                        )}
                        {STAGE_LIST.map((def) => {
                          const st = episode.stages.find((s) => s.key === def.key)
                          const Icon = STAGE_ICONS[def.key] ?? Radio
                          const { chip, note } = stageChip(def.key, st)
                          return (
                            <li key={def.key} className="flex items-start gap-2.5 rounded-md px-2 py-1.5 min-w-0">
                              <StageIcon status={st?.status ?? 'pending'} />
                              <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${st?.status === 'running' ? 'text-amber-300' : 'text-zinc-600'}`} />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-baseline gap-x-2">
                                  <span className={`text-xs ${st?.status === 'done' ? 'text-zinc-300' : st?.status === 'running' ? 'text-amber-200' : 'text-zinc-500'}`}>{def.name}</span>
                                  {st?.ms != null && <span className="font-mono text-[10px] text-zinc-600">{fmtMs(st.ms)}</span>}
                                  {chip && <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-amber-300/90">{chip}</span>}
                                  {st?.retries ? <span className="font-mono text-[10px] text-fuchsia-400/80">↻{st.retries}</span> : null}
                                </div>
                                {st?.status === 'running' && note && (
                                  <p className="truncate font-mono text-[10px] text-amber-300/70">{note}</p>
                                )}
                                {st?.error && <p className="mt-0.5 break-words text-[11px] text-red-400">{st.error}</p>}
                              </div>
                            </li>
                          )
                        })}
                        </ul>
                        <LiveLogTail stages={episode.stages} />
                      </>
                    )}
                  </CardContent>
                </Card>

                {/* result */}
                {episode?.status === 'ready' && (
                  <Card className="border-zinc-800 bg-zinc-900/70">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-semibold uppercase tracking-wider text-amber-300">Result — “{episode.title}”</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ResultPanel episode={episode} onOpenWorkspace={() => openWorkspace(episode.id)} />
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* right: station identity + channel queue */}
              <div className="min-w-0 space-y-6">
                <Card className="border-zinc-800 bg-zinc-900/70">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold uppercase tracking-wider text-amber-300">Stations — click to enter channel mode</CardTitle>
                    {stationsLoading ? (
                      <Skeleton className="h-7 w-48 bg-zinc-800" />
                    ) : stations.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {stations.slice(0, 8).map((s) => (
                          <button
                            key={s.id}
                            onClick={() => setActiveStationId((cur) => (cur === s.id ? null : s.id))}
                            className={`max-w-[180px] truncate rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                              activeStationId === s.id
                                ? 'border-amber-400/60 bg-amber-400/15 text-amber-200'
                                : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                            }`}
                            title={activeStationId === s.id ? 'Click to exit channel mode' : `Queue episodes for ${s.name}`}
                          >
                            {s.name}
                            {s.stats ? ` · ${s.stats.episodeCount}` : ''}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </CardHeader>
                  <CardContent>
                    {activeStation ? (
                      <div className="min-w-0 space-y-4">
                        <CharterView station={activeStation} />
                        {activeStation.stats && (
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            {[
                              ['Episodes', String(activeStation.stats.episodeCount)],
                              ['Ready', String(activeStation.stats.readyCount)],
                              ['Avg QC', activeStation.stats.avgQc != null ? `${activeStation.stats.avgQc}` : '—'],
                              ['Est. cost', `~$${activeStation.stats.estUsd.toFixed(2)}`],
                            ].map(([k, v]) => (
                              <div key={k} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
                                <div className="text-[10px] uppercase tracking-wider text-zinc-500">{k}</div>
                                <div className="mt-0.5 font-mono text-sm text-amber-300">{v}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : station ? (
                      <CharterView station={station} />
                    ) : (
                      <div className="py-8 text-center text-sm text-zinc-500">
                        No station yet — one prompt above designs the full charter.
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* channel queue — the factory */}
                <Card className="border-zinc-800 bg-zinc-900/70">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold uppercase tracking-wider text-amber-300">Channel queue — plan a run of episodes</CardTitle>
                    <CardDescription className="text-xs text-zinc-500">
                      One concept per line (max 7). {activeStation ? `Queued on ${activeStation.name}.` : 'Without a selected station, the prompt box above designs a brand-new station first.'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Textarea
                      value={queueInput}
                      onChange={(e) => setQueueInput(e.target.value)}
                      placeholder={'the signal arrives from a drowned city\na 3 AM prophecy about the weather\nlistener call-in hour (all voices synthetic)'}
                      className="min-h-[72px] resize-none border-zinc-800 bg-zinc-950 text-sm text-zinc-100 placeholder:text-zinc-600"
                    />
                    <Button onClick={queueEpisodes} disabled={queueBusy || isRunning} variant="outline" className="w-full border-amber-400/40 text-amber-200 hover:bg-amber-400/10">
                      {queueBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Clock className="mr-2 h-4 w-4" />}
                      Queue episodes
                    </Button>
                    {activeQueueRows.length > 0 && (
                      <ul className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
                        {activeQueueRows.map((q) => {
                          const st = stations.find((s) => s.id === q.stationId)
                          return (
                            <li key={q.id} className="flex items-start gap-2 rounded-md border border-zinc-800/70 bg-zinc-950/60 px-2.5 py-1.5">
                              {q.status === 'done' ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                                : q.status === 'failed' ? <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
                                : q.status === 'running' ? <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-amber-300" />
                                : <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-600" />}
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs text-zinc-300">
                                  {q.prompt || 'standard programming block'}
                                  <span className="ml-1.5 text-[10px] text-zinc-500">· {st?.name ?? 'station'}</span>
                                </p>
                                {q.error && <p className="truncate text-[10px] text-red-400">{q.error}</p>}
                              </div>
                              {q.episodeId && q.status === 'done' && (
                                <button onClick={() => openWorkspace(q.episodeId!)} className="shrink-0 text-[10px] text-amber-300 hover:underline">
                                  open
                                </button>
                              )}
                              {q.status === 'pending' && (
                                <button
                                  onClick={() => cancelQueueItem(q.id)}
                                  aria-label="Cancel queued episode"
                                  title="Cancel this queued episode"
                                  className="shrink-0 rounded p-0.5 text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              )}
                              {q.status === 'failed' && (
                                <button
                                  onClick={() => retryQueueItem(q.id)}
                                  aria-label="Requeue failed episode"
                                  title="Requeue for another attempt"
                                  className="shrink-0 rounded p-0.5 text-zinc-500 transition-colors hover:bg-amber-400/10 hover:text-amber-300"
                                >
                                  <RotateCcw className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </CardContent>
                </Card>

                {/* #5 — cost dashboard across all channels */}
                <CostDashboard stations={stations} />
              </div>
            </div>
          </TabsContent>

          {/* ── LIBRARY ────────────────────────────────────────────────── */}
          <TabsContent value="library" className="min-w-0 data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:slide-in-from-bottom-2 data-[state=active]:duration-300">
            <Card className="border-zinc-800 bg-zinc-900/70">
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-sm font-semibold uppercase tracking-wider text-amber-300">Episode library — grouped by channel</CardTitle>
                    <CardDescription className="text-xs text-zinc-500">Click a card to open the full workspace · hover to scrub the master.</CardDescription>
                  </div>
                  {/* #18 — grid / calendar view toggle */}
                  <div className="flex shrink-0 items-center rounded-md border border-zinc-800 bg-zinc-950 p-0.5">
                    {(['grid', 'calendar'] as const).map((v) => (
                      <button
                        key={v}
                        onClick={() => { setLibView(v); if (v === 'grid') setCalDay(null) }}
                        aria-pressed={libView === v}
                        className={`flex items-center gap-1 rounded px-2.5 py-1 text-[11px] transition-colors ${
                          libView === v ? 'bg-zinc-800 text-amber-200' : 'text-zinc-500 hover:text-zinc-300'
                        }`}
                      >
                        {v === 'grid' ? <Layers className="h-3 w-3" /> : <CalendarDays className="h-3 w-3" />}
                        {v}
                      </button>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="min-w-0 space-y-6">
                {libView === 'calendar' && !stationsLoading && (
                  <EpisodeCalendar
                    episodes={stations.flatMap((s) => s.episodes ?? [])}
                    selectedDay={calDay}
                    onSelectDay={setCalDay}
                  />
                )}
                {stationsLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-5 w-40 bg-zinc-800" />
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {[0, 1, 2].map((i) => (
                        <div key={i} className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/60">
                          <Skeleton className="aspect-video w-full rounded-none bg-zinc-800/80" />
                          <div className="space-y-2 p-3">
                            <Skeleton className="h-4 w-3/4 bg-zinc-800" />
                            <Skeleton className="h-3 w-1/2 bg-zinc-800/70" />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : stations.length === 0 ? (
                  <div className="py-10 text-center text-sm text-zinc-500">Nothing rendered yet.</div>
                ) : (
                  stations.map((s) => {
                    const eps = (s.episodes ?? []).slice()
                      .filter((e) => !calDay || e.createdAt.slice(0, 10) === calDay) // #18 day filter
                      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                    if (eps.length === 0) return null
                    return (
                      <div key={s.id} className="min-w-0 space-y-3">
                        {/* channel header + stats */}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-zinc-800/80 pb-2">
                          <button
                            onClick={() => { setActiveStationId(s.id); setTab('studio') }}
                            className="truncate text-sm font-semibold text-zinc-100 transition-colors hover:text-amber-300"
                          >
                            {s.name}
                          </button>
                          <Badge variant="outline" className="border-fuchsia-400/40 text-[10px] text-fuchsia-300">{s.genre}</Badge>
                          {s.stats && (
                            <div className="ml-auto flex flex-wrap items-center gap-2 font-mono text-[10px] text-zinc-500">
                              <span>{s.stats.episodeCount} ep</span>
                              <span>· {fmtDur(s.stats.totalSec)} total</span>
                              {s.stats.avgQc != null && <span className={s.stats.avgQc >= GATE_PASS ? 'text-emerald-400' : 'text-amber-400'}>· avg QC {s.stats.avgQc}/{GATE_TOTAL}</span>}
                              <span>· ~${s.stats.estUsd.toFixed(2)}</span>
                            </div>
                          )}
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                          {eps.map((e) => (
                            <LibraryCard key={e.id} e={e} onOpen={() => openWorkspace(e.id)} />
                          ))}
                        </div>
                      </div>
                    )
                  })
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── SHIP GATE ──────────────────────────────────────────────── */}
          <TabsContent value="gate" className="min-w-0 data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:slide-in-from-bottom-2 data-[state=active]:duration-300">
            <Card className="border-zinc-800 bg-zinc-900/70">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold uppercase tracking-wider text-amber-300">Ship Gate — {GATE_TOTAL} points, publish at ≥ {GATE_PASS}</CardTitle>
                <CardDescription className="text-xs text-zinc-500">Items marked “auto” are measured by the QC stage with ffprobe + R128 + VLM evidence.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 sm:grid-cols-2">
                  {SHIP_GATE.map((g) => (
                    <div key={g.id} className="flex items-start gap-3 rounded-lg border border-zinc-800/70 bg-zinc-950/60 p-3 min-w-0">
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-400/10 font-mono text-[11px] font-bold text-amber-300">{g.id}</span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-zinc-100">{g.title}</span>
                          <Badge variant="secondary" className="bg-zinc-800 text-[10px] text-zinc-400">{g.points} pts</Badge>
                          {g.automated && <Badge variant="secondary" className="bg-emerald-500/10 text-[10px] text-emerald-300">auto</Badge>}
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-zinc-400">{g.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── BLUEPRINT ──────────────────────────────────────────────── */}
          <TabsContent value="blueprint" className="min-w-0 data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:slide-in-from-bottom-2 data-[state=active]:duration-300">
            <div className="grid min-w-0 gap-6 lg:grid-cols-2">
              <Card className="border-zinc-800 bg-zinc-900/70">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold uppercase tracking-wider text-amber-300">Why v1 died → what v5 does instead</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-3 text-sm">
                    {[
                      ['F1 · Static slideshow visuals', 'v1: four stills on a 36s loop repeated 4×. → v6: two scenes come ALIVE via CogVideoX i2v (ping-pong seamless) and the FULL episode is rendered as three rotating motion blocks with alternating zoom directions — no more 40-second déjà vu. ~$0.12/episode.'],
                      ['F2 · Style drift across visuals', 'Each image went its own way. → v6: one charter style-lock sentence prepended to every prompt + VLM gate with strict retry.'],
                      ['F3 · Stock/CC0 sourcing roulette', 'License risk + download flakiness. → v6: 100% self-generated (procedural music engine + AI visuals + synthetic voice). Nothing to attribute to third parties.'],
                      ['F4 · Slapdash assembly', 'Hard cuts, no broadcast grammar. → v6: radio grammar (idents + jingle), sidechain ducking, R128 loudness, dual-track A/B bed, chrome v2 (ticker, VU meter, progress bar, lower-thirds) + full-screen AI end card, cinematic FX pass.'],
                      ['F5 · No quality gate', 'Shipped on vibes. → v6: 110-point gate with ffprobe/R128/freeze/VLM evidence — every point earned from measurement, auto-revise pass, publish at ≥ 90.'],
                    ].map(([t, d], i) => (
                      <li key={i} className="rounded-lg border border-zinc-800/70 bg-zinc-950/60 p-3 min-w-0">
                        <p className="text-xs font-semibold text-red-300/90">{t}</p>
                        <p className="mt-1 text-xs leading-relaxed text-zinc-300">{d}</p>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
              <div className="min-w-0 space-y-6">
                <Card className="border-zinc-800 bg-zinc-900/70">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold uppercase tracking-wider text-amber-300">Cost guards (per episode)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[380px] text-left text-xs">
                        <thead className="text-zinc-500">
                          <tr><th className="py-1.5">Call</th><th className="py-1.5">Cap</th><th className="py-1.5">Fallback</th></tr>
                        </thead>
                        <tbody className="text-zinc-300">
                          {[
                            ['LLM (charter/rundown/metadata)', '10', 'deterministic defaults'],
                            ['Images (hero + 4 scenes + retries)', '9', 'reuse previous scene'],
                            ['VLM style + QC checks', '10', 'accept + log'],
                            ['TTS idents', '6 / 2500 chars', 'ident skipped, logged'],
                            ['Video-gen (i2v motion)', '2 clips', 'ken-burns covers it'],
                            ['ffmpeg / synth', 'local, unlimited', '—'],
                          ].map(([a, b, c], i) => (
                            <tr key={i} className="border-t border-zinc-800/60">
                              <td className="py-1.5 pr-2">{a}</td>
                              <td className="py-1.5 pr-2 font-mono text-amber-300/90">{b}</td>
                              <td className="py-1.5 text-zinc-400">{c}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-amber-400/30 bg-gradient-to-br from-amber-400/10 to-fuchsia-500/5">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold uppercase tracking-wider text-amber-300">Definition of done</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm leading-relaxed text-zinc-200">
                      One prompt in → a finished, attributed, 1080p broadcast-grade radio episode out —
                      self-scored ≥ 90/110 on the Ship Gate, with ATTRIBUTION.md, designed thumbnail, and YouTube
                      metadata in the export pack. Every render reproducible from its seed. The server owns the run.
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </main>

      {/* #1 episode detail workspace — player · QC frame evidence · ledger · metadata · timings */}
      <EpisodeWorkspace episodeId={workspaceId} open={workspaceOpen} onOpenChange={setWorkspaceOpen} />

      {/* #15 first-run tour */}
      <FirstRunTour open={tourOpen} onClose={closeTour} />

      {/* #10 — mobile bottom navigation (desktop keeps the top TabsList) */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-800/80 bg-zinc-950/95 backdrop-blur sm:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex">
          {TAB_DEFS.map((t) => {
            const Icon = t.icon
            const active = tab === t.value
            return (
              <button
                key={t.value}
                onClick={() => setTab(t.value)}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 text-[10px] transition-colors ${
                  active ? 'text-amber-300' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {t.label}
              </button>
            )
          })}
        </div>
      </nav>

      {/* footer — sticky via mt-auto */}
      <footer className="mt-auto border-t border-zinc-800/80 bg-zinc-950 pb-16 sm:pb-0">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3 text-[11px] text-zinc-500">
          <span>Radio Foundry v6 — every asset self-generated or logged in the ledger. No third-party material, no fair-use gambles.</span>
          <span className="hidden items-center gap-1.5 md:flex" title="Keyboard shortcuts">
            <Keyboard className="h-3 w-3" /> 1–4 switch tabs · n new prompt
          </span>
          <span className="font-mono">synth DSP v3 · cogvideox i2v · ffmpeg 7.1.5 · z-ai sdk · prisma</span>
        </div>
      </footer>
    </div>
  )
}
