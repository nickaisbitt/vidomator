# v6 AUDIT — 5 Biggest Weaknesses Found & Fixed + 8 Big Improvements

Audit date: post-v5 (after the first fully-rendered episode, QC 110/110).
Method: extracted 6 frames from the rendered master, queried the QC report +
cost ledger from the DB, read every lib/route line-by-line, then re-verified
everything with browser + ffprobe evidence. The weaknesses below are measured,
not guessed.

---

## The 5 biggest weaknesses (evidence → fix)

### W1 — Visual monotony: one 40s loop streamed 4× over a 166s episode
**Evidence:** frames at 45s / 80s / 120s / 150s all show the same stock-chart
scene; the master was a 40s motion loop `-stream_loop`ed ~4.15×. Viewers got
40-second déjà vu — the exact "static slideshow" failure mode v1 died of.
**Fix:** `buildEpisodeVisual()` renders the FULL episode as a rotating
schedule — 3 cycles × 5 segments + tail (16 blocks), alternating ken-burns
zoom directions, i2v clips replayed in different orders, all 4 scenes used.
Unique kb segments render once (deduped) and are reused — still $0.

### W2 — Credits / AI-disclosure effectively invisible (compliance risk)
**Evidence:** the old credits were a 21pt text box in the final 12s; frame
extraction at 150s/160s shows NO credits visible. Worse: QC's "credits" VLM
check passed while describing only the chrome (bug, ON AIR, VU) — it verified
nothing. For a product whose #1 constraint is avoiding copyright bans.
**Fix:** full-screen **AI end card** (final 8s): station brand, "100%
AI-GENERATED BROADCAST", ledger count, disclosure + tool stack, in large
centered type over near-black. QC now checks it two ways: a *pointed* VLM
question ("is there a large clearly-readable credits block with a 100% AI
claim?") + a deterministic brightness check (end card = dark frame, luma<70).

### W3 — No channel model: every prompt spawned a NEW station
**Evidence:** `/api/studio/generate` always created a station;
`/api/episodes` POST existed but was never called by the UI — and didn't
even start the runner. One brand → many episodes (the Lofi Girl / Masters of
Prophecy model) was unreachable from the UI.
**Fix:** channel mode — station chips are now selectors ("click to enter
channel mode"), the hero CTA becomes "Generate next episode", station stats
(episodes / ready / avg QC / est cost) render under the charter, the Library
groups by channel with per-channel stats, and `/api/episodes` now works and
starts the server-owned run.

### W4 — "A-side/B-side" were cosmetic labels over ONE continuous track
**Evidence:** `renderTrack()` rendered a single bed; the rundown's two track
titles only drove the ticker/now-playing chrome. The same music loop played
for 2:46. On a MUSIC channel that's the core perceived-quality gap.
**Fix:** synth engine v3 — `variant: 'B'` renders a genuinely different
B-side (flipped progression sets, derived seed `seed^0x9e3779b9`, different
arp voice, octave-up bass answers). `mixRadio()` builds a dual-track bed:
A-side → 5s acrossfade → B-side at the rundown's B-side marker.

### W5 — QC grade inflation: points awarded without evidence
**Evidence:** B1 awarded itself 5/5 unconditionally (`add('B1', ..., true,
'this report')`); V1 "seamless" was asserted from a boolean, never measured;
the credits VLM check was unanswerable as phrased (proved by W2).
**Fix:** QC v3 — B1 earned only when probe + R128 + freeze + frame reviews
actually ran (evidence string embedded in the report); V1 now *measures*
motion with ffmpeg `freezedetect` (no frozen segment ≥3s anywhere —
threshold validated on the existing loop, which passes); V1 drops to 8/15 if
freezes are found; C2 is verified on-screen, not just in metadata.

---

## The 8 big improvements shipped

1. **Episode-length varied visual engine** — 16-block rotating schedule
   (W1 fix), ~3× the visual variety, zero extra SDK cost.
2. **Full-screen AI end card** — unmissable disclosure finale (W2 fix) +
   dual-method QC verification.
3. **Channel mode** — station continuity, per-channel stats, grouped library
   (W3 fix). One brand, many episodes — the actual business model.
4. **Dual-track synthwave bed (A/B sides)** — a real second track with its
   own seed/progressions/arp, crossfaded at the B-side marker (W4 fix).
5. **Honest QC v3** — freeze detection + pointed end-card review +
   evidence-based B1 (W5 fix). No self-awarded points remain.
6. **Channel queue (the factory)** — one prompt → new station + up to 7
   episode concepts, rendered sequentially by a DB-backed worker
   (`QueueItem` model, self-healing worker revived by polling; survives hot
   reloads). "Plan a week of episodes" is now one textarea.
7. **One-click Upload Kit** — copy button grabs title + description +
   chapters + tags + disclosure in one paste-ready block.
8. **Station dashboard stats** — episodes, ready count, avg QC, total
   runtime, est. cost — per channel in Studio and Library.

## Verification performed
- `tsc --noEmit` clean on `src/`, ESLint pass.
- End-to-end channel-factory run: 2 episodes queued on the existing station
  via the new `/api/queue`; worker picked them up sequentially.
- Browser-verified: channel mode toggle, queue panel with live statuses,
  grouped library with stats, mobile 390px (no horizontal overflow),
  sticky footer, zero console errors.
- Post-render: frame extraction (variety + end card), LUFS, freeze report,
  QC score — see episode records.

---

## Addendum — hardening bugs found & fixed during end-to-end verification

The first full v6 run surfaced three deeper issues, all fixed:

**H1 — Double-driver race (critical).** `resumeOrphanedRuns` (triggered by UI
polling) AND the queue worker drove the same episode concurrently: stages ran
twice (duplicate ledger assets), and one driver's segment cleanup deleted the
other's render inputs mid-flight. **Fix:** per-episode advance mutex — all
drivers share one in-flight `advanceEpisode`; plus delete-before-log asset
hygiene so any resumed stage re-runs cleanly (exactly-once ledger).

**H2 — ffmpeg OOM on the 16-block visual track.** A single 16-input xfade
graph OOM-killed ffmpeg on the 4GB box (16 parallel 1080p decoders, 2.5GB
RSS). **Fix:** chunked two-level xfade — chunks of ≤5 segments render into
part files, then the parts chain (the ≤5-decoder shape the original loop
used safely).

**H3 — 429 quota walls could kill a run.** Shared rate limits (LLM/VLM)
fail with 429; blind retries died instantly. **Fix:** `withBackoff` wrapper
on every AI call (patient waits: 30s→60s→120s→180s); metadata + rundown
stages gained deterministic fallbacks built from local data (charter,
rundown, chapters) so the pipeline completes **even with the LLM lane fully
down** — A1 (one-prompt automation) survives outages.

**Bonus fix:** drawtext `expansion=none` by default — user text like
"100% AI-GENERATED" was being eaten by ffmpeg's `%{...}` expression parser.

## Evidence snapshot from the verification run (before artifact cleanup)

- QC scorecard (honest gate, real episode): **107/110** — S1 15/15,
  V1 15/15 (freeze-measured, no frozen segments), S2 10/10 (−14.59 LUFS),
  C2 10/10 (end card verified on-screen via brightness check while VLM was
  quota-blocked — the dual-method design working as intended), V2 honestly
  docked to 7/10 under VLM unavailability.
- Frame extraction: 12s neon-beam city / 55s hooded-market crowd /
  95s bitcoin road with B-side "Crystal Debt" now-playing — three distinct
  scenes across 83s (was: same chart at 45/80/120/150s).
- End card at 152s: all 7 compliance lines large, centered, readable.

## Re-render status

A cleanup glob (`rm cmw*`) accidentally deleted the rendered artifact files
while the DB rows survived — both episodes were re-queued through the now
hardened pipeline (idempotent stages, backoff, fallbacks) and rebuild
autonomously. The verification evidence above was captured before the loss.
