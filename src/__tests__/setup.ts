/**
 * Vitest setup shim.
 *
 * The plugin's source targets Obsidian's DOM environment (window.setTimeout,
 * window.confirm, etc.). Vitest runs with `environment: "node"`, so `window`
 * is undefined in tests. This shim aliases `window` to `globalThis`, which
 * carries Node's timer implementations (setTimeout/clearTimeout/...), giving
 * the source code the `window.<timer>` globals it expects.
 *
 * A few tests spy on `window.dispatchEvent` (e.g. slash-command template
 * dispatch). Node's globalThis does not expose dispatchEvent, so a no-op is
 * provided for those spies to attach to.
 */
(globalThis as { window?: unknown }).window ??= globalThis;
if (!(globalThis as { dispatchEvent?: unknown }).dispatchEvent) {
  (globalThis as unknown as { dispatchEvent: () => boolean }).dispatchEvent =
    () => true;
}
