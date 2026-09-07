import { getView } from "@follow/constants"
import * as React from "react"

import type { MentionType } from "../../types"

interface MentionTypeIconProps {
  type: MentionType
  value?: unknown
  className?: string
}

export const MentionTypeIcon: React.FC<MentionTypeIconProps> = ({
  type,
  value,
  className = "size-3",
}) => {
  switch (type) {
    case "entry": {
      return <i className={`i-mingcute-paper-fill ${className}`} />
    }
    case "feed": {
      return <i className={`i-mingcute-rss-fill ${className}`} />
    }
    case "category": {
      return <i className={`i-mingcute-folder-open-line ${className}`} />
    }
    case "date": {
      return <i className={`i-mingcute-calendar-time-add-line ${className}`} />
    }
    case "view": {
      if (typeof value === "number") {
        const viewDef = getView(value)
        if (viewDef?.icon?.props?.className) {
          return <i className={`${viewDef.icon.props.className} ${className}`} />
        }
      }
      return <i className={`i-mingcute-grid-line ${className}`} />
    }
    default: {
      return <i className={`i-mingcute-ai-line ${className}`} />
    }
  }
}

MentionTypeIcon.displayName = "MentionTypeIcon"
