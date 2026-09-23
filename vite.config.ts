import { defineConfig } from "vitest/config";

// base "./" keeps every asset URL relative, so the build works unchanged when
// served from a subdirectory (tcj.io/bigbucket/) or opened from any path.
export default defineConfig({
  base: "./",
  // three.js (~150 kB gz) is its own lazily-imported chunk for the 3D view.
  build: { target: "es2022", sourcemap: true, chunkSizeWarningLimit: 700 },
  test: { include: ["test/**/*.test.ts"], environment: "node" },
});
