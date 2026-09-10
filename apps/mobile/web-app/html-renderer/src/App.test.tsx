import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, test, vi } from "vitest"

import type { EntryModel } from "../types"
import { App } from "./App"

const coverImageUrl = "https://example.com/images/cover.jpg"

const renderEntry = (entry: EntryModel) => {
  window.__FO_BRIDGE__.dispatch("setEntry", JSON.stringify(entry))
  const container = document.createElement("div")
  container.innerHTML = renderToStaticMarkup(<App />)
  return container.querySelector("article")
}

describe("entry cover image", () => {
  beforeEach(() => {
    vi.stubGlobal("bridge", { measure: vi.fn() })
    window.__FO_BRIDGE__.dispatch("setNoMedia", "false")
  })

  test("renders a cover without body content through the image preview component", () => {
    const article = renderEntry({
      media: [{ type: "photo", url: coverImageUrl }],
    })

    expect(article?.querySelectorAll("img")).toHaveLength(1)
    expect(article?.querySelector("button img")?.getAttribute("src")).toBe(coverImageUrl)
  })

  test("uses the article URL to avoid repeating an existing relative cover image", () => {
    const article = renderEntry({
      content: '<p>Article body</p><img src="/images/cover.jpg">',
      url: "https://example.com/articles/entry",
      media: [{ type: "photo", url: coverImageUrl }],
    })

    expect(article?.querySelectorAll("img")).toHaveLength(1)
    expect(article?.querySelector("img")?.getAttribute("src")).toBe(coverImageUrl)
    expect(article?.firstElementChild?.textContent).toBe("Article body")
  })

  test("does not promote another photo when the cover media is a video", () => {
    const article = renderEntry({
      content: "<p>Article body</p>",
      media: [
        { type: "video", url: "https://example.com/video.mp4" },
        { type: "photo", url: coverImageUrl },
      ],
    })

    expect(article?.querySelectorAll("img")).toHaveLength(0)
  })

  test("respects the media visibility setting for a cover-only entry", () => {
    window.__FO_BRIDGE__.dispatch("setNoMedia", "true")

    const article = renderEntry({
      media: [{ type: "photo", url: coverImageUrl }],
    })

    expect(article).toBeNull()
  })
})
