import { useIsDark } from "@follow/hooks"
import * as React from "react"
import { Toaster as Sonner } from "sonner"

import { ZIndexProvider } from "../z-index"
import { toastStyles } from "./styles"

type ToasterProps = React.ComponentProps<typeof Sonner>
const TOAST_Z_INDEX = 999999999

export const Toaster = ({ ...props }: ToasterProps) => {
  const isDark = useIsDark()

  return (
    <ZIndexProvider zIndex={TOAST_Z_INDEX}>
      <Sonner
        theme={isDark ? "dark" : "light"}
        gap={12}
        toastOptions={{
          unstyled: true,
          classNames: toastStyles,
        }}
        icons={{
          success: <i className="i-mingcute-check-circle-line" />,
          error: <i className="i-mingcute-close-line" />,
          warning: <i className="i-mingcute-warning-line" />,
          info: <i className="i-mingcute-information-line" />,
          loading: <i className="i-mingcute-loading-3-line animate-spin" />,
        }}
        {...props}
      />
    </ZIndexProvider>
  )
}
