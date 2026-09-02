import { defineConfig } from "vitest/config";

import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      obsidian: path.resolve(
        import.meta.dirname,
        "src/__tests__/__mocks__/obsidian.ts",
      ),
      // The real obsidian-dev-utils Modals bundle imports `obsidian` directly,
      // which cannot resolve inside pnpm's store in the test environment.
      "obsidian-dev-utils/obsidian/Modals": path.resolve(
        import.meta.dirname,
        "src/__tests__/__mocks__/devUtilsModals.ts",
      ),
    },
  },
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["src/__tests__/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      exclude: [
        "node_modules/",
        "src/**/*.d.ts",
        "src/**/*.test.ts",
        "src/**/*.test.tsx",
        "src/**/__tests__/**",
      ],
    },
  },
});
