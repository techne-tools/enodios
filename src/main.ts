import './styles/main.scss'; // Do not delete this line if you want to have a styles.css file in your build output.
import { Plugin } from './Plugin.ts';

/**
 * Obsidian Plugin Entry Point
 *
 * ARCHITECTURAL ROLE:
 * This is the smallest possible entry point. It exists because Obsidian's
 * plugin loader expects a default export of the Plugin class. We keep
 * all logic in `Plugin.ts` (and its dependencies) so that:
 *   1. The entry point is trivial and never needs to change
 *   2. `Plugin.ts` can be unit-tested independently of the module system
 *   3. SCSS is imported here so the build pipeline extracts it to styles.css
 *
 * NOTE: The `// eslint-disable-next-line` comment below is REQUIRED.
 * Obsidian's plugin infrastructure demands a default export, but our
 * ESLint config forbids them. The disable comment satisfies both constraints.
 */
// eslint-disable-next-line import-x/no-default-export -- Obsidian infrastructure requires a default export.
export default Plugin;
