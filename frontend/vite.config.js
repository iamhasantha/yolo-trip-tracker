import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      // In dev, forwards /api calls to the backend on :4000
      "/api": "http://localhost:4000",
    },
  },
});
