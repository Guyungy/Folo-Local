import { env } from "@follow/shared/env.desktop"

import { fetchFromLocalApp } from "./api-client"

/**
 * Thin wrapper over the embedded backend for the local service pages. `fetchFromLocalApp` is what
 * routes a renderer request through IPC to the in-process server.
 */
export const localRequest = async <T>(
  path: string,
  init?: { body?: unknown; method?: string },
): Promise<T> => {
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
