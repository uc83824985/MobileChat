/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/MobileChat/",
  server: {
    watch: {
      ignored: ["**/.tmp/desktop-profile/**"],
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "app-icon.svg"],
      manifest: {
        name: "MobileChat",
        short_name: "MobileChat",
        description:
          "Local-first mobile chat client for OpenAI-compatible endpoints.",
        theme_color: "#f7f7f2",
        background_color: "#f7f7f2",
        display: "standalone",
        start_url: "/MobileChat/",
        scope: "/MobileChat/",
        icons: [
          {
            src: "app-icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        navigateFallback: "/MobileChat/index.html",
        globPatterns: ["**/*.{js,css,html,svg,png,webp,woff2}"],
      },
    }),
  ],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["node_modules", "dist", "tests"],
  },
});
