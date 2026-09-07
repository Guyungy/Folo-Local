import { SettingSpotlight } from "~/modules/settings/tabs/spotlight"
import { SettingsTitle } from "~/modules/settings/title"
import { defineSettingPageData } from "~/modules/settings/utils"

const iconName = "i-mingcute-flashlight-line"
const priority = (1000 << 1) + 20

export const handle = defineSettingPageData({
  icon: iconName,
  name: "titles.spotlight",
  priority,
})

export function Component() {
  return (
    <>
      <SettingsTitle />
      <SettingSpotlight />
    </>
  )
}
