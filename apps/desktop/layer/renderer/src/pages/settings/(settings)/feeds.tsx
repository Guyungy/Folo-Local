import { SettingFeeds } from "~/modules/settings/tabs/feeds"
import { SettingsTitle } from "~/modules/settings/title"
import { defineSettingPageData } from "~/modules/settings/utils"

const iconName = "i-mingcute-certificate-line"
const priority = (1000 << 2) + 20

export const handle = defineSettingPageData({
  icon: iconName,
  name: "titles.feeds",
  priority,
})

export function Component() {
  return (
    <>
      <SettingsTitle />
      <SettingFeeds />
    </>
  )
}
