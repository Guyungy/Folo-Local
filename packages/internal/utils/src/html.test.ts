import { describe, expect, it } from "vitest"

import { parseHtml } from "./html"

const coverImageUrl = "https://example.com/images/cover.jpg?a=1&b=2"
const baseUrl = "https://example.com/posts/article"

describe("entry cover images", () => {
  it("prepends a missing cover before the body and its other images", () => {
    const result = parseHtml('<p>Article body</p><img src="https://example.com/other.jpg">', {
      coverImageUrl,
    })

    expect(result.hastTree.children[0]).toMatchObject({
      type: "element",
      tagName: "img",
      properties: { src: coverImageUrl },
    })
    expect(result.images).toEqual([coverImageUrl, "https://example.com/other.jpg"])
    expect(result.toText()).toBe("Article body")
  })

  it.each([
    "https://example.com/images/cover.jpg?a=1&amp;b=2",
    "/images/cover.jpg?a=1&amp;b=2",
    "../images/cover.jpg?a=1&amp;b=2",
    "//example.com/images/cover.jpg?a=1&amp;b=2",
    "https://example.com/images/cover.jpg?a=1&amp;b=2#image",
  ])("does not duplicate a cover already in a nested image: %s", (src) => {
    const result = parseHtml(`<p>Before</p><figure><a href="#"><img src="${src}"></a></figure>`, {
      coverImageUrl,
      baseUrl,
    })

    expect(result.images).toEqual([coverImageUrl])
    expect(result.hastTree.children[0]).toMatchObject({ tagName: "p" })
  })

  it("does not mistake a link to the cover for a displayed image", () => {
    const result = parseHtml(`<a href="${coverImageUrl}">View cover</a>`, { coverImageUrl })

    expect(result.images).toEqual([coverImageUrl])
  })

  it("keeps distinct images selected through query parameters", () => {
    const result = parseHtml('<img src="https://example.com/images/cover.jpg?a=2&amp;b=2">', {
      coverImageUrl,
    })

    expect(result.images).toHaveLength(2)
  })

  it("respects hidden media", () => {
    const result = parseHtml('<p>Article body</p><img src="https://example.com/other.jpg">', {
      coverImageUrl,
      noMedia: true,
    })

    expect(result.images).toEqual([])
    expect(result.toText()).toBe("Article body")
  })

  it("can render a cover without body text", () => {
    expect(parseHtml("", { coverImageUrl }).images).toEqual([coverImageUrl])
  })

  it("preserves ordinary HTML when no cover is supplied", () => {
    expect(parseHtml("<p>Article body</p>").images).toEqual([])
  })

  it("sanitizes the inserted cover URL", () => {
    expect(
      parseHtml("<p>Article body</p>", { coverImageUrl: "javascript:alert(1)" }).images,
    ).toEqual([])
  })
})
