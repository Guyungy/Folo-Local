import { XMLParser } from "fast-xml-parser"

export interface ParsedSubscription {
  userId: string
  url: string
  view: number
  category: string | null
  title: string | null
}

export interface OpmlEntry {
  title: string | null
  url: string
  siteUrl: string | null
  category: string | null
  view: number
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  cdataPropName: "#text",
  // OPML exporters disagree on `xmlUrl` vs `xmlurl`; normalising to lower case covers both.
  transformAttributeName: (name) => name.toLowerCase(),
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

const escapeXml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")

type OutlineNode = Record<string, unknown>

/**
 * Reads every `outline` carrying an `xmlUrl`, keeping the enclosing folder name as the category.
 */
export const parseOpml = (
  content: string,
  userId: string,
): { subscriptions: ParsedSubscription[]; remaining: number } => {
  const document = parser.parse(content) as {
    opml?: { body?: { outline?: OutlineNode | OutlineNode[] } }
  }
  const body = document.opml?.body
  if (!body) throw new Error("Not a valid OPML document: missing <opml><body>")

  const subscriptions: ParsedSubscription[] = []
  const seen = new Set<string>()

  const walk = (nodes: OutlineNode | OutlineNode[] | undefined, category: string | null) => {
    for (const node of array(nodes)) {
      const xmlUrl = text(node["@_xmlurl"])?.trim()
      const label = text(node["@_title"]) ?? text(node["@_text"])
      const children = node.outline as OutlineNode | OutlineNode[] | undefined
      if (xmlUrl) {
        if (!seen.has(xmlUrl)) {
          seen.add(xmlUrl)
          subscriptions.push({ userId, url: xmlUrl, view: 0, category, title: label })
        }
      } else if (children && label) {
        // A folder: its children inherit the folder name as their category.
        walk(children, label)
        continue
      }
      walk(children, category)
    }
  }

  walk(body.outline, null)
  if (subscriptions.length === 0)
    throw new Error("Not a valid OPML document: no feed outlines found")
  return { subscriptions, remaining: 0 }
}

export const buildOpml = (
  entries: OpmlEntry[],
  options: { folderMode: "view" | "category"; rsshubUrl?: string | null } = { folderMode: "view" },
): string => {
  const viewNames = ["Articles", "Social", "Pictures", "Videos", "Audio"]
  const folders = new Map<string, OpmlEntry[]>()
  for (const entry of entries) {
    const key =
      options.folderMode === "category" && entry.category
        ? entry.category
        : (viewNames[entry.view] ?? `View ${entry.view}`)
    const bucket = folders.get(key)
    if (bucket) bucket.push(entry)
    else folders.set(key, [entry])
  }

  const outlines = [...folders.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([folder, items]) => {
      const children = items
        .map((item) => {
          const attributes = [
            `text="${escapeXml(item.title ?? item.url)}"`,
            `title="${escapeXml(item.title ?? item.url)}"`,
            `type="rss"`,
            `xmlUrl="${escapeXml(item.url)}"`,
          ]
          if (item.siteUrl) attributes.push(`htmlUrl="${escapeXml(item.siteUrl)}"`)
          if (options.rsshubUrl)
            attributes.push(`description="${escapeXml(`RSSHub: ${options.rsshubUrl}`)}"`)
          return `      <outline ${attributes.join(" ")} />`
        })
        .join("\n")
      return `    <outline text="${escapeXml(folder)}" title="${escapeXml(folder)}">\n${children}\n    </outline>`
    })
    .join("\n")

  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>FoLocal subscriptions</title>
    <dateCreated>${new Date().toUTCString()}</dateCreated>
  </head>
  <body>
${outlines}
  </body>
</opml>
`
}
