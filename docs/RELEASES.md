# Release Process

This document explains how to create and manage releases for the Obsidian Hermes plugin.

## v0.4.1-beta1 — 10 June 2026

### Improvements

- **Tool activity is always visible** — Even with the "Show Tool Use" setting turned off, compact status indicators (`⚙️ tool running...` → `✅ tool completed`) now appear so you always know when the agent is working.

### Bug Fixes

- **Fixed the agent claiming permission was denied** when you actually clicked Allow — the agent's tool execution context was being silently dropped from conversation history. Now every tool call is tracked in the chat, so the agent can accurately see what happened.
- **Permission options now show all choices** — The approval bubble correctly displays every option Hermes provides: "Allow once", "Allow for session", "Allow always", "Deny", and "Deny always".
- **Removed duplicate "Deny" button** — The permission UI no longer has a redundant deny button since Hermes already sends one.

---

## 🧪 Private Beta Releases

Private beta releases are **manually triggered** via GitHub Actions. They are marked as `prerelease` on GitHub and are intended for a small group of testers.

### How to Create a Private Beta Release

1. Go to **Actions → Private Beta Release → Run workflow**.
2. Fill in the required fields:
   - **Version**: Use semantic versioning with a beta suffix, e.g., `0.3.0-beta.1`, `0.3.0-beta.2`.
   - **Minimum Obsidian App Version**: The lowest Obsidian version that can run this plugin. Check `versions.json` for the current value.
   - **Release Notes**: A short markdown description of what's new, changed, or fixed in this beta.
3. Click **Run workflow**.

The workflow will:
- Run lint, tests, and build
- Update `manifest.json` and `versions.json`
- Commit the version bump
- Create a GitHub Release with the `prerelease` flag

### How Beta Testers Install

Beta testers should use the **BRAT plugin**:

1. Install [BRAT](https://obsidian.md/plugins?id=obsidian42-brat) from Obsidian's Community Plugins.
2. Open **Settings → BRAT → Add Beta plugin**.
3. Paste the repository URL: `https://github.com/prismatic7/obsidian-hermes`
4. Enable Hermes in **Settings → Community Plugins**.

BRAT will automatically check for new beta releases and prompt to update.

---

## 🌙 Nightly Builds

Nightly builds are **fully automated** and run every day at 06:00 UTC (or on demand). They represent the latest state of the `main` branch.

### How to Trigger a Nightly Build

1. Go to **Actions → Nightly Build → Run workflow**.
2. Click **Run workflow**.

The workflow will:
- Run lint, tests, and build
- Create (or overwrite) the `nightly` tag and release

### How Testers Install Nightlies

Same process as beta releases — use BRAT with the repository URL. The `nightly` tag is always the latest bleeding-edge build.

---

## 🚀 Public Release (Future)

When the plugin is ready for the Obsidian Community Plugins directory:

1. Update the version in `manifest.json` to a stable version (no `-beta` suffix).
2. Run the **Private Beta Release** workflow with the stable version.
3. Uncheck the `prerelease` box (or create the release manually).
4. Submit to [Obsidian Community Plugins](https://github.com/obsidianmd/obsidian-releases).

---

## 📋 Version Files

| File | Purpose |
|------|---------|
| `manifest.json` | Current plugin version and metadata. Updated on every release. |
| `versions.json` | Maps plugin versions to minimum Obsidian app versions. Updated on every release. |
| `package.json` | Node.js dependencies and scripts. **Not** used by Obsidian at runtime. |

---

## 🔒 Repository Privacy

This repository is **private** during the beta period. Only invited collaborators can:
- View the code
- Open issues and pull requests
- Download releases

When ready for public release, the repository will be made public and the plugin submitted to the Obsidian Community Plugins directory.
