import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      reportsDirectory: "coverage",
      include: [
        "src/app/**/*.ts",
        "src/tasks/**/*.ts",
        "src/slack/**/*.ts",
        "src/store.ts",
        "src/blocks.ts",
      ],
      exclude: ["src/index.ts", "src/types.ts", "src/slack/handlers/**/*.ts"],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 75,
        statements: 85,
      },
    },
  },
});
