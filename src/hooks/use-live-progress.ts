'use client'

// ─── Live pipeline progress (#20) + completion notifications (#19) ───────────
// One socket.io connection to the standalone progress service (XTransformPort).
// Replaces the 2.5s HTTP polling loop; HTTP polling stays as automatic
// fallback when the socket is down (the hook reports `connected`).

import { useEffect, useRef, useState, useCallback } from 'react'
import { io, type Socket } from 'socket.io-client'

export interface LiveStage {
  id: string; key: string; name: string; status: string; retries: number
  ms: number | null; error: string | null; outputJson: string | null
}
export interface LiveEpisode {
  id: string; status: string; title: string; qcScore: number | null
  durationSec: number | null; videoPath: string | null; thumbPath: string | null
  stages: LiveStage[]
}
export interface QueueLiveRow {
  id: string; stationId: string | null; prompt: string; status: string
  episodeId: string | null; error: string | null; createdAt: string
}
export interface DoneEvent {
  episodeId: string; status: 'ready' | 'failed'; title: string
  qcScore: number | null; stationName: string | null; at: number
}

const STORAGE_KEY = 'rf-notifications'

export function notificationsEnabled(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(STORAGE_KEY) === 'on'
}

export async function enableNotifications(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false
  const perm = await Notification.requestPermission()
  if (perm === 'granted') {
    localStorage.setItem(STORAGE_KEY, 'on')
    return true
  }
  return false
}

export function disableNotifications() {
  try { localStorage.setItem(STORAGE_KEY, 'off') } catch {}
}

export function useLiveProgress(onDone?: (ev: DoneEvent) => void) {
  const [connected, setConnected] = useState(false)
  const [running, setRunning] = useState<Record<string, LiveEpisode>>({})
  const [queue, setQueue] = useState<QueueLiveRow[]>([])
  const [lastDone, setLastDone] = useState<DoneEvent | null>(null)
  const doneCb = useRef(onDone)
  useEffect(() => { doneCb.current = onDone }, [onDone])
  const sockRef = useRef<Socket | null>(null)

  useEffect(() => {
    // Never use PORT in the URL, always use XTransformPort
    // DO NOT change the path, it is used by Caddy to forward the request to the correct port
    const sock = io('/?XTransformPort=3003', {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 12,
      reconnectionDelay: 1500,
      timeout: 8000,
    })
    sockRef.current = sock

    const applyEpisode = (ep: LiveEpisode) => {
      if (ep.status !== 'running') {
        // finished episodes drop out of the live map; the done event handles the UI
        setRunning((prev) => {
          if (!prev[ep.id]) return prev
          const next = { ...prev }
          delete next[ep.id]
          return next
        })
        return
      }
      setRunning((prev) => ({ ...prev, [ep.id]: ep }))
    }

    sock.on('connect', () => setConnected(true))
    sock.on('disconnect', () => setConnected(false))
    sock.on('episode:snapshot', (eps: LiveEpisode[]) => {
      setRunning(Object.fromEntries(eps.filter((e) => e.status === 'running').map((e) => [e.id, e])))
    })
    sock.on('episode:progress', applyEpisode)
    sock.on('queue:snapshot', (rows: QueueLiveRow[]) => setQueue(rows))
    sock.on('queue:progress', (rows: QueueLiveRow[]) => setQueue(rows))
    sock.on('episode:done', (ev: DoneEvent) => {
      setLastDone(ev)
      doneCb.current?.(ev)
      // browser notification (#19) — fires even when the tab is in background
      if (notificationsEnabled() && 'Notification' in window && Notification.permission === 'granted') {
        try {
          const body = ev.status === 'ready'
            ? `QC ${ev.qcScore ?? '?'}/110 — ready to upload` + (ev.stationName ? ` · ${ev.stationName}` : '')
            : `A stage failed — open the cockpit to retry.` + (ev.stationName ? ` · ${ev.stationName}` : '')
          const n = new Notification(ev.status === 'ready' ? `📺 Episode ready: ${ev.title}` : `⚠️ Episode failed: ${ev.title}`, { body })
          n.onclick = () => { window.focus(); n.close() }
        } catch {}
      }
    })

    return () => { sock.disconnect(); sockRef.current = null }
  }, [])

  const clearDone = useCallback(() => setLastDone(null), [])

  return { connected, running, queue, lastDone, clearDone }
}
