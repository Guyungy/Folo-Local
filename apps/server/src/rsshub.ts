import { db, getLocalSetting, setLocalSetting } from "./db.js"

/**
 * RSSHub routes are served by community instances that come and go without notice. The upstream
 * app points every route at one official instance; a local edition has to live with whatever
 * instance the user pasted — and with that instance disappearing.
 *
 * So routes are decoupled from instances: a route (e.g. `/ithome/ranking/24h`) is resolved
 * against a pool of instances, ordered by health, and the instance that last served a route is
 * remembered so the next refresh does not re-probe a dead mirror first.
 */

export interface RsshubInstance {
  url: string
  enabled: boolean
  position: number
  /** Consecutive failures; reset on the first success. Drives pool ordering. */
  failureCount: number
  latencyMs: number | null
  lastCheckedAt: string | null
  lastSuccessAt: string | null
  lastError: string | null
  /** Feeds whose last successful fetch came from this instance. */
  feedCount: number
}

/**
 * Seeded once on a fresh database. Verified reachable when written, but community instances rot:
 * the pool UI shows health and lets the user disable, extend or replace them.
 */
const DEFAULT_INSTANCES = [
  "https://rsshub.ktachibana.party",
  "https://rsshub.liumingye.cn",
  "https://rsshub.woodland.cafe",
  "https://rsshub.app",
  "https://hub.slarker.me",
  "https://rsshub.rssforever.com",
]

/** Used when the user has no RSSHub-backed subscription to probe with. */
export const FALLBACK_PROBE_ROUTE = "/github/trending/daily/any"

const PREFERRED_INSTANCE_KEY = "rsshub_base_url"
const PROBE_TIMEOUT_MS = 10_000

export const normalizeInstanceURL = (value: string) => {
  const url = new URL(value.trim())
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "RSSHub instance must be an HTTP(S) base URL without credentials, query or fragment",
    )
  if (!url.hostname) throw new Error("RSSHub instance must have a host")
  return url.href.replace(/\/$/, "")
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

const asNumber = (value: unknown, fallback = 0) => (typeof value === "number" ? value : fallback)

const mapInstanceRow = (row: Record<string, unknown>): RsshubInstance => ({
  url: String(row.url),
  enabled: asNumber(row.enabled, 1) === 1,
  position: asNumber(row.position),
  failureCount: asNumber(row.failure_count),
  latencyMs: (row.latency_ms as number | null) ?? null,
  lastCheckedAt: (row.last_checked_at as string | null) ?? null,
  lastSuccessAt: (row.last_success_at as string | null) ?? null,
  lastError: (row.last_error as string | null) ?? null,
  feedCount: asNumber(row.feed_count),
})

/** An explicitly configured instance (env override or the user's pick) is always tried first. */
export const preferredInstanceURL = (): string | null => {
  const configured = process.env.RSSHUB_BASE_URL || getLocalSetting(PREFERRED_INSTANCE_KEY)
  if (!configured) return null
  try {
    return normalizeInstanceURL(configured)
  } catch {
    return null
  }
}

const instanceRow = (url: string) =>
  db.prepare("SELECT * FROM rsshub_instances WHERE url=?").get(url) as
    Record<string, unknown> | undefined

const isUsable = (url: string) => instanceRow(url)?.enabled !== 0

const enabledInstances = () =>
  (
    db
      .prepare(
        `SELECT * FROM rsshub_instances WHERE enabled=1
        ORDER BY failure_count ASC, position ASC, latency_ms IS NULL, latency_ms ASC`,
      )
      .all() as Record<string, unknown>[]
  ).map(mapInstanceRow)

export const listInstances = (): RsshubInstance[] =>
  (
    db
      .prepare(
        `SELECT i.*, (SELECT COUNT(*) FROM feeds f WHERE f.source_instance_url = i.url) feed_count
        FROM rsshub_instances i ORDER BY i.position ASC, i.url ASC`,
      )
      .all() as Record<string, unknown>[]
  ).map(mapInstanceRow)

export const ensureInstancePool = () => {
  const { count } = db.prepare("SELECT COUNT(*) count FROM rsshub_instances").get() as {
    count: number
  }
  if (count > 0) return
  db.transaction(() => {
    const insert = db.prepare(
      "INSERT OR IGNORE INTO rsshub_instances (url, position) VALUES (?, ?)",
    )
    DEFAULT_INSTANCES.forEach((url, index) => insert.run(url, index))
  })()
}

export const addInstance = (value: string) => {
  const url = normalizeInstanceURL(value)
  const existing = instanceRow(url)
  if (existing) {
    db.prepare("UPDATE rsshub_instances SET enabled=1 WHERE url=?").run(url)
  } else {
    const { next } = db
      .prepare("SELECT COALESCE(MAX(position), -1) + 1 next FROM rsshub_instances")
      .get() as { next: number }
    db.prepare("INSERT INTO rsshub_instances (url, position) VALUES (?, ?)").run(url, next)
  }
  return listInstances()
}

export const setInstanceEnabled = (value: string, enabled: boolean) => {
  const url = normalizeInstanceURL(value)
  db.prepare("UPDATE rsshub_instances SET enabled=? WHERE url=?").run(enabled ? 1 : 0, url)
  return listInstances()
}

export const resetInstances = () => {
  db.exec("DELETE FROM rsshub_route_affinity; DELETE FROM rsshub_instances;")
  ensureInstancePool()
  return listInstances()
}

/** The user's preferred instance, which also seeds the pool so it shows up in the settings UI. */
export const setRSSHubBaseURL = (value: string) => {
  const url = normalizeInstanceURL(value)
  setLocalSetting(PREFERRED_INSTANCE_KEY, url)
  addInstance(url)
}

export const getRSSHubBaseURL = () =>
  preferredInstanceURL() ?? enabledInstances()[0]?.url ?? DEFAULT_INSTANCES[0]

/**
 * Hosts that speak the RSSHub route protocol. Disabled and de-listed instances stay known, so a
 * subscription pointing at one can still be re-homed onto a live member of the pool.
 */
export const isInstanceHost = (host: string) => {
  if (DEFAULT_INSTANCES.some((url) => new URL(url).host === host)) return true
  if (hostOf(process.env.RSSHUB_BASE_URL ?? "") === host) return true
  const known = db.prepare("SELECT url FROM rsshub_instances").all() as { url: string }[]
  return known.some((row) => hostOf(row.url) === host)
}

/**
 * `rsshub://zhihu/hot` and `https://instance.example/zhihu/hot` name the same route: the instance
 * is interchangeable, the route is not. Returns null when the URL is not an instance route.
 */
export const routeFromURL = (url: URL): string | null => {
  if (url.protocol === "rsshub:") {
    const route = `/${url.host}${url.pathname}${url.search}`
    return route === "/" ? null : route
  }
  if (!["http:", "https:"].includes(url.protocol)) return null
  if (!isInstanceHost(url.host)) return null
  const route = `${url.pathname}${url.search}`
  return route.replace(/\/+$/, "").length <= 1 ? null : route
}

/** Routes worth probing: the ones the user actually subscribes to. */
export const subscribedPoolRoutes = (limit = 3): string[] => {
  const rows = db
    .prepare(
      `SELECT f.url FROM feeds f WHERE EXISTS (SELECT 1 FROM subscriptions s WHERE s.feed_id=f.id)
      ORDER BY f.title IS NULL, f.title`,
    )
    .all() as { url: string }[]
  const routes: string[] = []
  for (const row of rows) {
    let url: URL
    try {
      url = new URL(row.url)
    } catch {
      continue
    }
    const route = routeFromURL(url)
    if (route && !routes.includes(route)) routes.push(route)
    if (routes.length >= limit) break
  }
  return routes
}

export const getRouteAffinity = (route: string): string | null => {
  const row = db
    .prepare("SELECT instance_url FROM rsshub_route_affinity WHERE route=?")
    .get(route) as { instance_url: string } | undefined
  if (!row) return null
  return isUsable(row.instance_url) ? row.instance_url : null
}

export const setRouteAffinity = (
  route: string,
  instanceUrl: string,
  now = new Date().toISOString(),
) => {
  db.prepare(
    `INSERT INTO rsshub_route_affinity (route, instance_url, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(route) DO UPDATE SET instance_url=excluded.instance_url, updated_at=excluded.updated_at`,
  ).run(route, instanceUrl, now)
}

export const recordInstanceSuccess = (url: string, latencyMs: number) => {
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO rsshub_instances (url, enabled, position, failure_count, latency_ms, last_checked_at, last_success_at, last_error)
    VALUES (@url, 1, (SELECT COALESCE(MAX(position), -1) + 1 FROM rsshub_instances), 0, @latency, @now, @now, NULL)
    ON CONFLICT(url) DO UPDATE SET failure_count=0, latency_ms=@latency, last_checked_at=@now, last_success_at=@now, last_error=NULL`,
  ).run({ url, latency: Math.max(0, Math.round(latencyMs)), now })
}

export const recordInstanceFailure = (url: string, message: string) => {
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO rsshub_instances (url, enabled, position, failure_count, latency_ms, last_checked_at, last_success_at, last_error)
    VALUES (@url, 1, (SELECT COALESCE(MAX(position), -1) + 1 FROM rsshub_instances), 1, NULL, @now, NULL, @message)
    ON CONFLICT(url) DO UPDATE SET failure_count=failure_count + 1, last_checked_at=@now, last_error=@message`,
  ).run({ url, message: message.slice(0, 300), now })
}

/**
 * Instances to try for a route, best first: the user's pick, then whichever instance served this
 * route last, then the rest of the pool by health.
 */
export const candidateInstances = (route: string): string[] => {
  const urls: string[] = []
  const push = (url: string | null | undefined) => {
    if (url && !urls.includes(url)) urls.push(url)
  }
  push(preferredInstanceURL())
  push(getRouteAffinity(route))
  for (const instance of enabledInstances()) push(instance.url)
  return urls
}

export interface InstanceProbeResult {
  route: string
  ok: boolean
  status: number | null
  latencyMs: number
  error: string | null
}

const looksLikeFeed = (body: string) => /<rss|<feed|<rdf/i.test(body)

/**
 * Fetches real routes from one instance and folds the outcome back into its health, so "test"
 * answers the question that actually matters: can this instance serve my subscriptions?
 */
export const probeInstance = async (
  value: string,
  routes: string[],
): Promise<InstanceProbeResult[]> => {
  const base = normalizeInstanceURL(value)
  const targets = routes.length ? routes : [FALLBACK_PROBE_ROUTE]
  const results: InstanceProbeResult[] = []

  for (const route of targets) {
    const target = `${base}${route.startsWith("/") ? route : `/${route}`}`
    const startedAt = Date.now()
    try {
      const response = await fetch(target, {
        headers: {
          accept:
            "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1",
          "user-agent": "FoLocal/1.13.0 (+https://github.com/Guyungy/Folo-Local)",
        },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      })
      const latencyMs = Date.now() - startedAt
      const body = response.ok ? await response.text() : ""
      if (response.ok && looksLikeFeed(body)) {
        results.push({ route, ok: true, status: response.status, latencyMs, error: null })
        recordInstanceSuccess(base, latencyMs)
      } else {
        const error = response.ok ? "response was not RSS or Atom" : `HTTP ${response.status}`
        results.push({ route, ok: false, status: response.status, latencyMs, error })
      }
    } catch (error) {
      const latencyMs = Date.now() - startedAt
      const message =
        error instanceof Error && error.name === "TimeoutError"
          ? `timed out after ${PROBE_TIMEOUT_MS / 1000} seconds`
          : error instanceof Error
            ? error.message
            : "request failed"
      results.push({ route, ok: false, status: null, latencyMs, error: message })
    }
  }

  const failed = results.filter((result) => !result.ok)
  if (failed.length === results.length && failed.length > 0)
    recordInstanceFailure(base, failed[0]!.error ?? "probe failed")

  return results
}

ensureInstancePool()
