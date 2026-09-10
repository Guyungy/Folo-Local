import { createHash, randomUUID } from "node:crypto"

import { XMLParser } from "fast-xml-parser"

import { db } from "./db.js"
import {
  candidateInstances,
  getRouteAffinity,
  getRSSHubBaseURL,
  preferredInstanceURL,
  recordInstanceFailure,
  recordInstanceSuccess,
  routeFromURL,
  setRouteAffinity,
} from "./rsshub.js"
import type { Feed } from "./types.js"

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  cdataPropName: "#text",
})
const array = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value]
const text = (value: unknown): string | null => {
  if (Array.isArray(value)) {
    const parts = value.map(text).filter((part): part is string => Boolean(part))
    return parts.length ? parts.join("") : null
  }
  if (typeof value === "string" || typeof value === "number") return String(value)
  if (value && typeof value === "object" && "#text" in value)
    return text((value as { "#text": unknown })["#text"])
  return null
}
const stableId = (prefix: string, value: string) =>
  `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 24)}`

const emptyFeed = (id: string, url: string): Feed => ({
  id,
  url,
  title: null,
  description: null,
  image: null,
  siteUrl: null,
  ownerUserId: null,
  errorAt: null,
  errorMessage: null,
  subscriptionCount: 0,
  updatesPerWeek: null,
  latestEntryPublishedAt: null,
  lastRefreshedAt: null,
})

export { emptyFeed }

const knownFeedFallbacks = new Map<string, string[]>([
  [
    "https://cn.wsj.com/rss-news-and-feeds/zh-hans",
    [
      "https://news.google.com/rss/search?q=site%3Acn.wsj.com&hl=zh-CN&gl=CN&ceid=CN%3Azh-Hans",
      "https://plink.anyfeeder.com/wsj/cn",
      "https://feedx.net/rss/wsj.xml",
    ],
  ],
  [
    "https://cn.wsj.com/zh-hans/rss",
    [
      "https://news.google.com/rss/search?q=site%3Acn.wsj.com&hl=zh-CN&gl=CN&ceid=CN%3Azh-Hans",
      "https://plink.anyfeeder.com/wsj/cn",
      "https://feedx.net/rss/wsj.xml",
    ],
  ],
])

export interface FeedValidators {
  etag?: string | null
  lastModified?: string | null
}

const EMPTY_VALIDATORS: FeedValidators = {}

const fetchWithValidators = async (url: string, validators: FeedValidators, timeoutMs: number) => {
  const headers: Record<string, string> = {
    accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1",
    "user-agent": "FoLocal/1.13.0 (+https://github.com/Guyungy/Folo-Local)",
  }
  if (validators.etag) headers["if-none-match"] = validators.etag
  else if (validators.lastModified) headers["if-modified-since"] = validators.lastModified
  return fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
}

interface FeedCandidate {
  url: string
  /** RSSHub base URL behind this candidate, when it is an instance route. */
  instanceUrl: string | null
}

/** A pool member is given less time than a direct feed: there is another one right behind it. */
const INSTANCE_TIMEOUT_MS = 10_000
const DIRECT_TIMEOUT_MS = 20_000
/** Every mirror of a dead pool would turn one slow route into a minute-long stall. */
const MAX_INSTANCE_ATTEMPTS = 3

/**
 * A route is fetched from the pool rather than from one hard-coded instance. The feed keeps the
 * URL the user asked for whatever answers, so failing over never re-keys the subscription.
 */
const feedCandidates = (route: string): FeedCandidate[] => {
  const candidates: FeedCandidate[] = candidateInstances(route)
    .slice(0, MAX_INSTANCE_ATTEMPTS)
    .map((instance) => ({ url: `${instance}${route}`, instanceUrl: instance }))
  // Every instance disabled: still try the configured one rather than give up on the route.
  if (candidates.length === 0)
    candidates.push({ url: `${getRSSHubBaseURL()}${route}`, instanceUrl: preferredInstanceURL() })
  return candidates
}

const fetchFeedDocument = async (requestedUrl: string, validators: FeedValidators) => {
  const input = requestedUrl.trim()
  const parsed = new URL(input)
  if (!["rsshub:", "http:", "https:"].includes(parsed.protocol))
    throw new Error("Use an HTTP, HTTPS or rsshub:// feed URL")
  if (parsed.username || parsed.password || !parsed.hostname) throw new Error("Invalid feed URL")
  const route = routeFromURL(parsed)
  // Routes are interchangeable between instances, so the feed keeps the URL the user asked for
  // even when another pool member served it. Otherwise the feed row would be re-keyed on failover.
  const identity = route === null ? null : input
  const affinity = route === null ? null : getRouteAffinity(route)
  const candidates =
    route === null
      ? [
          { url: input, instanceUrl: null },
          ...(knownFeedFallbacks.get(input.replace(/\/$/, "")) ?? []).map((url) => ({
            url,
            instanceUrl: null,
          })),
        ]
      : feedCandidates(route)
  const failures: string[] = []

  for (const [index, candidate] of candidates.entries()) {
    const { instanceUrl } = candidate
    const timeoutMs = instanceUrl ? INSTANCE_TIMEOUT_MS : DIRECT_TIMEOUT_MS
    // Stored validators describe what one instance last returned, so they are only safe to send
    // back to that same instance; another member would answer 200 and we would misread a 304.
    const conditional = instanceUrl === null ? index === 0 : instanceUrl === affinity
    const startedAt = Date.now()

    try {
      const response = await fetchWithValidators(
        candidate.url,
        conditional ? validators : EMPTY_VALIDATORS,
        timeoutMs,
      )
      const latencyMs = Date.now() - startedAt
      if (response.status === 304) {
        if (instanceUrl) recordInstanceSuccess(instanceUrl, latencyMs)
        if (route && instanceUrl) setRouteAffinity(route, instanceUrl)
        return {
          atomFeed: undefined,
          contentUrl: identity ?? candidate.url,
          rssChannel: undefined,
          notModified: true as const,
          etag: response.headers.get("etag"),
          lastModified: response.headers.get("last-modified"),
          instanceUrl,
        }
      }
      if (!response.ok) {
        const reason =
          response.status === 403
            ? "access blocked by instance"
            : response.status === 404
              ? "route not found on instance"
              : "upstream request failed"
        const failure = `${new URL(candidate.url).hostname}: HTTP ${response.status} (${reason})`
        failures.push(failure)
        if (instanceUrl) recordInstanceFailure(instanceUrl, failure)
        continue
      }
      const content = await response.text()
      const document = parser.parse(content) as Record<string, unknown>
      const rssChannel = (document.rss as { channel?: Record<string, unknown> } | undefined)
        ?.channel
      const atomFeed = document.feed as Record<string, unknown> | undefined
      if (rssChannel || atomFeed) {
        if (instanceUrl) {
          recordInstanceSuccess(instanceUrl, latencyMs)
          if (route) setRouteAffinity(route, instanceUrl)
        }
        return {
          atomFeed,
          contentUrl: identity ?? candidate.url,
          rssChannel,
          notModified: false as const,
          etag: response.headers.get("etag"),
          lastModified: response.headers.get("last-modified"),
          instanceUrl,
        }
      }
      const failure = `${new URL(candidate.url).hostname}: not RSS or Atom`
      failures.push(failure)
      if (instanceUrl) recordInstanceFailure(instanceUrl, failure)
    } catch (error) {
      const reason =
        error instanceof Error && error.name === "TimeoutError"
          ? `timed out after ${Math.round(timeoutMs / 1000)} seconds`
          : error instanceof Error
            ? error.message
            : "request failed"
      const failure = `${new URL(candidate.url).hostname}: ${reason}`
      failures.push(failure)
      if (instanceUrl) recordInstanceFailure(instanceUrl, failure)
    }
  }

  throw new Error(`Unable to load feed (${failures.join("; ")})`)
}

export interface RefreshFeedOptions {
  /** Send If-None-Match / If-Modified-Since and accept a 304 as "already up to date". */
  conditional?: boolean
}

export interface RefreshFeedResult {
  feed: Feed
  notModified: boolean
}

const readValidators = (url: string): FeedValidators => {
  const row = db.prepare("SELECT etag, last_modified FROM feeds WHERE url = ?").get(url) as
    { etag: string | null; last_modified: string | null } | undefined
  return { etag: row?.etag, lastModified: row?.last_modified }
}

const feedFromStoredRow = (row: Record<string, unknown>): Feed => ({
  id: String(row.id),
  url: String(row.url),
  title: (row.title as string | null) ?? null,
  description: (row.description as string | null) ?? null,
  image: (row.image as string | null) ?? null,
  siteUrl: (row.site_url as string | null) ?? null,
  ownerUserId: (row.owner_user_id as string | null) ?? null,
  errorAt: (row.error_at as string | null) ?? null,
  errorMessage: (row.error_message as string | null) ?? null,
  subscriptionCount: Number(row.subscription_count ?? 0),
  updatesPerWeek: (row.updates_per_week as number | null) ?? null,
  latestEntryPublishedAt: (row.latest_entry_published_at as string | null) ?? null,
  lastRefreshedAt: (row.last_refreshed_at as string | null) ?? null,
})

export const refreshFeed = async (
  url: string,
  options: RefreshFeedOptions = {},
): Promise<RefreshFeedResult> => {
  const validators = options.conditional ? readValidators(url) : EMPTY_VALIDATORS
  const result = await fetchFeedDocument(url, validators)
  const existingFeed = db.prepare("SELECT id FROM feeds WHERE url = ?").get(result.contentUrl) as
    { id: string } | undefined
  const feedId = existingFeed?.id ?? stableId("feed", result.contentUrl)
  const refreshedAt = new Date().toISOString()

  if (result.notModified) {
    db.prepare(
      "UPDATE feeds SET last_refreshed_at=?, error_at=NULL, error_message=NULL, source_instance_url=COALESCE(?, source_instance_url) WHERE id=?",
    ).run(refreshedAt, result.instanceUrl, feedId)
    const row = db.prepare("SELECT * FROM feeds WHERE id=?").get(feedId) as
      Record<string, unknown> | undefined
    return {
      feed: row
        ? feedFromStoredRow(row)
        : { ...emptyFeed(feedId, result.contentUrl), lastRefreshedAt: refreshedAt },
      notModified: true,
    }
  }

  const { atomFeed, contentUrl, rssChannel } = result
  const source = rssChannel ?? atomFeed
  if (!source) throw new Error("Unsupported RSS or Atom document")
  const atomLinks = array(
    source.link as Record<string, unknown> | Record<string, unknown>[] | undefined,
  )
  const siteUrl =
    text(source.link) ?? text(atomLinks.find((link) => link["@_rel"] !== "self")?.["@_href"])
  const feed: Feed = {
    ...emptyFeed(feedId, contentUrl),
    title: text(source.title),
    description: text(source.description ?? source.subtitle),
    image: text((source.image as { url?: unknown } | undefined)?.url) ?? text(source.logo),
    siteUrl,
    lastRefreshedAt: refreshedAt,
  }
  const now = refreshedAt
  db.prepare(
    `INSERT INTO feeds (id,url,title,description,image,site_url,owner_user_id,error_at,error_message,subscription_count,updates_per_week,latest_entry_published_at,updated_at,last_refreshed_at,etag,last_modified,source_instance_url)
    VALUES (@id,@url,@title,@description,@image,@siteUrl,NULL,NULL,NULL,COALESCE((SELECT subscription_count FROM feeds WHERE id=@id),0),NULL,@latestEntryPublishedAt,@updatedAt,@lastRefreshedAt,@etag,@lastModified,@sourceInstanceUrl)
    ON CONFLICT(url) DO UPDATE SET title=excluded.title,description=excluded.description,image=excluded.image,site_url=excluded.site_url,error_at=NULL,error_message=NULL,updated_at=excluded.updated_at,last_refreshed_at=excluded.last_refreshed_at,etag=COALESCE(excluded.etag,feeds.etag),last_modified=COALESCE(excluded.last_modified,feeds.last_modified),source_instance_url=COALESCE(excluded.source_instance_url,feeds.source_instance_url)`,
  ).run({
    id: feed.id,
    url: feed.url,
    title: feed.title,
    description: feed.description,
    image: feed.image,
    siteUrl: feed.siteUrl,
    latestEntryPublishedAt: feed.latestEntryPublishedAt,
    updatedAt: now,
    lastRefreshedAt: refreshedAt,
    etag: result.etag ?? null,
    lastModified: result.lastModified ?? null,
    sourceInstanceUrl: result.instanceUrl,
  })
  const items = array(
    (rssChannel?.item ?? atomFeed?.entry) as
      Record<string, unknown> | Record<string, unknown>[] | undefined,
  )
  let latest: string | null = null
  const insert =
    db.prepare(`INSERT INTO entries (id,feed_id,title,url,content,description,guid,author,inserted_at,published_at,media,categories,attachments,extra,language)
    VALUES (@id,@feedId,@title,@url,@content,@description,@guid,@author,@insertedAt,@publishedAt,NULL,@categories,NULL,NULL,NULL)
    ON CONFLICT(id) DO UPDATE SET title=excluded.title,url=excluded.url,content=excluded.content,description=excluded.description,author=excluded.author,published_at=excluded.published_at,categories=excluded.categories`)
  db.transaction(() => {
    for (const item of items) {
      const links = array(
        item.link as Record<string, unknown> | Record<string, unknown>[] | undefined,
      )
      const itemUrl =
        text(item.link) ??
        text(links.find((link) => !link["@_rel"] || link["@_rel"] === "alternate")?.["@_href"])
      const guid = text(item.guid ?? item.id) ?? itemUrl ?? randomUUID()
      const rawDate = text(item.pubDate ?? item.published ?? item.updated)
      const publishedAt =
        rawDate && !Number.isNaN(Date.parse(rawDate)) ? new Date(rawDate).toISOString() : now
      latest = !latest || publishedAt > latest ? publishedAt : latest
      const categories = array(item.category as unknown)
        .map((category) => text(category))
        .filter((category): category is string => Boolean(category))
      insert.run({
        id: stableId("entry", `${feedId}:${guid}`),
        feedId,
        title: text(item.title),
        url: itemUrl,
        content: text(item["content:encoded"] ?? item.content ?? item.summary),
        description: text(item.description ?? item.summary),
        guid,
        author: text(item.author ?? item["dc:creator"]),
        insertedAt: now,
        publishedAt,
        categories: categories.length ? JSON.stringify(categories) : null,
      })
    }
  })()
  db.prepare("UPDATE feeds SET latest_entry_published_at = ? WHERE id = ?").run(latest, feedId)
  return { feed: { ...feed, latestEntryPublishedAt: latest }, notModified: false }
}
