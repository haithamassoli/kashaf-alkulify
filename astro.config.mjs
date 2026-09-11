// @ts-check

import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, fontProviders } from "astro/config";

// https://astro.build/config
export default defineConfig({
  compressHTML: true,
  fonts: [
    {
      cssVariable: "--font-thmanyah-sans",
      fallbacks: ["ui-sans-serif", "system-ui", "sans-serif"],
      name: "Thmanyah Sans",
      options: {
        variants: [
          {
            src: ["./src/assets/fonts/thmanyahsans-Light.woff2"],
            style: "normal",
            weight: 300,
          },
          {
            src: ["./src/assets/fonts/thmanyahsans-Regular.woff2"],
            style: "normal",
            weight: 400,
          },
          {
            src: ["./src/assets/fonts/thmanyahsans-Medium.woff2"],
            style: "normal",
            weight: 500,
          },
          {
            src: ["./src/assets/fonts/thmanyahsans-Bold.woff2"],
            style: "normal",
            weight: 700,
          },
          {
            src: ["./src/assets/fonts/thmanyahsans-Black.woff2"],
            style: "normal",
            weight: 900,
          },
        ],
      },
      provider: fontProviders.local(),
    },
  ],
  integrations: [
    {
      hooks: {
        "astro:config:setup": ({ injectScript }) =>
          injectScript(
            "head-inline",
            `try {
  const saved = localStorage.getItem('theme')
  const dark = saved ? saved === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches
  document.documentElement.classList.toggle('dark', dark)
} catch {}`
          ),
      },
      // Applies the saved theme before first paint, so dark mode never flashes.
      name: "theme-bootstrap",
    },
    react(),
  ],
  // Pinned so the Better Auth trusted origin stays stable across restarts.
  server: { port: 4321 },
  site: "https://alkulify.assoli.site",
  // Canonicals emit /path/ — keep dev and internal links on the same form so the
  // host never has to 301 an internal hop.
  trailingSlash: "always",
  vite: {
    plugins: [tailwindcss()],
  },
});
