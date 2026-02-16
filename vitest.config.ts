import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["server/**/*.ts", "client/src/**/*.ts", "shared/**/*.ts"],
      exclude: ["**/*.test.ts"],
    },
    projects: [
      {
        test: {
          name: "server-and-shared",
          environment: "node",
          include: ["server/**/*.test.ts", "shared/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "client",
          environment: "jsdom",
          include: ["client/src/**/*.test.ts"],
        },
      },
    ],
  },
});
