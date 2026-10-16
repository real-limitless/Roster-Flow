import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const webPort = Number(process.env.ROSTER_WEB_PORT || 5175);

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: webPort,
    strictPort: true,
    proxy: {
      "/api": {
        target: process.env.ROSTER_API_PROXY || "http://127.0.0.1:8790",
        changeOrigin: true,
        ws: true,
      },
      "/mcp": {
        target: process.env.ROSTER_API_PROXY || "http://127.0.0.1:8790",
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: "0.0.0.0",
    port: webPort,
    strictPort: true,
  },
});
