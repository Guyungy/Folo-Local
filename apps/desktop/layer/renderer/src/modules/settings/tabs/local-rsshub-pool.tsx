import { Button } from "@follow/components/ui/button/index.js"
import { Input } from "@follow/components/ui/input/index.js"
import { Label } from "@follow/components/ui/label/index.jsx"
import { Switch } from "@follow/components/ui/switch/index.jsx"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { localRequest } from "~/lib/local-request"

interface RsshubInstance {
  url: string
  enabled: boolean
  position: number
  failureCount: number
  latencyMs: number | null
  lastCheckedAt: string | null
  lastSuccessAt: string | null
  lastError: string | null
  feedCount: number
}

interface RsshubSettings {
  baseURL: string
  instances: RsshubInstance[]
  probeRoutes: string[]
}

interface ProbeResult {
  route: string
  ok: boolean
  status: number | null
  latencyMs: number
  error: string | null
}

interface ProbeTest {
  url: string
  results: ProbeResult[]
}

const POOL_QUERY_KEY = ["localRsshubPool"] as const

const statusOf = (instance: RsshubInstance) => {
  if (!instance.enabled) return "disabled" as const
  if (instance.failureCount > 0) return "failing" as const
  return instance.lastSuccessAt ? ("ok" as const) : ("unknown" as const)
}

const STATUS_CLASS = {
  ok: "bg-green",
  failing: "bg-red",
  unknown: "bg-fill-tertiary",
  disabled: "bg-fill-quaternary",
} as const

export const SettingRsshubPool = () => {
  const { t } = useTranslation("settings")
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState("")
  const [tests, setTests] = useState<ProbeTest[] | null>(null)

  const { data, isLoading } = useQuery({
    queryFn: () => localRequest<RsshubSettings>("/settings/rsshub"),
    queryKey: POOL_QUERY_KEY,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: POOL_QUERY_KEY })
  const fail = (error: unknown, fallback: string) =>
    toast.error(error instanceof Error ? error.message : fallback)

  const addInstance = useMutation({
    mutationFn: (url: string) =>
      localRequest<{ instances: RsshubInstance[] }>("/settings/rsshub/instances", {
        body: { url },
        method: "POST",
      }),
    async onSuccess() {
      setDraft("")
      toast.success(t("local.rsshub_added"))
      await invalidate()
    },
    onError: (error) => fail(error, t("local.rsshub_add_failed")),
  })

  const toggleInstance = useMutation({
    mutationFn: ({ enabled, url }: { enabled: boolean; url: string }) =>
      localRequest<{ instances: RsshubInstance[] }>("/settings/rsshub/instances", {
        body: { enabled, url },
        method: "PATCH",
      }),
    async onSuccess() {
      await invalidate()
    },
    onError: (error) => fail(error, t("local.rsshub_add_failed")),
  })

  const preferInstance = useMutation({
    mutationFn: (url: string) =>
      localRequest<{ baseURL: string }>("/settings/rsshub", {
        body: { baseURL: url },
        method: "PUT",
      }),
    async onSuccess() {
      await invalidate()
    },
    onError: (error) => fail(error, t("local.rsshub_add_failed")),
  })

  const resetPool = useMutation({
    mutationFn: () =>
      localRequest<{ instances: RsshubInstance[] }>("/settings/rsshub/reset", { method: "POST" }),
    async onSuccess() {
      setTests(null)
      toast.success(t("local.rsshub_reset_done"))
      await invalidate()
    },
    onError: (error) => fail(error, t("local.rsshub_add_failed")),
  })

  const testPool = useMutation({
    mutationFn: () =>
      localRequest<{ tests: ProbeTest[] }>("/settings/rsshub/test", { body: {}, method: "POST" }),
    async onSuccess(result) {
      setTests(result.tests)
      await invalidate()
    },
    onError: (error) => fail(error, t("local.rsshub_test_failed")),
  })

  const instances = data?.instances ?? []
  const probeRouteCount = data?.probeRoutes.length ?? 0

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-text-tertiary">{t("local.rsshub_pool_description")}</p>
        <div className="flex shrink-0 gap-2">
          <Button
            disabled={testPool.isPending || instances.length === 0}
            variant="outline"
            onClick={() => testPool.mutate()}
          >
            {testPool.isPending ? t("local.rsshub_testing") : t("local.rsshub_test")}
          </Button>
          <Button
            disabled={resetPool.isPending}
            variant="outline"
            onClick={() => resetPool.mutate()}
          >
            {t("local.rsshub_reset")}
          </Button>
        </div>
      </div>

      {probeRouteCount === 0 && (
        <p className="text-xs text-text-quaternary">{t("local.rsshub_no_routes")}</p>
      )}

      <div className="space-y-2 rounded-lg border border-border p-4">
        {isLoading && <p className="text-sm text-text-tertiary">…</p>}
        {!isLoading && instances.length === 0 && (
          <p className="text-sm text-text-tertiary">{t("local.rsshub_empty")}</p>
        )}

        {instances.map((instance) => {
          const status = statusOf(instance)
          const probe = tests?.find((entry) => entry.url === instance.url)
          const available = probe?.results.filter((result) => result.ok).length ?? 0
          const firstFailure = probe?.results.find((result) => !result.ok)
          return (
            <div
              key={instance.url}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border pb-2 last:border-b-0 last:pb-0"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`size-2 shrink-0 rounded-full ${STATUS_CLASS[status]}`} />
                  <span className="truncate font-mono text-xs">{instance.url}</span>
                  {data?.baseURL === instance.url && (
                    <span className="rounded bg-fill-secondary px-1.5 py-0.5 text-[10px] text-text-secondary">
                      {t("local.rsshub_preferred")}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-tertiary">
                  <span>
                    {status === "failing"
                      ? t("local.rsshub_status_failing", { count: instance.failureCount })
                      : status === "disabled"
                        ? t("local.rsshub_status_disabled")
                        : instance.lastSuccessAt
                          ? t("local.rsshub_status_ok")
                          : t("local.rsshub_status_unknown")}
                  </span>
                  {instance.latencyMs !== null && <span>{instance.latencyMs} ms</span>}
                  <span>{t("local.rsshub_feed_count", { count: instance.feedCount })}</span>
                  <span>
                    {instance.lastSuccessAt
                      ? t("local.rsshub_last_success", {
                          time: new Date(instance.lastSuccessAt).toLocaleString(),
                        })
                      : t("local.rsshub_never")}
                  </span>
                </div>
                {probe && (
                  <div className="mt-1 text-[11px]">
                    <span
                      className={available === probe.results.length ? "text-green" : "text-red"}
                    >
                      {t("local.rsshub_test_summary", {
                        ok: available,
                        total: probe.results.length,
                      })}
                    </span>
                    {firstFailure?.error && (
                      <span className="ml-2 text-text-tertiary" title={firstFailure.error}>
                        {firstFailure.route}: {firstFailure.error}
                      </span>
                    )}
                  </div>
                )}
                {!probe && instance.lastError && (
                  <p className="mt-1 truncate text-[11px] text-red" title={instance.lastError}>
                    {instance.lastError}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Button
                  disabled={
                    preferInstance.isPending || !instance.enabled || data?.baseURL === instance.url
                  }
                  variant="outline"
                  onClick={() => preferInstance.mutate(instance.url)}
                >
                  {t("local.rsshub_set_preferred")}
                </Button>
                <Switch
                  checked={instance.enabled}
                  disabled={toggleInstance.isPending}
                  onChange={(enabled) => toggleInstance.mutate({ enabled, url: instance.url })}
                />
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-64 flex-1 space-y-2">
          <Label htmlFor="local-rsshub-instance">{t("local.rsshub_add")}</Label>
          <Input
            id="local-rsshub-instance"
            placeholder={t("local.rsshub_add_placeholder")}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </div>
        <Button
          disabled={addInstance.isPending || !draft.trim()}
          variant="outline"
          onClick={() => addInstance.mutate(draft.trim())}
        >
          {t("local.rsshub_add")}
        </Button>
      </div>
    </>
  )
}
