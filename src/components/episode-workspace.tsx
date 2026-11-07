'use client'

// ─── Episode Detail Workspace (#1) + Frame-evidence QC view (#3) ─────────────
// One dialog that aggregates everything known about an episode:
// inline player · QC scorecard with visual frame receipts · asset ledger ·
// attribution · YouTube metadata pack · stage timing waterfall.

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useToast } from '@/hooks/use-toast'
import {
  CheckCircle2, AlertTriangle, Loader2, Copy, Download, Film, Eye,
  Layers, FileText, Sparkles, Gauge, Coins, Clock, ImageIcon, Music4, Type,
  ScanSearch, ShieldCheck,
} from 'lucide-react'
import { GATE_PASS, GATE_TOTAL } from '@/lib/gate'
import { STAGE_LIST } from '@/lib/stages-client'
import type { MetadataPack, QcFrame, QcReport, CostUnits } from '@/lib/types'

// ─── DB-row mirrors (structural — matches /api/episodes/[id] payload) ────────
interface StationRow {
  id: string; name: string; handle: string; tagline: string; genre: string
  charterJson: string; paletteJson: string; costJson: string; createdAt: string
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

function fmtDur(sec: number | null | undefined) {
  if (!sec) return '—'
  return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`
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

// ─── frame evidence strip (#3): every QC claim gets a visual receipt ─────────
function FrameEvidence({ qc }: { qc: QcReport }) {
  const [zoom, setZoom] = useState<QcFrame | null>(null)
  const checked = (qc.frames ?? []).filter((f) => f.tag !== 'filmstrip')
  const strip = (qc.frames ?? []).filter((f) => f.tag === 'filmstrip')

  const verdictBadge = (f: QcFrame) =>
    f.ok === true ? (
      <Badge className="bg-emerald-500/15 text-[10px] text-emerald-300">VLM OK</Badge>
    ) : f.ok === false ? (
      <Badge className="bg-red-500/15 text-[10px] text-red-300">VLM ISSUE</Badge>
    ) : (
      <Badge variant="secondary" className="bg-zinc-800 text-[10px] text-zinc-400">evidence</Badge>
    )

  if ((qc.frames ?? []).length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-800 p-4 text-center text-xs text-zinc-500">
        No frame receipts stored for this episode (rendered before frame-evidence QC). Re-render or retry the QC stage to collect them.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* VLM-checked frames — the receipt next to the verdict */}
      {checked.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {checked.map((f, i) => (
            <div key={i} className="min-w-0 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
              <button onClick={() => setZoom(f)} className="group relative block w-full cursor-zoom-in" aria-label={`Enlarge ${f.tag} frame`}>
                <img src={f.path} alt={`${f.tag} evidence frame at ${f.atSec}s`} className="aspect-video w-full object-cover" />
                <span className="absolute left-2 top-2 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[10px] text-zinc-200">
                  {f.tag} @ {fmtDur(f.atSec)}
                </span>
              </button>
              <div className="space-y-1.5 p-2.5">
                <div className="flex items-center gap-1.5">{verdictBadge(f)}</div>
                {f.note && <p className="break-words font-mono text-[11px] leading-relaxed text-zinc-400">{f.note}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* filmstrip — visual variety across the whole master */}
      {strip.length > 0 && (
        <div className="min-w-0">
          <div className="mb-1.5 text-xs uppercase tracking-wider text-zinc-500">Full-episode filmstrip — visual variety receipt</div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {strip.map((f, i) => (
              <button key={i} onClick={() => setZoom(f)} className="group relative min-w-0 cursor-zoom-in overflow-hidden rounded-md border border-zinc-800" aria-label={`Enlarge frame at ${f.atSec}s`}>
                <img src={f.path} alt={`Filmstrip frame at ${f.atSec}s`} className="aspect-video w-full object-cover transition-transform group-hover:scale-105" />
                <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1 py-0.5 font-mono text-[9px] text-zinc-200">{fmtDur(f.atSec)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* lightbox */}
      <Dialog open={zoom !== null} onOpenChange={(v) => !v && setZoom(null)}>
        <DialogContent className="dark max-w-4xl border-zinc-800 bg-zinc-950 p-3 text-zinc-200">
          {zoom && (
            <div className="min-w-0 space-y-2">
              <img src={zoom.path} alt={`${zoom.tag} at ${zoom.atSec}s`} className="w-full rounded-md" />
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                <span className="font-mono text-zinc-300">{zoom.tag} @ {fmtDur(zoom.atSec)}</span>
                {verdictBadge(zoom)}
                {zoom.note && <span className="min-w-0 flex-1 break-words font-mono text-[11px]">{zoom.note}</span>}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── stage timing waterfall ──────────────────────────────────────────────────
function StageTimings({ stages }: { stages: StageRow[] }) {
  const rows = STAGE_LIST.map((def) => stages.find((s) => s.key === def.key)).filter(Boolean) as StageRow[]
  const maxMs = Math.max(...rows.map((s) => s.ms ?? 0), 1)
  const totalMs = rows.reduce((a, s) => a + (s.ms ?? 0), 0)
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>Measured wall-clock per stage</span>
        <span className="font-mono text-zinc-400">total {fmtMs(totalMs)}</span>
      </div>
      {rows.map((s) => {
        const pct = Math.round(((s.ms ?? 0) / maxMs) * 100)
        return (
          <div key={s.id} className="min-w-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-xs">
              <span className={s.status === 'done' ? 'text-zinc-200' : 'text-zinc-500'}>{s.name}</span>
              <span className="font-mono text-[10px] text-zinc-500">
                {s.ms != null ? fmtMs(s.ms) : s.status}
                {s.retries ? <span className="ml-1 text-fuchsia-400/80">↻{s.retries}</span> : null}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-800">
              <div
                className={`h-full rounded-full ${s.status === 'done' ? 'bg-amber-400/80' : s.status === 'failed' ? 'bg-red-500/80' : 'bg-zinc-600'}`}
                style={{ width: `${Math.max(pct, 3)}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function fmtMs(ms: number | null | undefined) {
  if (!ms) return ''
  return ms > 60_000 ? `${(ms / 60_000).toFixed(1)}m` : `${(ms / 1000).toFixed(1)}s`
}

// ─── main workspace dialog ───────────────────────────────────────────────────
export function EpisodeWorkspace({
  episodeId, open, onOpenChange,
}: {
  episodeId: string | null
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { toast } = useToast()
  const [episode, setEpisode] = useState<EpisodeRow | null>(null)
  const [cost, setCost] = useState<{ units: CostUnits; estUsd: number } | null>(null)
  const [innerTab, setInnerTab] = useState('player')

  useEffect(() => {
    if (!open || !episodeId) return
    let stop = false
    fetch(`/api/episodes/${episodeId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('not found'))))
      .then((d) => {
        if (stop) return
        setEpisode(d.episode)
        setCost(d.cost)
      })
      .catch(() => { if (!stop) toast({ title: 'Could not load episode', variant: 'destructive' }) })
    return () => { stop = true }
  }, [open, episodeId, toast])

  // loading = dialog open but the fetched episode isn't the requested one yet
  const loading = open && episode?.id !== episodeId

  const qc = (() => {
    try { return episode?.qcJson ? (JSON.parse(episode.qcJson) as QcReport) : null } catch { return null }
  })()
  const meta = (() => {
    try { return episode?.metadataJson ? (JSON.parse(episode.metadataJson) as MetadataPack) : null } catch { return null }
  })()

  const assetIcon = (kind: string) =>
    kind === 'audio' ? <Music4 className="h-3.5 w-3.5" />
    : kind === 'video' ? <Film className="h-3.5 w-3.5" />
    : kind === 'doc' ? <FileText className="h-3.5 w-3.5" />
    : <ImageIcon className="h-3.5 w-3.5" />

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dark max-w-5xl gap-0 overflow-hidden border-zinc-800 bg-zinc-950 p-0 text-zinc-200 sm:max-w-5xl">
        <DialogHeader className="border-b border-zinc-800 bg-zinc-900/60 px-5 py-4 text-left">
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-8 text-base text-zinc-50">
            <Film className="h-4 w-4 text-amber-300" />
            <span className="min-w-0 truncate">{episode?.title ?? 'Episode workspace'}</span>
            {episode?.qcScore != null && (
              <Badge className={episode.qcScore >= GATE_PASS ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}>
                QC {episode.qcScore}/{GATE_TOTAL}
              </Badge>
            )}
            {episode?.status === 'ready' && <Badge className="bg-emerald-500/15 text-[10px] text-emerald-300">READY</Badge>}
            {episode?.status === 'running' && <Badge className="bg-amber-500/15 text-[10px] text-amber-300">RUNNING</Badge>}
            {episode?.status === 'failed' && <Badge className="bg-red-500/15 text-[10px] text-red-300">FAILED</Badge>}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
            {episode?.station?.name && <span className="text-zinc-400">{episode.station.name}</span>}
            {episode?.station?.genre && <span>· {episode.station.genre}</span>}
            <span>· {fmtDur(episode?.durationSec)}</span>
            {cost && <span className="flex items-center gap-1">· <Coins className="h-3 w-3" /> ~${cost.estUsd.toFixed(3)}</span>}
            {episode && <span>· seed {episode.seed}</span>}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading workspace…
          </div>
        )}

        {!loading && episode && (
          <Tabs key={episode.id} value={innerTab} onValueChange={setInnerTab} className="flex min-h-0 flex-1 flex-col">
            <TabsList className="mx-4 mt-3 flex-wrap bg-zinc-900">
              <TabsTrigger value="player" className="gap-1.5"><Film className="h-3.5 w-3.5" /> Player</TabsTrigger>
              <TabsTrigger value="evidence" className="gap-1.5"><ScanSearch className="h-3.5 w-3.5" /> QC evidence</TabsTrigger>
              <TabsTrigger value="metadata" className="gap-1.5"><Sparkles className="h-3.5 w-3.5" /> Metadata</TabsTrigger>
              <TabsTrigger value="ledger" className="gap-1.5"><Layers className="h-3.5 w-3.5" /> Ledger</TabsTrigger>
              <TabsTrigger value="attribution" className="gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> Attribution</TabsTrigger>
              <TabsTrigger value="timeline" className="gap-1.5"><Clock className="h-3.5 w-3.5" /> Timeline</TabsTrigger>
            </TabsList>

            <div className="max-h-[70vh] overflow-y-auto p-4 sm:max-h-[64vh]">
              {/* PLAYER */}
              <TabsContent value="player" className="min-w-0 space-y-4">
                <div className="overflow-hidden rounded-xl border border-zinc-800 bg-black">
                  {episode.videoPath ? (
                    <video src={episode.videoPath} controls poster={episode.thumbPath ?? undefined} preload="metadata" className="aspect-video w-full" />
                  ) : (
                    <div className="flex aspect-video items-center justify-center text-sm text-zinc-500">master not rendered</div>
                  )}
                </div>
                {episode.thumbPath && (
                  <div className="flex flex-wrap items-center gap-3">
                    <img src={episode.thumbPath} alt="Episode thumbnail" className="h-14 w-24 rounded border border-zinc-800 object-cover" />
                    <div className="min-w-0 text-xs text-zinc-500">
                      <div className="text-zinc-300">Designed thumbnail 1280×720</div>
                      <div>{episode.prompt ? `concept: ${episode.prompt.slice(0, 80)}` : 'standard programming block'}</div>
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {episode.videoPath && (
                    <Button asChild variant="outline" size="sm" className="border-zinc-700 text-zinc-200">
                      <a href={episode.videoPath} download><Download className="mr-1 h-4 w-4" /> Master MP4</a>
                    </Button>
                  )}
                  {episode.thumbPath && (
                    <Button asChild variant="outline" size="sm" className="border-zinc-700 text-zinc-200">
                      <a href={episode.thumbPath} download><Download className="mr-1 h-4 w-4" /> Thumbnail</a>
                    </Button>
                  )}
                  {episode.attributionMd && (
                    <Button asChild variant="outline" size="sm" className="border-zinc-700 text-zinc-200">
                      <a href={`data:text/markdown;charset=utf-8,${encodeURIComponent(episode.attributionMd)}`} download="ATTRIBUTION.md">
                        <Download className="mr-1 h-4 w-4" /> ATTRIBUTION.md
                      </a>
                    </Button>
                  )}
                </div>
              </TabsContent>

              {/* QC EVIDENCE */}
              <TabsContent value="evidence" className="min-w-0 space-y-4">
                {qc ? (
                  <>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className={`text-3xl font-bold ${qc.passed ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {qc.score}<span className="text-sm text-zinc-500">/{qc.total}</span>
                      </span>
                      <Badge className={qc.passed ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}>
                        {qc.passed ? `PUBLISHABLE (≥${GATE_PASS})` : 'NEEDS REVISION'}
                      </Badge>
                      {qc.revised && <Badge className="bg-fuchsia-500/15 text-fuchsia-300">auto-revised</Badge>}
                      <span className="text-xs text-zinc-500">
                        {qc.probe.width}×{qc.probe.height} · {fmtDur(qc.probe.durationSec)} · {qc.probe.lufs?.toFixed(1) ?? '—'} LUFS
                      </span>
                    </div>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {qc.items.map((it) => (
                        <div key={it.id} className="flex items-start gap-2 rounded-md px-2 py-1 text-xs min-w-0">
                          {it.earned === it.points
                            ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                            : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />}
                          <div className="min-w-0">
                            <span className="text-zinc-200">{it.label}</span>
                            <span className="ml-1 font-mono text-zinc-500">{it.earned}/{it.points}</span>
                            <div className="break-words text-[11px] text-zinc-500">{it.detail}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <Separator className="bg-zinc-800" />
                    <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-zinc-500">
                      <Eye className="h-3.5 w-3.5" /> Frame evidence — every verdict has a receipt
                    </div>
                    <FrameEvidence qc={qc} />
                    {qc.vlmNotes && qc.vlmNotes.length > 0 && (
                      <div className="space-y-1">
                        <div className="text-xs uppercase tracking-wider text-zinc-500">VLM log</div>
                        {qc.vlmNotes.map((n, i) => (
                          <p key={i} className="break-words font-mono text-[11px] text-zinc-400">{n}</p>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="py-8 text-center text-sm text-zinc-500">No QC report yet — episode still rendering or failed before QC.</div>
                )}
              </TabsContent>

              {/* METADATA */}
              <TabsContent value="metadata" className="min-w-0 space-y-3">
                {meta ? (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs uppercase tracking-wider text-zinc-500">Title</span>
                      <CopyBtn text={meta.youtubeTitle} label="Title copied" />
                    </div>
                    <p className="break-words text-sm font-medium text-zinc-100">{meta.youtubeTitle}</p>
                    <Separator className="bg-zinc-800" />
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs uppercase tracking-wider text-zinc-500">Description</span>
                      <CopyBtn
                        text={`${meta.youtubeDescription}\n\n${meta.chapters.map((c) => c.t + ' ' + c.label).join('\n')}\n\n${meta.disclosure}`}
                        label="Description copied"
                      />
                    </div>
                    <p className="max-h-40 overflow-y-auto break-words whitespace-pre-wrap text-xs leading-relaxed text-zinc-300">{meta.youtubeDescription}</p>
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
                    <CopyBtn
                      text={[meta.youtubeTitle, '', meta.youtubeDescription, '', meta.chapters.map((c) => c.t + ' ' + c.label).join('\n'), '', 'TAGS: ' + meta.tags.join(', '), '', 'DISCLOSURE: ' + meta.disclosure].join('\n')}
                      label="Full upload kit copied"
                    />
                  </>
                ) : (
                  <div className="py-8 text-center text-sm text-zinc-500">No metadata pack yet.</div>
                )}
              </TabsContent>

              {/* LEDGER */}
              <TabsContent value="ledger" className="min-w-0 space-y-2">
                <div className="flex items-center justify-between text-xs text-zinc-500">
                  <span>{episode.assets.length} assets · full provenance for every generated file</span>
                </div>
                <div className="max-h-[52vh] overflow-y-auto rounded-lg border border-zinc-800">
                  <table className="w-full min-w-[560px] text-left text-xs">
                    <thead className="sticky top-0 bg-zinc-900 text-zinc-500">
                      <tr>
                        <th className="px-2.5 py-2">Role</th>
                        <th className="px-2.5 py-2">Tool</th>
                        <th className="px-2.5 py-2">Model</th>
                        <th className="px-2.5 py-2">License</th>
                        <th className="px-2.5 py-2">Prompt</th>
                      </tr>
                    </thead>
                    <tbody className="text-zinc-300">
                      {episode.assets.map((a) => (
                        <tr key={a.id} className="border-t border-zinc-800/60 align-top">
                          <td className="px-2.5 py-2">
                            <span className="flex items-center gap-1.5 whitespace-nowrap text-zinc-200">
                              {assetIcon(a.kind)} <span className="font-mono text-[11px]">{a.role}</span>
                            </span>
                          </td>
                          <td className="px-2.5 py-2 font-mono text-[11px] text-amber-300/90">{a.tool}</td>
                          <td className="max-w-[120px] truncate px-2.5 py-2 font-mono text-[11px] text-zinc-500" title={a.model}>{a.model || '—'}</td>
                          <td className="px-2.5 py-2"><Badge variant="secondary" className="bg-emerald-500/10 text-[10px] text-emerald-300">{a.license}</Badge></td>
                          <td className="max-w-[220px] px-2.5 py-2 text-[11px] text-zinc-500" title={a.prompt}>
                            <span className="line-clamp-2 break-words">{a.prompt || '—'}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </TabsContent>

              {/* ATTRIBUTION */}
              <TabsContent value="attribution" className="min-w-0 space-y-3">
                {episode.attributionMd ? (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-zinc-500">
                        <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" /> ATTRIBUTION.md
                      </div>
                      <CopyBtn text={episode.attributionMd} label="Attribution copied" />
                    </div>
                    <pre className="max-h-[52vh] overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-zinc-900 p-3 text-[11px] leading-relaxed text-zinc-400">
                      {episode.attributionMd}
                    </pre>
                  </>
                ) : (
                  <div className="py-8 text-center text-sm text-zinc-500">No attribution doc yet.</div>
                )}
              </TabsContent>

              {/* TIMELINE */}
              <TabsContent value="timeline" className="min-w-0 space-y-3">
                <Card className="border-zinc-800 bg-zinc-900/50">
                  <CardContent className="pt-4">
                    <StageTimings stages={episode.stages} />
                  </CardContent>
                </Card>
                <Card className="border-zinc-800 bg-zinc-900/50">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm text-zinc-200">
                      <Gauge className="h-4 w-4 text-amber-300" /> Cost units
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-wrap gap-2">
                    {cost && Object.entries(cost.units).filter(([, v]) => v).map(([k, v]) => (
                      <span key={k} className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-[11px] text-zinc-300">
                        {k}: {String(v)}
                      </span>
                    ))}
                    {cost && <span className="rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-1 font-mono text-[11px] text-amber-300">est ${cost.estUsd.toFixed(3)}</span>}
                    {!cost && <span className="text-xs text-zinc-500">no cost recorded</span>}
                  </CardContent>
                </Card>
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-xs text-zinc-500">
                  <span className="flex items-center gap-1.5 text-zinc-400"><Type className="h-3.5 w-3.5" /> Episode prompt</span>
                  <p className="mt-1 break-words text-zinc-400">{episode.prompt || 'standard programming block'}</p>
                </div>
              </TabsContent>
            </div>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  )
}
