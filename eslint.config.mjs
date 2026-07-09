import tseslint from "typescript-eslint";
import comments from "@eslint-community/eslint-plugin-eslint-comments";

// Parity replacement for the previous lintcn ruleset. Only the three rules
// lintcn enforced are enabled here, so ESLint stays quiet on code that was
// never previously linted with the full recommended set.
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.turbo/**",
      ".lintcn/**",
      "docs/**",
      ".opencode/**",
      "**/*.snap",
      // Files outside each package's tsconfig program (lintcn linted the
      // tsconfig program, so these were never linted before either).
      "**/*.config.ts",
      "**/*.config.mts",
      "**/*.config.cts",
      "packages/browser-tools/evals/**",
      "apps/website/src/**/*.spec.ts",
      "apps/website/src/**/*.spec.tsx",
      // Generated code.
      "**/*.gen.ts",
    ],
  },
  {
    // Match lintcn: do not report unused disable directives (new scope).
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
  },
  tseslint.configs.base,
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@eslint-community/eslint-comments": comments,
    },
    rules: {
      // was: .lintcn/no_floating_promises (tsgolint port, ignoreVoid default true)
      "@typescript-eslint/no-floating-promises": "error",
      // was: .lintcn/await_thenable (tsgolint port)
      "@typescript-eslint/await-thenable": "error",
      // was: .lintcn/no_await_import (ban `await import(...)`)
      "no-restricted-syntax": [
        "error",
        {
          selector: "AwaitExpression > ImportExpression",
          message:
            "`await import(...)` is not allowed. Use a static import, or suppress with `// eslint-disable-next-line no-restricted-syntax -- <reason>`.",
        },
      ],
      // enforces the `@lintc-ignore <reason>` behavior: a disable comment must carry a reason
      "@eslint-community/eslint-comments/require-description": [
        "error",
        { ignore: [] },
      ],
    },
  },
);
