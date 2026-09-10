import { env } from "@follow/shared/env.desktop"
import { feedSyncServices } from "@follow/store/feed/store"
import { tracker } from "@follow/tracker"
import { formatXml } from "@follow/utils/utils"
import type { QueryClient } from "@tanstack/react-query"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRef } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { ROUTE_FEED_IN_FOLDER, ROUTE_FEED_PENDING } from "~/constants"
import { useAuthQuery } from "~/hooks/common"
import { fetchFromLocalApp, followClient } from "~/lib/api-client"
import { defineQuery } from "~/lib/defineQuery"
import { toastFetchError } from "~/lib/error-parser"

type FeedQueryParams = { id?: string; url?: string }

export const feed = {
  byId: ({ id, url }: FeedQueryParams) =>
    defineQuery(
      ["feed", id, url],
      async () =>
        feedSyncServices.fetchFeedById({
          id,
          url,
        }),
      {
        rootKey: ["feed"],
      },
    ),
  claimMessage: ({ feedId }: { feedId: string }) =>
    defineQuery(["feed", "claimMessage", feedId], async () =>
      followClient.api.feeds.claim.message({ feedId }).then((res) => {
        res.data.json = JSON.stringify(JSON.parse(res.data.json), null, 2)
        const $document = new DOMParser().parseFromString(res.data.xml, "text/xml")
        res.data.xml = formatXml(new XMLSerializer().serializeToString($document))
        return res
      }),
    ),
  claimedList: () =>
    defineQuery(["feed", "claimedList"], async () => {
      const res = await followClient.api.feeds.claim.list()
      return res.data
    }),
}

export const useFeedQuery = ({ id, url }: FeedQueryParams) =>
  useAuthQuery(
    feed.byId({
      id,
      url,
    }),
    {
      retry: false,
      enabled:
        (!!id || !!url) && id !== ROUTE_FEED_PENDING && !id?.startsWith(ROUTE_FEED_IN_FOLDER),
    },
  )

export const useClaimFeedMutation = (feedId: string) =>
  useMutation({
    mutationKey: ["claimFeed", feedId],
    mutationFn: () => feedSyncServices.claimFeed(feedId),

    async onError(err) {
      toastFetchError(err)
    },
    onSuccess() {
      tracker.feedClaimed({
        feedId,
      })
    },
  })

/**
 * The list only reads from the local server, so a finished refresh stays invisible until the
 * cached entry/feed queries are invalidated.
 */
export const invalidateAfterRefresh = async (queryClient: QueryClient) => {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["entries"] }),
    queryClient.invalidateQueries({ queryKey: ["feed"] }),
  ])
}

export const useRefreshFeedMutation = (feedId?: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ["refreshFeed", feedId],
    mutationFn: () => followClient.api.feeds.refresh({ id: feedId! }),
    async onError(err) {
      toastFetchError(err)
    },
    async onSuccess() {
      await invalidateAfterRefresh(queryClient)
    },
  })
}

const REFRESH_STATUS_KEY = ["refreshStatus"] as const

export interface LocalRefreshRun {
  total: number
  failed: number
  notModified: number
  startedAt: string
  finishedAt: string
  running: boolean
}

export interface LocalRefreshStatus {
  intervalMinutes: number
  lastRun: LocalRefreshRun | null
  running: boolean
}

/** Batch refresh on the local server: one request instead of one per feed. */
const batchRefresh = async (ids?: string[]) => {
  const response = await fetchFromLocalApp(
    new Request(`${env.VITE_API_URL}/feeds/refresh`, {
      body: JSON.stringify(ids?.length ? { ids } : {}),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  )
  const result = (await response.json()) as {
    code: number
    data?: { total: number; failed: number; notModified: number }
    message?: string
  }
  if (result.code !== 0 || !result.data) throw new Error(result.message ?? "Refresh failed")
  return result.data
}

export const useRefreshStatusQuery = () =>
  useQuery({
    queryFn: async (): Promise<LocalRefreshStatus> => {
      const response = await fetchFromLocalApp(
        new Request(`${env.VITE_API_URL}/local/refresh-status`),
      )
      const result = (await response.json()) as { code: number; data: LocalRefreshStatus }
      return result.data
    },
    queryKey: REFRESH_STATUS_KEY,
    // Cheap local read; a short interval is what makes background updates show up in the list.
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  })

export const updateRefreshInterval = async (intervalMinutes: number) => {
  const response = await fetchFromLocalApp(
    new Request(`${env.VITE_API_URL}/settings/refresh`, {
      body: JSON.stringify({ intervalMinutes }),
      headers: { "content-type": "application/json" },
      method: "PUT",
    }),
  )
  const result = (await response.json()) as {
    code: number
    data?: { intervalMinutes: number }
    message?: string
  }
  if (result.code !== 0 || !result.data)
    throw new Error(result.message ?? "Unable to save refresh interval")
  return result.data
}

/**
 * Refresh every subscribed feed. The timeline view has no single feed id, so it relies on this.
 */
export const useRefreshAllFeedsMutation = () => {
  const queryClient = useQueryClient()
  const { t } = useTranslation()

  return useMutation({
    mutationKey: ["refreshAllFeeds"],
    mutationFn: () => batchRefresh(),
    async onError(err) {
      toastFetchError(err)
    },
    async onSuccess({ failed, total }) {
      await invalidateAfterRefresh(queryClient)
      await queryClient.invalidateQueries({ queryKey: REFRESH_STATUS_KEY })
      if (failed > 0) {
        toast.error(t("entry_list_header.refresh_all_partial", { failed, total }))
      }
    },
  })
}

export const useResetFeed = () => {
  const { t } = useTranslation()
  const toastIDRef = useRef<string | number | null>(null)

  return useMutation({
    mutationFn: async (feedId: string) => {
      toastIDRef.current = toast.loading(t("sidebar.feed_actions.resetting_feed"))
      await followClient.api.feeds.reset({ id: feedId })
    },
    onSuccess: () => {
      toast.success(
        t("sidebar.feed_actions.reset_feed_success"),
        toastIDRef.current ? { id: toastIDRef.current } : undefined,
      )
    },
    onError: () => {
      toast.error(
        t("sidebar.feed_actions.reset_feed_error"),
        toastIDRef.current ? { id: toastIDRef.current } : undefined,
      )
    },
  })
}
