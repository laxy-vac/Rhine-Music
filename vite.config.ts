import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        app: resolve(projectRoot, "index.html"),
        qualityBenchmark: resolve(projectRoot, "quality-benchmark.html"),
      },
    },
  },
});
