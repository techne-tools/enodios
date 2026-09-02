/**
 * Test mock for `obsidian-dev-utils/obsidian/Modals`.
 *
 * The real module's ESM bundle imports `obsidian` directly, which vitest
 * cannot resolve inside pnpm's store (obsidian is a peer dependency of
 * obsidian-dev-utils, not a regular dependency). Tests only need the confirm
 * helper to resolve; individual tests can stub the result via
 * `vi.mocked(Confirm.confirm)`.
 */
import { vi } from "vitest";

export const Confirm = {
  confirm: vi.fn(async (): Promise<boolean> => true),
};
