/* @moduleResolution bundler */
import "./tw-css-plugin"

import { getIconCollections, iconsPlugin } from "@egoist/tailwindcss-icons"
import { merge } from "es-toolkit/compat"
import { resolve } from "pathe"
import type { Config } from "tailwindcss"
import { withUIKit } from "tailwindcss-uikit-colors/macos"

import ratioMixingPlugin from "./ratio-mixing-plugin"

const twConfig = {
  darkMode: ["class", '[data-theme="dark"]'],
  content: [],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontSize: {
        largeTitle: ["1.625rem", "2rem"], // 26px
        title1: ["1.375rem", "1.625rem"], // 22px
        title2: ["1.0625rem", "1.375rem"], // 17px
        title3: ["0.9375rem", "1.25rem"], // 15px
        headline: ["0.8125rem", "1rem"], // 13px
        body: ["0.8125rem", "1rem"], // 13px
        callout: ["0.75rem", "0.9375rem"], // 12px
        subheadline: ["0.6875rem", "0.875rem"], // 11px
        footnote: ["0.625rem", "0.8125rem"], // 10px
        caption: ["0.625rem", "0.8125rem"], // 10px
      },
      fontFamily: {
        theme: "var(--fo-font-family)",
      },

      colors: {
        // DaisyUI 5 reserves --border for border width, so keep the color token namespaced.
        border: "hsl(var(--fo-border) / <alpha-value>)",
        background: "hsl(var(--background) / <alpha-value>)",

        accent: "hsl(var(--fo-a) / <alpha-value>)",
        folo: "#FF5C00",

        theme: {
          boxShadow: {
            "context-menu":
              "0px 0px 1px rgba(0, 0, 0, 0.4), 0px 0px 1.5px rgba(0, 0, 0, 0.3), 0px 7px 22px rgba(0, 0, 0, 0.25)",
          },

          item: {
            active: "var(--fo-item-active)",
            hover: "var(--fo-item-hover)",
          },
          selection: {
            active: "var(--fo-selection-active)",
            hover: "var(--fo-selection-hover)",
            foreground: "var(--fo-selection-foreground)",
          },

          inactive: "hsl(var(--fo-inactive) / <alpha-value>)",
          disabled: "hsl(var(--fo-disabled) / <alpha-value>)",

          background: "var(--fo-background)",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      backdropBlur: {
        background: "80px",
      },

      typography: (theme: any) => ({
        zinc: {
          css: {
            "--tw-prose-body": theme("colors.zinc.500"),
            "--tw-prose-quotes": theme("colors.zinc.500"),
          },
        },
      }),
    },
  },

  plugins: [
    iconsPlugin({
      collections: {
        ...getIconCollections(["mingcute", "simple-icons", "logos"]),
      },
    }),
    require("tailwindcss-animate"),
    require("@tailwindcss/container-queries"),
    require("@tailwindcss/typography"),
    require("tailwindcss-motion"),
    require("tailwindcss-safe-area"),

    require(resolve(__dirname, "./tailwind-extend.css")),

    ratioMixingPlugin({
      baseColors: {
        background: "hsl(var(--background))",
        accent: "hsl(var(--fo-a))",
        red: "rgb(var(--color-red))",
        transparent: "transparent",
      },
    }),
  ],
} satisfies Config

export const extendConfig = (config: Config) => {
  const result = merge({}, withUIKit(twConfig), config)
  if (config.plugins) {
    // Merge plugin array
    result.plugins = [...twConfig.plugins, ...config.plugins]
  }
  return result
}
