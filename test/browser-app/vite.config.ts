import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nextViteRouter } from "next-vite-router/plugin";

// The browser suite runs this app twice: through `vite dev` (per-module requests,
// HMR) and through a production build served by `vite preview` (real chunks, SPA
// fallback for a deep URL). `lazyLayouts` is on so the suite can prove a nested
// `layout.tsx` is code-split from the entry chunk, which is the one behavior a
// static render can never show.
//
// Both servers are pinned to 127.0.0.1 so the ports Playwright dials match the
// sockets Vite binds on Windows, where `localhost` may resolve to `::1`.
//
// The suite copies this app into `hmr-run/` for the HMR project, and this config
// travels with the copy. Nothing here may name that folder in a watcher pattern:
// Vite matches ignore patterns against absolute paths too, so an entry meant to
// keep this server away from the copy would equally make the copy ignore its own
// route files. The copy is inert for this server anyway - nothing in the app
// imports it.
export default defineConfig({
  plugins: [react(), nextViteRouter({ pagesDir: "src/app", lazyLayouts: true })],
  server: { host: "127.0.0.1" },
  preview: { host: "127.0.0.1" },
});
