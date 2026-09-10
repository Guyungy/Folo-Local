import { SettingLocalService } from "~/modules/settings/tabs/local"
import { SettingsTitle } from "~/modules/settings/title"
import { defineSettingPageData } from "~/modules/settings/utils"

const priority = (1000 << 1) + 35

export const handle = defineSettingPageData({
  icon: "i-mingcute-server-line",
  name: "titles.local",
  priority,
})

export function Component() {
  return (
    <>
      <SettingsTitle />
      <SettingLocalService />
    </>
  )
}
