import { MemoedDangerousHTMLStyle } from "@follow/components/common/MemoedDangerousHTMLStyle.js"
import type { SpotlightRule } from "@follow/shared/spotlight"
import { clsx } from "clsx"
import katexStyle from "katex/dist/katex.min.css?raw"
import * as React from "react"
import { createElement, Fragment, useEffect, useMemo, useState } from "react"

import { WrappedElementProvider } from "./common/WrappedElementProvider"
import { MarkdownRenderContainerRefContext } from "./components/__internal/ctx"
import { parseHtml } from "./parser"

export type HTMLProps<A extends keyof React.JSX.IntrinsicElements = "div"> = {
  children: string | null | undefined
  as?: A

  accessory?: React.ReactNode
  noMedia?: boolean
  spotlightRules?: SpotlightRule[]
  coverImageUrl?: string
  baseUrl?: string
} & React.JSX.IntrinsicElements[A] &
  Partial<{
    renderInlineStyle: boolean
  }>
export const HTML = <A extends keyof React.JSX.IntrinsicElements = "div">(props: HTMLProps<A>) => {
  const {
    children,
    renderInlineStyle,
    as = "article",
    accessory,
    noMedia,
    spotlightRules,
    coverImageUrl,
    baseUrl,

    ...rest
  } = props
  const [remarkOptions, setRemarkOptions] = useState({
    renderInlineStyle,
    noMedia,
    spotlightRules,
  })
  const [shouldForceReMountKey, setShouldForceReMountKey] = useState(0)

  useEffect(() => {
    setRemarkOptions((options) => {
      if (
        JSON.stringify(options) === JSON.stringify({ renderInlineStyle, noMedia, spotlightRules })
      ) {
        return options
      }

      setShouldForceReMountKey((key) => key + 1)
      return { ...options, renderInlineStyle, noMedia, spotlightRules }
    })
  }, [renderInlineStyle, noMedia, spotlightRules])

  const [refElement, setRefElement] = useState<HTMLDivElement | null>(null)

  const markdownElement = useMemo(() => {
    if (!children && (!coverImageUrl || remarkOptions.noMedia)) return null

    return parseHtml(children ?? "", {
      ...remarkOptions,
      coverImageUrl,
      baseUrl,
    }).toContent()
  }, [children, remarkOptions, coverImageUrl, baseUrl])

  if (!markdownElement) return <div className="h-px" />
  return (
    <MarkdownRenderContainerRefContext value={refElement}>
      <MemoedDangerousHTMLStyle>{katexStyle}</MemoedDangerousHTMLStyle>
      <WrappedElementProvider>
        {createElement(
          as,
          {
            ...rest,
            ref: setRefElement,
            style: {
              width: "100%",
              maxWidth: "100%",
              ...rest.style,
            },
            className: clsx(
              "prose max-w-none mx-auto pb-8 [text-autospace:normal]",
              "dark:prose-invert",
            ),
          },
          markdownElement,
        )}
      </WrappedElementProvider>

      {!!accessory && <Fragment key={shouldForceReMountKey}>{accessory}</Fragment>}
    </MarkdownRenderContainerRefContext>
  )
}
