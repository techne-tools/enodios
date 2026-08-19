import type { Linter } from "eslint";

import { obsidianDevUtilsConfigs } from "obsidian-dev-utils/ScriptUtils/ESLint/eslint.config";

const configs: Linter.Config[] = [
  ...obsidianDevUtilsConfigs,
  {
    ignores: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/__tests__/**",
      "**/__mocks__/**",
    ],
  },
  {
    rules: {
      // Pure-stylistic / sorting rules are handled by dprint (the formatter)
      // and do not affect runtime safety, so they remain disabled.
      "perfectionist/sort-classes": "off",
      "perfectionist/sort-interfaces": "off",
      "perfectionist/sort-object-types": "off",
      "perfectionist/sort-union-types": "off",
      "perfectionist/sort-modules": "off",
      "perfectionist/sort-objects": "off",
      "perfectionist/sort-named-imports": "off",
      "perfectionist/sort-imports": "off",
      "perfectionist/sort-intersection-types": "off",
      "perfectionist/sort-sets": "off",
      "modules-newlines/import-declaration-newline": "off",
      "@stylistic/object-curly-newline": "off",
      "@stylistic/no-multi-spaces": "off",
      "@stylistic/operator-linebreak": "off",
      "@stylistic/quotes": "off",
      "@stylistic/quote-props": "off",
      "@stylistic/max-statements-per-line": "off",
      "@stylistic/comma-dangle": "off",
      "@stylistic/multiline-ternary": "off",
      "@stylistic/jsx-curly-newline": "off",
      "capitalized-comments": "off",
      curly: "off",
      "@typescript-eslint/array-type": "off",
      "no-bitwise": "off",
      "no-lonely-if": "off",
      "no-magic-numbers": "off",
      "no-nested-ternary": "off",
      "no-negated-condition": "off",
      "func-style": "off",
      camelcase: "off",
      complexity: "off",
      "prefer-named-capture-group": "off",
      "no-control-regex": "off",
      "no-useless-escape": "off",
      "prefer-template": "off",
      "@typescript-eslint/dot-notation": "off",
      "@typescript-eslint/prefer-regexp-exec": "off",
      "@typescript-eslint/prefer-optional-chain": "off",
      "@typescript-eslint/explicit-member-accessibility": "off",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-deprecated": "off",
      "import-x/no-nodejs-modules": "off",
      // `non-nullable-type-assertion-style` insists on `!` over `as T`, but
      // `no-non-null-assertion` forbids `!`. For provably-in-bounds array index
      // accesses (with `noUncheckedIndexedAccess` on), `as T` is the only form
      // that satisfies the safety rule, so this stylistic rule stays off.
      "@typescript-eslint/non-nullable-type-assertion-style": "off",
      // Numbers stringify deterministically in template literals, so allowing
      // them avoids noisy `String(x)` wrapping. Strings/booleans/bigints stay
      // restricted, which still catches the dangerous `[object Object]` case.
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true },
      ],
      // `||` is intentionally used over `??` for string/number/bool fallbacks
      // where an empty string or falsy value must fall through to the next
      // candidate (e.g. conversation titles, tool labels, file paths). With
      // `ignorePrimitives`, the rule only flags `||` on nullish-typed operands
      // where `??` would be a genuine safety improvement.
      "@typescript-eslint/prefer-nullish-coalescing": [
        "error",
        { ignorePrimitives: true },
      ],
      // `void` is the canonical way to suppress intentionally-ignored promises
      // (the recommended fix for `no-floating-promises`). This rule conflicts
      // with that, so it stays disabled.
      "no-void": "off",
    },
  },
];

// eslint-disable-next-line import-x/no-default-export -- ESLint infrastructure requires a default export.
export default configs;
