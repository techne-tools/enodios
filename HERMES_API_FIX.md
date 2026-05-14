# Hermes API Integration Fix

## Problem

The plugin was using incorrect API endpoints that don't exist in the Hermes Agent API:

1. **Incorrect endpoints used:**
   - `/health` (should be `/health` or `/v1/health`)
   - `/sessions` (doesn't exist)
   - `/chat` (doesn't exist)
   - Custom session management (not needed)

2. **Missing API endpoints:**
   - `/v1/chat/completions` (OpenAI-compatible)
   - `/v1/responses` (for server-side session management)

## Solution

### 1. Updated HermesAPI.ts

**Key changes:**
- Removed custom session management endpoints (`/sessions`, `/sessions/{id}`, etc.)
- Added `/v1/chat/completions` endpoint for OpenAI-compatible chat
- Added `/v1/responses` endpoint for server-side session management
- Fixed health check to try both `/health` and `/v1/health`
- Updated request/response interfaces to match Hermes API format

**New API methods:**
- `sendMessage(messages, model?, stream?)` - Uses `/v1/chat/completions`
- `sendMessageWithResponseAPI(input, previousResponseId?, conversation?, instructions?)` - Uses `/v1/responses`

### 2. Updated HermesChatView.tsx

**Key changes:**
- Removed session management logic
- Simplified to use server-side session management via `/v1/responses`
- Removed unused imports and variables
- Updated to use new API methods

### 3. Updated PluginSettings.ts

**Added missing settings:**
- `chatShowTitle` - Show title in chat UI
- `chatShowTopic` - Show topic in chat UI
- `chatAutoScroll` - Auto-scroll chat
- `chatMarkdownRender` - Render markdown in chat

## API Endpoints (from Hermes Documentation)

### Health Check
- `GET /health` - Basic health check
- `GET /v1/health` - OpenAI-compatible health check

### Chat Completions (OpenAI-compatible)
- `POST /v1/chat/completions`
- Request: `{ model, messages, stream }`
- Response: `{ id, object, created, model, choices, usage }`

### Responses API (server-side sessions)
- `POST /v1/responses`
- Request: `{ model, input, instructions, store, previous_response_id, conversation }`
- Response: `{ id, object, created, model, status, output, usage }`

## Configuration

To connect to Hermes Agent API:

1. **Enable API Server in Hermes:**
   Add to `~/.hermes/.env`:
   ```
   API_SERVER_ENABLED=true
   API_SERVER_KEY=your-api-key
   ```

2. **Start Hermes Gateway:**
   ```
   hermes gateway
   ```

3. **Configure Plugin Settings:**
   - API URL: `http://127.0.0.1:8642`
   - API Key: Your Hermes API key
   - Agent Name: `hermes-agent` (default)

## Testing

1. Open the Hermes Chat view in Obsidian
2. Type a message and press Send
3. Check the browser console for debug messages
4. Verify the connection by checking if messages are sent and responses received

## Next Steps

- Implement actual API calls to Hermes (currently using mock response)
- Add context extraction from editor
- Implement markdown rendering for responses
- Add session management UI
- Implement streaming responses
