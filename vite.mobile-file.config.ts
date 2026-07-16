/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    emptyOutDir: true,
    outDir: ".tmp/mobile-file-dist",
    cssCodeSplit: false,
    minify: true,
    rollupOptions: {
      input: "src/main.file.tsx",
      output: {
        entryFileNames: "app.js",
        assetFileNames: "app[extname]",
        format: "iife",
        name: "MobileChatFileApp",
      },
    },
  },
});
