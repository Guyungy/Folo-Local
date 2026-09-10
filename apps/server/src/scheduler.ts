import { db, getLocalSetting, setLocalSetting } from "./db.js"
import { refreshFeed } from "./rss.js"

/**
 * The upstream app relies on a server-side crawl plus push notifications. This local edition has
 * no such backend, so this module is the replacement: a timer that walks the subscribed feeds,
 * honours HTTP validators, and records when each feed was last visited.
 */

export const DEFAULT_REFRESH_INTERVAL_MINUTES = 60
const REFRESH_INTERVAL_KEY = "refresh_interval_minutes"
const CONCURRENCY = 3
/** Delay before the first sweep so startup is not competing with the UI for network and disk. */
const STARTUP_DELAY_MS = 15_000

export interface RefreshRunResult {
  total: number
  failed: number
  notModified: number
  startedAt: string
  finishedAt: string
}

export interface RefreshRunState extends RefreshRunResult {
  /** True while a sweep is in flight; the UI uses this to show progress. */
  running: boolean
}

let running: Promise<RefreshRunResult> | null = null
let lastRun: RefreshRunResult | null = null
let timer: ReturnType<typeof setInterval> | null = null
let startupTimer: ReturnType<typeof setTimeout> | null = null

export const getRefreshIntervalMinutes = () => {
  const stored = getLocalSetting(REFRESH_INTERVAL_KEY)
  if (stored === null) return DEFAULT_REFRESH_INTERVAL_MINUTES
  const minutes = Number(stored)
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : DEFAULT_REFRESH_INTERVAL_MINUTES
}

export const setRefreshIntervalMinutes = (minutes: number) => {
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 24 * 60)
    throw new Error("Refresh interval must be between 0 and 1440 minutes")
  setLocalSetting(REFRESH_INTERVAL_KEY, String(Math.floor(minutes)))
  restartRefreshScheduler()
}

const subscribedFeedIds = () =>
  (
    db
      .prepare(
        "SELECT f.id FROM feeds f WHERE EXISTS (SELECT 1 FROM subscriptions s WHERE s.feed_id=f.id) ORDER BY f.last_refreshed_at IS NOT NULL, f.last_refreshed_at",
      )
      .all() as { id: string }[]
  ).map((row) => row.id)

/** Feeds that were never fetched, or whose last visit is older than the configured interval. */
const dueFeedIds = (intervalMinutes: number) => {
  const cutoff = new Date(Date.now() - intervalMinutes * 60_000).toISOString()
  return (
    db
      .prepare(
        `SELECT f.id FROM feeds f
        WHERE EXISTS (SELECT 1 FROM subscriptions s WHERE s.feed_id=f.id)
          AND (f.last_refreshed_at IS NULL OR f.last_refreshed_at <= ?)
        ORDER BY f.last_refreshed_at IS NOT NULL, f.last_refreshed_at
        LIMIT 200`,
      )
      .all(cutoff) as { id: string }[]
  ).map((row) => row.id)
}

const markFailure = (feedId: string, error: unknown) => {
  db.prepare("UPDATE feeds SET error_at=?, error_message=? WHERE id=?").run(
    new Date().toISOString(),
    error instanceof Error ? error.message : String(error),
    feedId,
  )
}

export const refreshFeedsByIds = async (feedIds: string[]): Promise<RefreshRunResult> => {
  const startedAt = new Date().toISOString()
  let failed = 0
  let notModified = 0
  let cursor = 0

  const worker = async () => {
    for (;;) {
      const index = cursor++
      const feedId = feedIds[index]
      if (feedId === undefined) return
      const row = db.prepare("SELECT url FROM feeds WHERE id=?").get(feedId) as
        { url: string } | undefined
      if (!row) continue
      try {
        const result = await refreshFeed(row.url, { conditional: true })
        if (result.notModified) notModified += 1
        db.prepare("UPDATE feeds SET error_at=NULL, error_message=NULL WHERE id=?").run(feedId)
      } catch (error) {
        failed += 1
        markFailure(feedId, error)
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, feedIds.length) }, worker))

  return {
    total: feedIds.length,
    failed,
    notModified,
    startedAt,
    finishedAt: new Date().toISOString(),
  }
}

export const refreshAllSubscribedFeeds = () => refreshFeedsByIds(subscribedFeedIds())

/**
 * Single-flight wrapper: a sweep already in flight is returned instead of starting a second one,
 * so the timer, the startup sweep and a manual "refresh all" never overlap.
 */
export const runRefreshSweep = (feedIds: string[]): Promise<RefreshRunResult> => {
  if (running) return running
  const promise = refreshFeedsByIds(feedIds)
    .then((result) => {
      lastRun = result
      return result
    })
    .finally(() => {
      running = null
    })
  running = promise
  return promise
}

/**
 * Manual "refresh everything" from the UI. Going through the single-flight wrapper keeps it from
 * overlapping a timer sweep, and makes the run visible in the status the UI polls.
 */
export const runFullRefreshSweep = () => runRefreshSweep(subscribedFeedIds())

const sweepDueFeeds = async () => {
  const interval = getRefreshIntervalMinutes()
  if (interval === 0) return
  const ids = dueFeedIds(interval)
  if (ids.length === 0) return
  await runRefreshSweep(ids).catch(() => {
    // Individual failures are recorded per feed; nothing else to report here.
  })
}

export const startRefreshScheduler = () => {
  restartRefreshScheduler()
  if (startupTimer) clearTimeout(startupTimer)
  startupTimer = setTimeout(() => {
    startupTimer = null
    void sweepDueFeeds()
  }, STARTUP_DELAY_MS)
  startupTimer.unref?.()
}

export const stopRefreshScheduler = () => {
  if (timer) clearInterval(timer)
  if (startupTimer) clearTimeout(startupTimer)
  timer = null
  startupTimer = null
}

const restartRefreshScheduler = () => {
  if (timer) clearInterval(timer)
  timer = null
  const interval = getRefreshIntervalMinutes()
  if (interval === 0) return
  timer = setInterval(() => void sweepDueFeeds(), interval * 60_000)
  timer.unref?.()
}

export const getRefreshStatus = (): RefreshRunState | null =>
  lastRun ? { ...lastRun, running: running !== null } : null

export const isRefreshRunning = () => running !== null
