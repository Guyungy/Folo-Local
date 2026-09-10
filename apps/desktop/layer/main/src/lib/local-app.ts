import { app } from "electron"
import { join } from "pathe"

let localAppPromise: Promise<typeof import("@follow/server").app> | undefined

/**
 * Boots the embedded local backend. The background refresh scheduler has to be started from the
 * main process: it is what replaces the upstream "server crawls and pushes" pipeline.
 */
export function getLocalApp() {
  localAppPromise ??= (async () => {
    process.env.DATABASE_PATH = join(app.getPath("userData"), "local-api.db")
    process.env.OPENAI_CONFIG_PATH = join(app.getPath("userData"), "openai.json")
    const server = await import("@follow/server")
    server.startRefreshScheduler()
    app.once("before-quit", () => server.stopRefreshScheduler())
    return server.app
  })()
  return localAppPromise
}
