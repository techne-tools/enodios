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

/**
 * Obsidian patches `HTMLElement.prototype` at runtime with helper methods
 * (`setCssStyles`, `setCssProps`, ... — see obsidian-typings, @official).
 * jsdom never runs those patches, so tests exercising code paths that use
 * them fail with "setCssStyles is not a function" exactly where the real
 * app succeeds. Mirror the runtime patching here so tests behave like
 * Obsidian. Guarded because this setup file also runs under
 * `environment: "node"` where `HTMLElement` does not exist.
 */
if (typeof HTMLElement !== "undefined") {
  const proto = HTMLElement.prototype as HTMLElement & {
    setCssStyles?: (styles: Record<string, string>) => void;
    setCssProps?: (props: Record<string, string>) => void;
  };
  if (!proto.setCssStyles) {
    proto.setCssStyles = function (styles: Record<string, string>): void {
      const style = (this as HTMLElement).style;
      for (const [key, value] of Object.entries(styles)) {
        (style as unknown as Record<string, string>)[key] = value;
      }
    };
  }
  if (!proto.setCssProps) {
    proto.setCssProps = function (props: Record<string, string>): void {
      const style = (this as HTMLElement).style;
      for (const [key, value] of Object.entries(props)) {
        style.setProperty(key, value);
      }
    };
  }
}
