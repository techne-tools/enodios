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

## Features and UI

### 🛑 "Tool execution rejected: 'createTerminal' is disabled"
**Cause**: Hermes attempted to run a terminal command, but terminal access is restricted.
**Solution**:
By default, terminal execution is disabled for security (as it bypasses the Obsidian File Diff approval UI). To enable it:
1. Go to `Settings > Hermes` and toggle on **Allow Terminal Access**.
2. Open the chat, click the **Session Tools** (wrench icon), and ensure `createTerminal` is checked for that specific chat session.

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

### 📤 Export fails with "Failed to export conversation"
**Cause**: An error occurred during HTML or JSON export generation.
**Solution**: Check the Obsidian DevTools console for the specific error. Common causes include extremely large conversations exceeding memory limits, or file system permission issues in your vault folder.

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

## Still need help?
Enable verbose logging by opening the Obsidian DevTools console and running:
`window.DEBUG.enable('hermes');`
