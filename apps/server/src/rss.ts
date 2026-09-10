import { createHash, randomUUID } from "node:crypto"

import { XMLParser } from "fast-xml-parser"

import { db, getLocalSetting, setLocalSetting } from "./db.js"
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

export const getRSSHubBaseURL = () =>
  process.env.RSSHUB_BASE_URL || getLocalSetting("rsshub_base_url") || "https://rsshub.app"
export const setRSSHubBaseURL = (value: string) => {
  const url = new URL(value.trim())
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("RSSHub base URL must be HTTP(S) without credentials, query or fragment")
  setLocalSetting("rsshub_base_url", url.href.replace(/\/$/, ""))
}

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

const fetchWithValidators = async (url: string, validators: FeedValidators) => {
  const headers: Record<string, string> = {
    accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1",
    "user-agent": "FoLocal/1.13.0 (+https://github.com/Guyungy/Folo-Local)",
  }
  if (validators.etag) headers["if-none-match"] = validators.etag
  else if (validators.lastModified) headers["if-modified-since"] = validators.lastModified
  return fetch(url, { headers, signal: AbortSignal.timeout(20_000) })
}

const fetchFeedDocument = async (requestedUrl: string, validators: FeedValidators) => {
  const input = requestedUrl.trim()
  const parsed = new URL(input)
  const isRSSHub = parsed.protocol === "rsshub:"
  if (!["rsshub:", "http:", "https:"].includes(parsed.protocol))
    throw new Error("Use an HTTP, HTTPS or rsshub:// feed URL")
  if (parsed.username || parsed.password || !parsed.hostname) throw new Error("Invalid feed URL")
  const identity = isRSSHub ? `rsshub://${parsed.host}${parsed.pathname}${parsed.search}` : input
  const instance = new URL(getRSSHubBaseURL())
  if (!["http:", "https:"].includes(instance.protocol))
    throw new Error("RSSHub instance must use HTTP or HTTPS")
  const rsshubTarget = `${instance.href.replace(/\/$/, "")}/${parsed.host}${parsed.pathname}${parsed.search}`
  const normalizedUrl = requestedUrl.trim().replace(/\/$/, "")
  const candidates = isRSSHub
    ? [rsshubTarget]
    : [input, ...(knownFeedFallbacks.get(normalizedUrl) ?? [])]
  const failures: string[] = []

  for (const [index, candidate] of candidates.entries()) {
    try {
      // Validators describe the canonical URL only, so fallback mirrors are always fetched fresh.
      const response = await fetchWithValidators(
        candidate,
        index === 0 ? validators : EMPTY_VALIDATORS,
      )
      if (response.status === 304)
        return {
          atomFeed: undefined,
          contentUrl: isRSSHub ? identity : candidate,
          rssChannel: undefined,
          notModified: true as const,
          etag: response.headers.get("etag"),
          lastModified: response.headers.get("last-modified"),
        }
      if (!response.ok) {
        const reason =
          response.status === 403
            ? "access blocked by instance"
            : response.status === 404
              ? "route not found on instance"
              : "upstream request failed"
        failures.push(`${new URL(candidate).hostname}: HTTP ${response.status} (${reason})`)
        continue
      }
      const content = await response.text()
      const document = parser.parse(content) as Record<string, unknown>
      const rssChannel = (document.rss as { channel?: Record<string, unknown> } | undefined)
        ?.channel
      const atomFeed = document.feed as Record<string, unknown> | undefined
      if (rssChannel || atomFeed)
        return {
          atomFeed,
          contentUrl: isRSSHub ? identity : candidate,
          rssChannel,
          notModified: false as const,
          etag: response.headers.get("etag"),
          lastModified: response.headers.get("last-modified"),
        }
      failures.push(`${new URL(candidate).hostname}: not RSS or Atom`)
    } catch (error) {
      failures.push(
        `${new URL(candidate).hostname}: ${error instanceof Error && error.name === "TimeoutError" ? "request timed out after 20 seconds; retry or change the RSSHub instance" : error instanceof Error ? error.message : "request failed"}`,
      )
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
      "UPDATE feeds SET last_refreshed_at=?, error_at=NULL, error_message=NULL WHERE id=?",
    ).run(refreshedAt, feedId)
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
    `INSERT INTO feeds (id,url,title,description,image,site_url,owner_user_id,error_at,error_message,subscription_count,updates_per_week,latest_entry_published_at,updated_at,last_refreshed_at,etag,last_modified)
    VALUES (@id,@url,@title,@description,@image,@siteUrl,NULL,NULL,NULL,COALESCE((SELECT subscription_count FROM feeds WHERE id=@id),0),NULL,@latestEntryPublishedAt,@updatedAt,@lastRefreshedAt,@etag,@lastModified)
    ON CONFLICT(url) DO UPDATE SET title=excluded.title,description=excluded.description,image=excluded.image,site_url=excluded.site_url,error_at=NULL,error_message=NULL,updated_at=excluded.updated_at,last_refreshed_at=excluded.last_refreshed_at,etag=COALESCE(excluded.etag,feeds.etag),last_modified=COALESCE(excluded.last_modified,feeds.last_modified)`,
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
