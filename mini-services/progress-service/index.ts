// ─── Live progress service (#20) ─────────────────────────────────────────────
// Standalone socket.io service that watches the SQLite DB directly and pushes
// pipeline progress to every connected browser in real time.
// Deliberately OUTSIDE the Next.js process: hot-reloads can't kill the watcher,
// and the Next API routes stay polling-free.
//
// Emits:
//   episode:progress  — full snapshot of one running episode (stages included)
//   episode:done      — an episode just transitioned to ready | failed  (#19 hook)
//   queue:progress    — channel-factory queue snapshot
// On connect:
//   episode:snapshot   — all currently running episodes
//   queue:snapshot     — current queue

import { createServer } from 'http'
import { Server } from 'socket.io'
import { Database } from 'bun:sqlite'

const DB_PATH = process.env.DB_PATH ?? '/home/z/my-project/db/custom.db'
const PORT = 3003
const POLL_MS = 1200

const httpServer = createServer()
const io = new Server(httpServer, {
  // DO NOT change the path, it is used by Caddy to forward the request to the correct port
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
})

// read-only handle — the Prisma process owns writes
const db = new Database(DB_PATH, { readonly: true })
const qRunning = db.prepare(`SELECT * FROM Episode WHERE status = 'running' ORDER BY createdAt ASC`)
const qAny = db.prepare(`SELECT * FROM Episode WHERE id = ?`)
const qStages = db.prepare(`SELECT id, key, name, status, retries, ms, error, outputJson FROM StageRun WHERE episodeId = ? ORDER BY "order" ASC`)
const qQueue = db.prepare(`SELECT * FROM QueueItem ORDER BY createdAt DESC LIMIT 40`)

type Row = Record<string, unknown>

function episodeSnapshot(ep: Row) {
  return {
    id: ep.id as string,
    status: ep.status as string,
    title: ep.title as string,
    qcScore: ep.qcScore as number | null,
    durationSec: ep.durationSec as number | null,
    videoPath: ep.videoPath as string | null,
    thumbPath: ep.thumbPath as string | null,
    stages: qStages.all(ep.id as string),
  }
}

// last-seen episode statuses — the transition detector for episode:done
const lastStatus = new Map<string, string>()

function pollOnce() {
  // 1 ─ transitions of ANY episode (running → ready/failed, incl. queue runs
  //     the browser may not have open)
  const all = db.prepare(`SELECT id, status, title, qcScore, stationId FROM Episode`).all() as Row[]
  for (const ep of all) {
    const prev = lastStatus.get(ep.id as string)
    if (prev && prev !== ep.status && (ep.status === 'ready' || ep.status === 'failed')) {
      let stationName: string | null = null
      try {
        const st = db.prepare(`SELECT name FROM Station WHERE id = ?`).get(ep.stationId as string) as Row | null
        stationName = (st?.name as string) ?? null
      } catch {}
      io.emit('episode:done', {
        episodeId: ep.id,
        status: ep.status,
        title: ep.title,
        qcScore: ep.qcScore,
        stationName,
        at: Date.now(),
      })
    }
    lastStatus.set(ep.id as string, ep.status as string)
  }

  // 2 ─ running-episode progress (only when something actually changed)
  const running = qRunning.all() as Row[]
  for (const ep of running) {
    const snap = episodeSnapshot(ep)
    const hash = JSON.stringify(snap)
    if (hash !== progressHashes.get(snap.id)) {
      progressHashes.set(snap.id, hash)
      io.emit('episode:progress', snap)
    }
  }
  // prune hashes of episodes that are no longer running
  const runningIds = new Set(running.map((e) => e.id as string))
  for (const id of [...progressHashes.keys()]) if (!runningIds.has(id)) progressHashes.delete(id)

  // 3 ─ queue snapshot (only on change)
  const queue = qQueue.all() as Row[]
  const queueHash = JSON.stringify(queue)
  if (queueHash !== lastQueueHash) {
    lastQueueHash = queueHash
    io.emit('queue:progress', queue)
  }
}
const progressHashes = new Map<string, string>()
let lastQueueHash = ''

io.on('connection', (socket) => {
  // immediate catch-up so a freshly opened tab shows live state without waiting a poll
  const running = qRunning.all() as Row[]
  socket.emit('episode:snapshot', running.map(episodeSnapshot))
  socket.emit('queue:snapshot', qQueue.all())
  // seed transition detector with current statuses so we never fire stale dones
  for (const ep of db.prepare(`SELECT id, status FROM Episode`).all() as Row[]) {
    lastStatus.set(ep.id as string, ep.status as string)
  }
})

setInterval(() => {
  try { pollOnce() } catch (e) { console.error('[progress] poll error:', String(e).slice(0, 200)) }
}, POLL_MS)

httpServer.listen(PORT, () => {
  console.log(`[progress] live progress service on :${PORT} → db ${DB_PATH}`)
})

process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))
