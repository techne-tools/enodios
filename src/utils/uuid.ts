/**
 * Generate a cryptographically secure random UUID v4.
 * Falls back to a simple random string if crypto.randomUUID is unavailable.
 *
 * WHY NOT Math.random() ALONE?
 * In browser environments, `crypto.randomUUID()` uses the operating system's
 * CSPRNG (Cryptographically Secure Pseudo-Random Number Generator), which
 * is suitable for IDs that may appear in URLs, audit logs, or DOM keys.
 * The Math.random() fallback is acceptable here because these IDs are
 * ephemeral (session-scoped) and not used for security tokens.
 */
export function generateMessageId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  // Fallback for environments without crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
