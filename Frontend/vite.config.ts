import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("optiflowzTheme/dist/media-theme.js")) {
            return "mux-theme";
          }

          if (
            id.includes("@mux/mux-player-react") ||
            id.includes("@mux/mux-player") ||
            id.includes("media-chrome") ||
            id.includes("player.style")
          ) {
            return "mux-player";
          }
        },
      },
    },
  },
  plugins: [tailwindcss(), reactRouter(), tsconfigPaths()],
});
