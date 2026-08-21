# Troubleshooting Guide

If you run into issues using the Obsidian Hermes plugin, consult this guide for common errors and their solutions.

## Connection Issues

### ❌ "ACP connection failed: spawn hermes ENOENT"
**Cause**: The plugin is trying to spawn the local Hermes subprocess, but cannot find the `hermes` binary in your system's PATH.
**Solution**:
1. Go to `Settings > Hermes`.
2. Under **Hermes Binary Path**, explicitly provide the absolute path to your executable (e.g., `/Users/yourname/.local/bin/hermes` or `C:\Users\yourname\AppData\Local\Programs\hermes\hermes.exe`).

### ❌ "ACP connection failed: Connection closed"
**Cause**: The Hermes subprocess crashed immediately upon startup.
**Solution**:
1. Try running `hermes doctor` in your system terminal to ensure your agent configuration is healthy.
2. Check the Obsidian DevTools console (`Cmd/Ctrl + Option + I`) for `[Hermes stderr]` logs to see exactly why the agent process exited.

### ❌ "Hermes API error 401: Unauthorized"
**Cause**: Your REST API key is missing or incorrect.
**Solution**:
1. Go to `Settings > Hermes`.
2. Switch Connection Mode to **API**.
3. Re-enter your API key and ensure the agent server is configured to accept it.

### ❌ "API key is not configured"
**Cause**: You are using API mode but have not set an API key.
**Solution**:
1. Go to `Settings > Hermes`.
2. Switch Connection Mode to **API**.
3. Enter your API key in the **API Key** field. The key is stored securely and never shown again after saving.

## Security & Permissions

### 🛑 "Tool execution rejected: 'createTerminal' is disabled"
**Cause**: Hermes attempted to run a terminal command, but terminal access is restricted.
**Solution**:
By default, terminal execution is disabled for security (as it bypasses the Obsidian File Diff approval UI). To enable it:
1. Go to `Settings > Hermes` and toggle on **Allow Terminal Access**.
2. Open the chat, click the **Session Tools** (wrench icon), and ensure `createTerminal` is checked for that specific chat session.

**Security Note**: Even when enabled, terminal commands are restricted to a safe allowlist (`cat`, `cp`, `curl`, `echo`, `find`, `git`, `grep`, `ls`, `mkdir`, `mv`, `rm`, `touch`, `wget`). Dangerous patterns (pipes, redirects, command substitution, option injection) are rejected.

### 🛑 "Path traversal denied"
**Cause**: The agent attempted to access a file outside the vault using `../`, an absolute path, or a Windows drive letter.
**Solution**: This is a security feature. The agent can only access files within your Obsidian vault. If you need the agent to work with files outside the vault, move them into the vault first.

### 🛑 "Disallowed shell command" or "Shell argument contains disallowed pattern"
**Cause**: The agent attempted to run a command not in the safe allowlist, or passed dangerous arguments (e.g., `-c`, `|`, `;`, `&&`).
**Solution**: This is a security feature. If you need to run a specific command, request it to be added to the allowlist in the plugin's GitHub issues. For complex operations, consider using the agent's file tools instead.

### 🛑 "Please wait a moment before sending another prompt"
**Cause**: You (or the agent) sent prompts too quickly. Both ACP and API modes enforce a 1-second rate limit to prevent accidental or malicious flooding.
**Solution**: Wait at least 1 second between prompt sends.

### 🛑 "MCP server rejected: ..."
**Cause**: An MCP server configured in settings failed security validation.
**Solution**: MCP servers must meet these requirements:
- Absolute path (no relative paths)
- Not in a temporary directory (`/tmp`, `/var/tmp`, `/dev/shm`, `/run`)
- Not world-writable
Check the audit log (`hermes/audit-log.md`) for the exact rejection reason.

## Features and UI

### 👻 Inline Ghost Text isn't showing up
**Cause**: The API might have timed out, or you moved your cursor before the agent finished generating the completion.
**Solution**: Ensure your cursor remains perfectly still after triggering the `Hermes: Trigger Inline Suggestion` command. If it still fails, check the Obsidian DevTools console for network errors reaching the `/v1/chat/completions` endpoint.

### 🔄 The Chat feels "Stuck" or out of sync
**Cause**: The underlying ACP stateful process may have gotten into a bad loop or lost context.
**Solution**: Click the **New Chat** icon or type `/clear` in the input box. This completely kills the local `hermes acp` process and spawns a fresh, clean instance with no memory of the previous errors.

### 📝 Expected File Changes aren't appearing in the Vault
**Cause**: Hermes successfully created the file change, but you haven't approved it.
**Solution**: Look for the **Pending Changes** panel just above the chat input box. Expand the diff to review the agent's work, and click **Approve** to write the data to your disk.

### ⏱️ "Please wait a moment before sending another command"
**Cause**: The command palette commands (Ask Selection, Summarize Note, Generate Tags) have a 2-second rate limit to prevent accidental spam.
**Solution**: Wait 2 seconds between command invocations. The chat input has its own separate rate limit indicator.

### 📤 Conversation export

Conversation export (HTML/JSON/Markdown) was removed in 0.4.1-beta1. Saved conversations live in your vault as plain markdown notes under the **Save Folder** — copy or re-purpose the note directly. If you rely on export, raise a feature request on GitHub.

### 🔊 Typing sounds aren't playing
**Cause**: Browser autoplay policies block AudioContext creation until user interaction.
**Solution**: Click anywhere in the Obsidian window first to establish audio context permission. The setting is off by default — enable it in `Settings > Hermes > Enable Typing Sound`.

### 📂 Conversations aren't organized into date folders
**Cause**: The conversation organization setting is set to `flat` (default).
**Solution**: Go to `Settings > Hermes` and change **Conversation Organization** to `by-date`. New conversations will be saved in `hermes/2026-05/` style subfolders. Existing conversations are not moved.

### 👻 Ghost text shows "...Hermes is thinking..." but never completes
**Cause**: The inline suggestion request timed out or the API returned an empty completion.
**Solution**: Ensure your cursor hasn't moved (ghost text clears on cursor movement). Check the DevTools console for API errors. If using ACP mode, ensure the subprocess is running.

### 🔄 Partial approval shows different lines than expected
**Cause**: The file on disk changed between when the diff was generated and when you clicked approve.
**Solution**: The diff is now snapshotted at registration time to prevent this race condition. If you still see discrepancies, reject the change and ask Hermes to regenerate it.

## Audit Log & Debugging

### 📋 Where is the audit log?
The audit log is stored at `hermes/audit-log.md` in your vault (or whatever folder you configured in **Save Folder**). It records every action the agent takes — file changes, tool calls, permissions, terminal commands, and connections.

**Security Note**: The audit log contains sensitive information (file paths, command arguments, API errors). Do not share it publicly or sync it to untrusted cloud services.

### 🔍 How do I view debug logs?
1. Open the Obsidian DevTools console (`Cmd/Ctrl + Option + I`)
2. Enable debug mode in `Settings > Hermes > Debug Mode`
3. Look for logs prefixed with `[Hermes]`

**Security Note**: Debug logs automatically redact Bearer tokens, API keys, and passwords, but may still contain sensitive file paths. Do not share debug output publicly.

## Still need help?
Enable verbose logging by opening the Obsidian DevTools console and running:
`window.DEBUG.enable('hermes');`
