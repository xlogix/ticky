# Persistence

Ticky uses MongoDB-first persistence with local file fallback.

## Storage modes

1. MongoDB mode
- Active when `MONGODB_URI` is configured and reachable.
- Collections:
  - `tasks`
  - `conversation_settings`
  - `users`

2. File mode (fallback)
- Active when MongoDB is missing/unreachable.
- File path from `STORE_PATH` (default `data/store.json`).

## Migration behavior

On successful MongoDB init, Ticky reads local store data and upserts records into MongoDB using insert-only semantics (`$setOnInsert`).

Implications:
- Existing Mongo records are not overwritten by local file data.
- Missing records from file store are merged into MongoDB.

## Data tracked

Tasks store:
- identity and metadata (`id`, `title`, `createdBy`, `assignee`)
- hierarchy (`parentTaskId`, `sortOrder`)
- scope and conversation context (`conversationId`, `conversationKind`, `scope`)
- lifecycle fields (`done`, `doneAt`, `doneBy`, timestamps)
- Slack linkage (`messageTs`, `discussionStartedAt`)
- future-ready fields (`recurrence`, `source`)

Conversation settings store:
- completion update on/off
- completion target (`channel` or `dm_creator`)

User profile store:
- first/last seen metadata
- last action/conversation
- activity stats (created/completed/assigned/edited)
- preferences placeholders for future features

## Reliability notes

- File persistence writes via temp-file then rename for safer atomic updates.
- Store operations are serialized through an internal async queue to avoid races.
