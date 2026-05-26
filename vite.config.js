import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === "build" ? "/XSNIS.github.io/" : "/",
  build: {
    outDir: "docs"
  },
  server: {
    host: "127.0.0.1",
    port: 5199
  }
}));