import { defineConfig } from "vitest/config";

// base "./" keeps every asset URL relative, so the build works unchanged when
// served from a subdirectory (tcj.io/bigbucket/) or opened from any path.
export default defineConfig({
  base: "./",
  build: { target: "es2022", sourcemap: true },
  test: { include: ["test/**/*.test.ts"], environment: "node" },
});
