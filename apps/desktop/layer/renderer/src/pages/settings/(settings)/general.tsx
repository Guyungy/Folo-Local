import { SettingGeneral } from "~/modules/settings/tabs/general"
import { SettingsTitle } from "~/modules/settings/title"
import { defineSettingPageData } from "~/modules/settings/utils"

const iconName = "i-mingcute-settings-7-line"
const priority = 1000 << 1

export const handle = defineSettingPageData({
  icon: iconName,
  name: "titles.general",
  priority,
})

export function Component() {
  return (
    <>
      <SettingsTitle />
      <SettingGeneral />
    </>
  )
}
