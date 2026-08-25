import {
  existsSync,
  readdirSync
} from 'fs';
import { homedir } from 'os';
import { join } from 'path';

/**
 * Enumerates the Hermes profiles available on this machine.
 *
 * WHY THIS EXISTS:
 * The "Hermes Profile" dropdown must list the profiles Hermes actually knows
 * about — the ones created via `hermes profile` — not the plugin's persona
 * templates. Personas (system prompts + tool restrictions) and profiles
 * (CLI scoping via `hermes -p <name> acp`) are different concepts; wiring
 * the dropdown to personas made it offer 'coding'/'writing'/'research',
 * which are not profiles, and spawning `hermes -p coding acp` would fail.
 *
 * Hermes stores profiles as directories under HERMES_HOME/profiles/ (default
 * HERMES_HOME is ~/.hermes). The 'default' profile is the home config itself
 * and is always available, even though it has no directory of its own.
 *
 * This mirrors how the plugin already resolves the hermes binary: it reads
 * the filesystem rather than shelling out, because `hermes profile list`
 * has no machine-readable (--json) output.
 */
export function listProfiles(hermesHome?: string): string[] {
  const home = hermesHome ?? process.env['HERMES_HOME'] ?? join(homedir(), '.hermes');
  const profilesDir = join(home, 'profiles');

  const profiles = new Set<string>(['default']);

  if (existsSync(profilesDir)) {
    for (const entry of readdirSync(profilesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue;
      profiles.add(entry.name);
    }
  }

  return [...profiles].sort((a, b) => {
    // 'default' always first; the rest alphabetical.
    if (a === 'default') return -1;
    if (b === 'default') return 1;
    return a.localeCompare(b);
  });
}
