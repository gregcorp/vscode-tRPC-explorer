import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    outDir: resolve(__dirname, "..", "dist", "webview"),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, "index.html"),
      output: {
        entryFileNames: "main.js",
        assetFileNames: "main.[ext]",
      },
    },
  },
});
