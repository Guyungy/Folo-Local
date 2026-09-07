import { useCallback } from "react"

import { m } from "~/components/common/Motion"
import type { ClipboardContent } from "~/lib/clipboard"
import { copyToClipboard } from "~/lib/clipboard"

import { AnimatedCommandButton } from "./AnimatedCommandButton"

export const CopyButton: Component<{
  value: ClipboardContent
  style?: React.CSSProperties
  variant?: "solid" | "outline" | "ghost"
}> = ({ value, className, style, variant = "solid" }) => {
  const handleCopy = useCallback(() => {
    void copyToClipboard(value).catch(() => undefined)
  }, [value])
  return (
    <AnimatedCommandButton
      className={className}
      style={style}
      variant={variant}
      icon={<m.i className="i-mingcute-copy-2-line size-4" />}
      onClick={handleCopy}
    />
  )
}
