# Configuration

Ticky reads configuration from environment variables.

## Required variables

- `SLACK_BOT_TOKEN`
- `SLACK_SIGNING_SECRET`

## Optional variables

- `SLACK_APP_TOKEN`
  - Required for Socket Mode
  - App-level token must include `connections:write`
- `PORT`
  - Default: `46731`
- `MONGODB_URI`
  - Recommended primary persistence backend
- `MONGODB_DB_NAME`
  - Optional DB name override
- `STORE_PATH`
  - Fallback JSON store path (used when MongoDB is not configured/reachable)

## Backward-compatible variable

- `MONGODB` is still accepted for compatibility but deprecated.
- Prefer `MONGODB_URI`.

## Example

```env
########################################
# Slack App Credentials
########################################
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_APP_TOKEN=xapp-your-app-token

########################################
# Application Runtime
########################################
PORT=46731

########################################
# Persistence (Primary: MongoDB)
########################################
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/<database>?retryWrites=true&w=majority
MONGODB_DB_NAME=ticky

########################################
# Persistence (Fallback: Local JSON file)
########################################
STORE_PATH=./data/store.json
```
