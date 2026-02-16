import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import prettierConfig from "eslint-config-prettier";

/** @type {import("eslint").Linter.FlatConfig[]} */
export default [
  // Global ignores
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "**/*.d.ts",
      "eslint.config.js",
      "postcss.config.js",
      "vite.config.ts",
      "vite-plugin-meta-images.ts",
      "drizzle.config.ts",
      "script/**",
    ],
  },

  // TypeScript + React files
  {
    files: ["client/src/**/*.ts", "client/src/**/*.tsx", "server/**/*.ts", "shared/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
    },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      // TypeScript recommended
      ...tsPlugin.configs.recommended.rules,

      // React hooks
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // Relax strict TS rules that generate noise in an existing codebase
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Downgrade to warnings so pre-existing code doesn't block CI on first pass
      "@typescript-eslint/ban-ts-comment": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",

      // Disable base rule in favour of TS version
      "no-unused-vars": "off",
    },
  },

  // Disable all rules that conflict with Prettier (must be last)
  prettierConfig,
];
