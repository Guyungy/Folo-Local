import { Masonry } from "@follow/components/ui/masonry/index.js"
import type { RenderComponentProps } from "masonic"
import * as React from "react"
import { act } from "react"
import type { Root } from "react-dom/client"
import { createRoot } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest"

interface Item {
  id: string
  height: number
}

const initialItems: Item[] = [
  { id: "a", height: 120 },
  { id: "b", height: 280 },
  { id: "c", height: 80 },
  { id: "d", height: 200 },
]

const itemKey = (item: Item) => item.id
const ItemContent = ({ data }: RenderComponentProps<Item>) => (
  <div data-item-id={data.id} data-height={data.height} />
)

describe("Masonry item order", () => {
  let root: Root
  let container: HTMLDivElement
  let measurements: string[]

  beforeAll(() => {
    ;(globalThis as typeof globalThis & { React: typeof React }).React = React
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true

    Object.assign(window, {
      addEventListener: document.defaultView?.addEventListener.bind(document.defaultView),
      removeEventListener: document.defaultView?.removeEventListener.bind(document.defaultView),
      innerHeight: 1000,
      innerWidth: 424,
    })
  })

  beforeEach(() => {
    measurements = []
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(424)
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.getAttribute("role") !== "gridcell") return 1000

      const item = this.querySelector<HTMLElement>("[data-item-id]")
      if (!item) return 0
      measurements.push(item.dataset.itemId!)
      return Number(item.dataset.height)
    })

    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  const renderItems = async (items: Item[], keyed = true) => {
    await act(async () => {
      root.render(
        <Masonry
          items={items}
          itemKey={keyed ? itemKey : undefined}
          render={ItemContent}
          ssrWidth={424}
          columnWidth={200}
          columnCount={2}
          columnGutter={24}
        />,
      )
    })
  }

  const expectPosition = (id: string, top: number, left: number) => {
    const cell = container.querySelector<HTMLElement>(`[data-item-id="${id}"]`)?.parentElement
    expect(cell).toBeDefined()
    expect(cell?.style.visibility).not.toBe("hidden")
    expect(cell?.style.top).toBe(`${top}px`)
    expect(cell?.style.left).toBe(`${left}px`)
  }

  const expectInitialPositions = () => {
    expectPosition("a", 0, 0)
    expectPosition("b", 0, 224)
    expectPosition("c", 144, 0)
    expectPosition("d", 248, 0)
  }

  test("remeasures different-height items when sorting in either direction", async () => {
    await renderItems(initialItems)
    expectInitialPositions()

    await renderItems(initialItems.toReversed())
    expectPosition("d", 0, 0)
    expectPosition("c", 0, 224)
    expectPosition("b", 104, 224)
    expectPosition("a", 224, 0)

    await renderItems(initialItems)
    expectInitialPositions()
  })

  test("remeasures replacement items even when the item count stays the same", async () => {
    await renderItems(initialItems)
    await renderItems([{ id: "replacement", height: 400 }, ...initialItems.slice(1)])

    expectPosition("replacement", 0, 0)
    expectPosition("b", 0, 224)
    expectPosition("c", 304, 224)
    expectPosition("d", 408, 224)
    expect(container.querySelector('[data-item-id="a"]')).toBeNull()
  })

  test("rebuilds the layout after removing an item", async () => {
    await renderItems(initialItems)
    const remainingItems = initialItems.filter((item) => item.id !== "b")
    await renderItems(remainingItems)

    expectPosition("a", 0, 0)
    expectPosition("c", 0, 224)
    expectPosition("d", 104, 224)
    expect(container.querySelectorAll('[role="gridcell"]')).toHaveLength(3)

    measurements.length = 0
    await renderItems(remainingItems)
    expect(measurements).toEqual([])
  })

  test("preserves measured items while appending a page", async () => {
    await renderItems(initialItems)
    measurements.length = 0

    await renderItems([...initialItems, { id: "next-page", height: 140 }])

    expectInitialPositions()
    expectPosition("next-page", 304, 224)
    expect(measurements.length).toBeGreaterThan(0)
    expect(measurements.every((id) => id === "next-page")).toBe(true)
  })

  test("preserves measurements for new objects with the same item keys", async () => {
    await renderItems(initialItems)
    measurements.length = 0

    await renderItems(initialItems.map((item) => ({ ...item })))

    expectInitialPositions()
    expect(measurements).toEqual([])
  })

  test("rebuilds reordered items without an explicit item key", async () => {
    await renderItems(initialItems, false)
    await renderItems(initialItems.toReversed(), false)

    expectPosition("d", 0, 0)
    expectPosition("c", 0, 224)
    expectPosition("b", 104, 224)
    expectPosition("a", 224, 0)
  })
})
