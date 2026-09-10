import { Button } from "@follow/components/ui/button/index.js"
import { Input } from "@follow/components/ui/input/index.js"
import { Label } from "@follow/components/ui/label/index.jsx"
import { Switch } from "@follow/components/ui/switch/index.jsx"
import { env } from "@follow/shared/env.desktop"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useCallback, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { fetchFromLocalApp } from "~/lib/api-client"
import {
  updateRefreshInterval,
  useRefreshAllFeedsMutation,
  useRefreshStatusQuery,
} from "~/queries/feed"

import { SettingSectionTitle } from "../section"

const INTERVAL_PRESETS = [15, 30, 60, 120, 240]

interface LocalDatabaseInfo {
  databasePath: string
  bytes: number
  counts: { feeds: number; subscriptions: number; entries: number; reads: number }
}

const localRequest = async <T,>(path: string, init?: { body?: unknown; method?: string }) => {
  const response = await fetchFromLocalApp(
    new Request(`${env.VITE_API_URL}${path}`, {
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      headers: init?.body === undefined ? undefined : { "content-type": "application/json" },
      method: init?.method ?? "GET",
    }),
  )
  const result = (await response.json()) as { code: number; data?: T; message?: string }
  if (result.code !== 0 || result.data === undefined)
    throw new Error(result.message ?? `Request failed: ${path}`)
  return result.data
}

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export const SettingLocalService = () => {
  const { t } = useTranslation("settings")
  const { data: status } = useRefreshStatusQuery()
  const refreshAll = useRefreshAllFeedsMutation()
  const [savingInterval, setSavingInterval] = useState(false)
  const [customInterval, setCustomInterval] = useState("")
  const [backupPath, setBackupPath] = useState<string | null>(null)

  const { data: databaseInfo } = useQuery({
    queryFn: () => localRequest<LocalDatabaseInfo>("/data/info"),
    queryKey: ["localDatabaseInfo"],
  })

  const backup = useMutation({
    mutationFn: () =>
      localRequest<{ path: string; bytes: number }>("/data/backup", { method: "POST" }),
    onError(error) {
      toast.error(error instanceof Error ? error.message : t("local.backup_failed"))
    },
    onSuccess(result) {
      setBackupPath(result.path)
      toast.success(t("local.backup_done", { size: formatBytes(result.bytes) }))
    },
  })

  const interval = status?.intervalMinutes ?? 0
  const lastRun = status?.lastRun ?? null

  const applyInterval = useCallback(
    async (minutes: number) => {
      setSavingInterval(true)
      try {
        await updateRefreshInterval(minutes)
        toast.success(
          minutes === 0
            ? t("local.background_refresh_off")
            : t("local.background_refresh_saved", { minutes }),
        )
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("local.background_refresh_failed"))
      } finally {
        setSavingInterval(false)
      }
    },
    [t],
  )

  return (
    <div className="mt-4">
      <SettingSectionTitle title={t("local.background_refresh")} />
      <div className="space-y-4 rounded-lg border border-border p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label>{t("local.background_refresh_enabled")}</Label>
            <p className="mt-1 text-xs text-text-tertiary">
              {t("local.background_refresh_description")}
            </p>
          </div>
          <Switch
            checked={interval > 0}
            disabled={savingInterval}
            onChange={(checked) => void applyInterval(checked ? 60 : 0)}
          />
        </div>

        <div className={interval === 0 ? "pointer-events-none opacity-40" : undefined}>
          <Label>{t("local.background_refresh_interval")}</Label>
          <div className="mt-2 flex flex-wrap gap-2">
            {INTERVAL_PRESETS.map((minutes) => (
              <Button
                key={minutes}
                disabled={savingInterval}
                variant={interval === minutes ? "primary" : "outline"}
                onClick={() => void applyInterval(minutes)}
              >
                {t("local.minutes", { value: minutes })}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-2">
            <Label htmlFor="local-refresh-custom">{t("local.custom_interval")}</Label>
            <Input
              id="local-refresh-custom"
              className="w-32"
              inputMode="numeric"
              value={customInterval}
              placeholder={String(interval || 60)}
              onChange={(event) => setCustomInterval(event.target.value.replace(/\D/g, ""))}
            />
          </div>
          <Button
            disabled={savingInterval || !customInterval}
            variant="outline"
            onClick={() => void applyInterval(Number(customInterval))}
          >
            {t("local.apply")}
          </Button>
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
          <p className="text-xs text-text-tertiary">
            {refreshAll.isPending
              ? t("local.refreshing")
              : lastRun
                ? t("local.last_run", {
                    time: new Date(lastRun.finishedAt).toLocaleString(),
                    total: lastRun.total,
                    failed: lastRun.failed,
                  })
                : t("local.never_run")}
          </p>
          <Button
            disabled={refreshAll.isPending}
            variant="outline"
            onClick={() => refreshAll.mutate()}
          >
            {t("local.refresh_now")}
          </Button>
        </div>
      </div>

      <SettingSectionTitle title={t("local.database")} />
      <div className="space-y-3 rounded-lg border border-border p-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-text-tertiary">{t("local.database_path")}</dt>
          <dd className="break-all font-mono text-xs">{databaseInfo?.databasePath ?? "—"}</dd>
          <dt className="text-text-tertiary">{t("local.database_size")}</dt>
          <dd>{databaseInfo ? formatBytes(databaseInfo.bytes) : "—"}</dd>
          <dt className="text-text-tertiary">{t("local.database_stats")}</dt>
          <dd>
            {databaseInfo
              ? t("local.database_stats_value", {
                  feeds: databaseInfo.counts.feeds,
                  entries: databaseInfo.counts.entries,
                  reads: databaseInfo.counts.reads,
                })
              : "—"}
          </dd>
        </dl>

        <div className="flex items-center justify-between gap-4 border-t border-border pt-3">
          <p className="text-xs text-text-tertiary">{t("local.backup_description")}</p>
          <Button disabled={backup.isPending} variant="outline" onClick={() => backup.mutate()}>
            {backup.isPending ? t("local.backing_up") : t("local.backup")}
          </Button>
        </div>
        {backupPath && (
          <p className="break-all rounded-md bg-fill-secondary p-2 font-mono text-xs">
            {t("local.backup_path", { path: backupPath })}
          </p>
        )}
      </div>

      <SettingSectionTitle title={t("local.search")} />
      <p className="text-sm text-text-tertiary">{t("local.search_description")}</p>
    </div>
  )
}
