import { SettingIntegration } from "~/modules/settings/tabs/integration"
import { SettingsTitle } from "~/modules/settings/title"
import { defineSettingPageData } from "~/modules/settings/utils"

const iconName = "i-mingcute-department-line"
const priority = (1000 << 1) + 20

export const handle = defineSettingPageData({
  icon: iconName,
  name: "titles.integration",
  priority,
})

export function Component() {
  return (
    <>
      <SettingsTitle />
      <SettingIntegration />
    </>
  )
}
