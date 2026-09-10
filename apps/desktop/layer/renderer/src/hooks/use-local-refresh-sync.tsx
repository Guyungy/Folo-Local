import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef } from "react"

import { appLog } from "~/lib/log"
import { invalidateAfterRefresh, useRefreshStatusQuery } from "~/queries/feed"

/**
 * The local backend refreshes subscriptions on a timer, in the main process, with no way to push
 * into the renderer. Polling the scheduler status and invalidating when a sweep finishes is what
 * makes freshly fetched entries appear without a manual refresh.
 */
export const LocalRefreshSync = () => {
  const queryClient = useQueryClient()
  const { data } = useRefreshStatusQuery()
  const lastHandledRef = useRef<string | null>(null)

  useEffect(() => {
    const finishedAt = data?.lastRun?.finishedAt ?? null
    if (!finishedAt) return
    if (lastHandledRef.current === null) {
      // First observation only records the baseline; it must not trigger a refetch on mount.
      lastHandledRef.current = finishedAt
      return
    }
    if (lastHandledRef.current === finishedAt) return
    lastHandledRef.current = finishedAt
    appLog(`Background refresh finished, invalidating entries (${finishedAt})`)
    void invalidateAfterRefresh(queryClient)
  }, [data?.lastRun?.finishedAt, queryClient])

  return null
}
