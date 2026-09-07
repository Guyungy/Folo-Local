export const authProvidersConfig = {
  google: {
    buttonClassName:
      "bg-blue-500 hover:!bg-blue-500/90 focus:!border-blue-500/80 focus:!ring-blue-500/80",
    iconClassName: "i-mingcute-google-fill",
  },
  github: {
    buttonClassName: "bg-black hover:!bg-black/90 focus:!border-black/80 focus:!ring-black/80",
    iconClassName: "i-mingcute-github-fill",
  },
  apple: {
    buttonClassName:
      "bg-gray-800 hover:!bg-gray-800/90 focus:!border-gray-800/80 focus:!ring-gray-800/80",
    iconClassName: "i-mingcute-apple-fill",
  },
} as Record<
  string,
  {
    buttonClassName: string
    iconClassName: string
  }
>
