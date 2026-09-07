import { SettingLists } from "~/modules/settings/tabs/lists"
import { SettingsTitle } from "~/modules/settings/title"
import { defineSettingPageData } from "~/modules/settings/utils"

const iconName = "i-mingcute-radar-line"
const priority = (1000 << 2) + 10

export const handle = defineSettingPageData({
  icon: iconName,
  name: "titles.lists",
  priority,
  hideIf: (ctx) => ctx.isInMASReview,
})

export function Component() {
  return (
    <>
      <SettingsTitle />
      <SettingLists />
    </>
  )
}
