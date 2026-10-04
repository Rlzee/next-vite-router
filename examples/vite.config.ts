import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nextViteRouter } from "next-vite-router/plugin";

export default defineConfig({
  plugins: [
    react(),
    nextViteRouter({ pagesDir: "src/app" }),
  ],
});
