import { existsSync, rmSync } from "node:fs"

import { resolve } from "pathe"
import { afterAll, describe, expect, it, vi } from "vitest"

const testDatabasePath = `./data/test-${process.pid}.db`
const testOpenAIConfigPath = `./data/openai-${process.pid}.json`
process.env.DATABASE_PATH = testDatabasePath
process.env.OPENAI_CONFIG_PATH = testOpenAIConfigPath

const { app } = await import("./app.js")
const { db } = await import("./db.js")
const { articleContext } = await import("./chat-context.js")

afterAll(() => {
  db.close()
  for (const suffix of ["", "-shm", "-wal"])
    rmSync(`${resolve(testDatabasePath)}${suffix}`, { force: true })
  rmSync(resolve(testOpenAIConfigPath), { force: true })
})

describe("local data service", () => {
  it("previews, subscribes and refreshes RSSHub routes without changing their identity", async () => {
    const route = "rsshub://zaobao/znews/china?limit=5&filter=%E4%B8%AD%E5%9B%BD"
    const mock = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async () =>
          new Response(
            '<rss version="2.0"><channel><title>Zaobao</title><item><guid>stable-article</guid><title>Article</title></item></channel></rss>',
          ),
      )
    vi.stubGlobal("fetch", mock)
    vi.stubEnv("RSSHUB_BASE_URL", "https://instance.test/rsshub")
    try {
      const preview = await app.request(`/feeds?url=${encodeURIComponent(route)}`)
      const payload = await preview.json()
      expect(preview.status).toBe(200)
      expect(payload.data.feed.url).toBe(route)
      expect(mock.mock.calls[0]?.[0]).toBe(
        "https://instance.test/rsshub/zaobao/znews/china?limit=5&filter=%E4%B8%AD%E5%9B%BD",
      )
      const subscribed = await app.request("/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: route }),
      })
      expect((await subscribed.json()).feed.id).toBe(payload.data.feed.id)
      vi.stubEnv("RSSHUB_BASE_URL", "https://second.test")
      expect((await app.request(`/feeds/refresh?id=${payload.data.feed.id}`)).status).toBe(200)
      expect(mock.mock.calls[2]?.[0]).toBe(
        "https://second.test/zaobao/znews/china?limit=5&filter=%E4%B8%AD%E5%9B%BD",
      )
      expect(
        db.prepare("SELECT COUNT(*) count FROM entries WHERE feed_id=?").get(payload.data.feed.id),
      ).toEqual({ count: 1 })
      db.prepare("DELETE FROM subscriptions WHERE feed_id=?").run(payload.data.feed.id)
      db.prepare("DELETE FROM feeds WHERE id=?").run(payload.data.feed.id)
    } finally {
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
    }
  })
  it("provides a built-in local user without a session", async () => {
    const session = await app.request("/better-auth/get-session")
    expect(await session.json()).toMatchObject({
      code: 0,
      session: null,
      user: { id: "local-user" },
    })
  })

  it("lists entries and persists read and collection state", async () => {
    const now = new Date().toISOString()
    db.prepare(
      "INSERT INTO feeds (id,url,title,subscription_count,updated_at) VALUES (?,?,?,?,?)",
    ).run("feed-1", "https://example.com/rss", "Example", 1, now)
    db.prepare(
      "INSERT INTO subscriptions (id,user_id,feed_id,view,is_private,created_at) VALUES (?,?,?,?,?,?)",
    ).run("sub-1", "local-user", "feed-1", 0, 0, now)
    db.prepare(
      "INSERT INTO entries (id,feed_id,title,content,guid,inserted_at,published_at) VALUES (?,?,?,?,?,?,?)",
    ).run(
      "entry-1",
      "feed-1",
      "Hello",
      "<p>First sentence. Second sentence.</p>",
      "hello",
      now,
      now,
    )

    const list = await app.request("/entries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    })
    expect(await list.json()).toMatchObject({
      code: 0,
      data: [{ read: false, entries: { id: "entry-1" }, feeds: { id: "feed-1" } }],
    })

    await app.request("/reads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entryIds: ["entry-1"] }),
    })
    const unread = await app.request("/reads/total-count")
    expect(await unread.json()).toEqual({ code: 0, data: { count: 0 } })

    await app.request("/collections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entryId: "entry-1", view: 0 }),
    })
    const collection = await app.request("/collections?entryId=entry-1")
    expect(await collection.json()).toEqual({ code: 0, data: true })

    const context = articleContext({
      parts: [{ type: "data-block", data: [{ type: "mainEntry", value: "entry-1" }] }],
    })
    expect(context).toContain("First sentence.")
    expect(
      articleContext({
        parts: [
          {
            type: "data-block",
            data: [
              { type: "mainView", value: "0" },
              { type: "unreadOnly", value: "true" },
            ],
          },
        ],
      }),
    ).toBe("[]")
    const summary = await app.request("/ai/summary?id=entry-1")
    expect(await summary.json()).toEqual({
      code: 0,
      data: "First sentence.Second sentence.",
    })
  })

  it("falls back to a compatible mirror when the WSJ feed blocks automated requests", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("blocked", { status: 401 }))
      .mockResolvedValueOnce(
        new Response(
          `<?xml version="1.0"?><rss version="2.0"><channel><title>WSJ 中文</title><link>https://cn.wsj.com/</link><item><title>Test article</title><link>https://cn.wsj.com/articles/test</link><guid>test</guid></item></channel></rss>`,
          { headers: { "content-type": "text/xml" } },
        ),
      )
    vi.stubGlobal("fetch", fetchMock)
    try {
      const response = await app.request("/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://cn.wsj.com/rss-news-and-feeds/zh-hans" }),
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        code: 0,
        feed: {
          title: "WSJ 中文",
          url: "https://news.google.com/rss/search?q=site%3Acn.wsj.com&hl=zh-CN&gl=CN&ceid=CN%3Azh-Hans",
        },
      })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("fetches models and uses the saved model without requiring a local API key", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ data: [{ id: "local-model-b" }, { id: "local-model-a" }] }),
      )
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: "OK" } }] }))
    vi.stubGlobal("fetch", fetchMock)
    try {
      const modelsResponse = await app.request("/settings/openai/models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseURL: "http://127.0.0.1:11434/v1", apiKey: "" }),
      })
      expect(await modelsResponse.json()).toEqual({
        code: 0,
        data: { models: ["local-model-a", "local-model-b"] },
      })
      expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:11434/v1/models")
      expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).has("authorization")).toBe(false)

      const config = {
        baseURL: "http://127.0.0.1:11434/v1",
        apiKey: "",
        model: "local-model-b",
      }
      expect(
        await app.request("/settings/openai", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(config),
        }),
      ).toMatchObject({ status: 200 })
      const testResponse = await app.request("/settings/openai/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(config),
      })
      expect(testResponse.status).toBe(200)
      const completionBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))
      expect(completionBody.model).toBe("local-model-b")
      expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).has("authorization")).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("regenerates imported unavailable-summary placeholders through the configured model", async () => {
    db.prepare(
      "INSERT OR REPLACE INTO summaries (entry_id,summary,readability_summary,language) VALUES (?,?,?,?)",
    ).run("entry-1", "摘要不可用", null, null)
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ choices: [{ message: { content: "AI generated summary" } }] }),
      )
    vi.stubGlobal("fetch", fetchMock)
    try {
      const response = await app.request("/ai/summary?id=entry-1")
      expect(await response.json()).toEqual({ code: 0, data: "AI generated summary" })
      const completionBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
      expect(completionBody.model).toBe("local-model-b")
    } finally {
      db.prepare("DELETE FROM summaries WHERE entry_id=?").run("entry-1")
      vi.unstubAllGlobals()
    }
  })

  it("streams chat deltas before the provider finishes and includes selected article content", async () => {
    vi.stubEnv("OPENAI_BASE_URL", "http://provider.test/v1")
    vi.stubEnv("OPENAI_API_KEY", "test")
    vi.stubEnv("OPENAI_MODEL", "test-model")
    let upstream: ReadableStreamDefaultController<Uint8Array>
    const encode = (text: string) => new TextEncoder().encode(text)
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            upstream = controller
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
    )
    vi.stubGlobal("fetch", fetchMock)
    try {
      const response = await app.request("/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              parts: [
                { type: "data-rich-text", data: { text: "Summarize this" } },
                { type: "data-block", data: [{ type: "mainEntry", value: "entry-1" }] },
              ],
            },
          ],
        }),
      })
      expect(response.status).toBe(200)
      const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
      expect(sent.stream).toBe(true)
      expect(sent.messages[0].content).toContain("First sentence.")
      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      expect(decoder.decode((await reader.read()).value)).toContain('"type":"start"')
      await reader.read()
      upstream!.enqueue(encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'))
      expect(decoder.decode((await reader.read()).value)).toContain('"delta":"Hello"')
      upstream!.enqueue(encode("data: [DONE]\n\n"))
      expect(decoder.decode((await reader.read()).value)).toContain("text-end")
      expect(decoder.decode((await reader.read()).value)).toContain("finish")
      expect((await reader.read()).done).toBe(true)
    } finally {
      vi.unstubAllEnvs()
      vi.unstubAllGlobals()
    }
  })

  it("batches refreshes and skips feeds whose HTTP validators still match", async () => {
    const now = new Date().toISOString()
    db.prepare(
      "INSERT OR REPLACE INTO feeds (id,url,title,subscription_count,updated_at,etag) VALUES (?,?,?,?,?,?)",
    ).run("feed-etag", "https://etag.test/rss", "ETag feed", 1, now, '"v1"')
    db.prepare(
      "INSERT OR REPLACE INTO feeds (id,url,title,subscription_count,updated_at) VALUES (?,?,?,?,?)",
    ).run("feed-plain", "https://plain.test/rss", "Plain feed", 1, now)
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 304 }))
      .mockResolvedValueOnce(
        new Response(
          '<rss version="2.0"><channel><title>Plain</title><item><guid>plain-1</guid><title>Plain article</title></item></channel></rss>',
        ),
      )
    vi.stubGlobal("fetch", fetchMock)
    try {
      const response = await app.request("/feeds/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: ["feed-etag", "feed-plain"] }),
      })
      expect(await response.json()).toMatchObject({
        code: 0,
        data: { total: 2, failed: 0, notModified: 1 },
      })
      expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("if-none-match")).toBe('"v1"')
      expect(
        db.prepare("SELECT last_refreshed_at FROM feeds WHERE id=?").get("feed-etag"),
      ).toMatchObject({ last_refreshed_at: expect.any(String) })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.unstubAllGlobals()
      db.prepare("DELETE FROM entries WHERE feed_id IN ('feed-etag','feed-plain')").run()
      db.prepare("DELETE FROM feeds WHERE id IN ('feed-etag','feed-plain')").run()
    }
  })

  it("runs a full sweep over every subscribed feed and exposes it to the UI", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      // A fresh Response per call: a body can only be consumed once.
      .mockImplementation(
        async () =>
          new Response(
            '<rss version="2.0"><channel><title>Example</title><item><guid>sweep-1</guid><title>Sweep</title></item></channel></rss>',
          ),
      )
    vi.stubGlobal("fetch", fetchMock)
    try {
      const response = await app.request("/feeds/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
      const payload = await response.json()
      expect(payload.code).toBe(0)
      expect(payload.data.total).toBeGreaterThan(0)
      expect(payload.data.failed).toBe(0)

      const status = await app.request("/local/refresh-status")
      expect(await status.json()).toMatchObject({
        code: 0,
        data: { running: false, lastRun: { finishedAt: expect.any(String) } },
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("persists the background refresh interval and rejects impossible values", async () => {
    const put = (intervalMinutes: number) =>
      app.request("/settings/refresh", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intervalMinutes }),
      })
    try {
      expect(await (await put(30)).json()).toMatchObject({
        code: 0,
        data: { intervalMinutes: 30 },
      })
      expect(await (await app.request("/local/refresh-status")).json()).toMatchObject({
        code: 0,
        data: { intervalMinutes: 30 },
      })
      expect((await put(5000)).status).toBe(400)
    } finally {
      await put(60)
    }
  })

  it("parses nested OPML outlines and rebuilds them without losing feeds", async () => {
    const { buildOpml, parseOpml } = await import("./opml.js")
    const xml = `<?xml version="1.0"?><opml version="2.0"><body><outline text="Tech"><outline text="HN" type="rss" xmlUrl="https://hn.test/rss" htmlUrl="https://hn.test"/></outline><outline text="Solo" type="rss" xmlUrl="https://solo.test/rss"/></body></opml>`
    const parsed = parseOpml(xml, "local-user")
    expect(parsed.subscriptions).toEqual([
      { userId: "local-user", url: "https://hn.test/rss", view: 0, category: "Tech", title: "HN" },
      {
        userId: "local-user",
        url: "https://solo.test/rss",
        view: 0,
        category: null,
        title: "Solo",
      },
    ])

    const rebuilt = buildOpml(
      parsed.subscriptions.map((subscription) => ({
        category: subscription.category,
        siteUrl: null,
        title: subscription.title,
        url: subscription.url,
        view: subscription.view,
      })),
      { folderMode: "category" },
    )
    expect(rebuilt).toContain('xmlUrl="https://hn.test/rss"')
    expect(
      parseOpml(rebuilt, "local-user")
        .subscriptions.map((subscription) => subscription.url)
        .sort(),
    ).toEqual(["https://hn.test/rss", "https://solo.test/rss"])
  })

  it("previews an OPML file and imports only the feeds that are not subscribed yet", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async () =>
          new Response(
            '<rss version="2.0"><channel><title>Imported</title><item><guid>imported-1</guid><title>Imported article</title></item></channel></rss>',
          ),
      )
    vi.stubGlobal("fetch", fetchMock)
    try {
      const preview = await app.request("/subscriptions/parse-opml", {
        method: "POST",
        headers: { "content-type": "text/xml" },
        body: '<opml version="2.0"><body><outline text="A" type="rss" xmlUrl="https://import-a.test/rss"/></body></opml>',
      })
      expect(await preview.json()).toMatchObject({
        code: 0,
        data: { subscriptions: [{ url: "https://import-a.test/rss" }] },
      })

      const form = new FormData()
      form.set("items", JSON.stringify(["https://import-a.test/rss", "https://example.com/rss"]))
      const imported = await app.request("/subscriptions/import", { method: "POST", body: form })
      const payload = await imported.json()
      expect(payload.code).toBe(0)
      expect(payload.data.successfulItems).toHaveLength(1)
      expect(payload.data.conflictItems).toHaveLength(1)
    } finally {
      vi.unstubAllGlobals()
      db.prepare(
        "DELETE FROM entries WHERE feed_id IN (SELECT id FROM feeds WHERE url='https://import-a.test/rss')",
      ).run()
      db.prepare(
        "DELETE FROM subscriptions WHERE feed_id IN (SELECT id FROM feeds WHERE url='https://import-a.test/rss')",
      ).run()
      db.prepare("DELETE FROM feeds WHERE url='https://import-a.test/rss'").run()
    }
  })

  it("exports the subscriptions as an OPML document the client can download", async () => {
    const response = await app.request("/subscriptions/export?folderMode=category")
    const payload = await response.json()
    expect(payload.code).toBe(0)
    expect(payload.data.filename).toMatch(/\.opml$/)
    expect(payload.data.contentType).toBe("text/x-opml")
    expect(payload.data.content).toContain("<opml")
    expect(payload.data.content).toContain("https://example.com/rss")
  })

  it("reports the local database and writes a consistent backup of it", async () => {
    const info = await app.request("/data/info")
    const infoPayload = await info.json()
    expect(infoPayload.code).toBe(0)
    expect(infoPayload.data.databasePath).toContain("test-")
    expect(infoPayload.data.counts.entries).toBeGreaterThan(0)

    const backup = await app.request("/data/backup", { method: "POST" })
    const backupPayload = await backup.json()
    expect(backupPayload.code).toBe(0)
    expect(existsSync(backupPayload.data.path)).toBe(true)
    expect(backupPayload.data.bytes).toBeGreaterThan(0)
    rmSync(backupPayload.data.path, { force: true })
  })
})
