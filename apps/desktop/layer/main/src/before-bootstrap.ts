import { app, protocol } from "electron"
import path from "pathe"

const e2eUserDataDir = process.env.FOLO_E2E_USER_DATA_DIR

app.setName("FoLocal")

if (e2eUserDataDir) {
  app.setPath("userData", e2eUserDataDir)
} else if (import.meta.env.DEV) {
  app.setPath("userData", path.join(app.getPath("appData"), "Folo(dev)"))
} else {
  // Keep the existing local database when the distributable is branded as FoLocal.
  app.setPath("userData", path.join(app.getPath("appData"), "Folo"))
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      bypassCSP: true,
      supportFetchAPI: true,
      secure: true,
    },
  },
])
