import type { Linter } from 'eslint';

import { obsidianDevUtilsConfigs } from 'obsidian-dev-utils/ScriptUtils/ESLint/eslint.config';

const configs: Linter.Config[] = [
  ...obsidianDevUtilsConfigs,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off'
    }
  }
];

// eslint-disable-next-line import-x/no-default-export -- ESLint infrastructure requires a default export.
export default configs;
