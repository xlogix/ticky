# Ticky

A mini task management Slack tool for channels and DMs.

## Features

- `/todo add` to create tasks in a DM or channel.
- By default, new tasks are unassigned unless you explicitly choose/mention an assignee.
- `/todo list` to show tasks in an interactive list.
- `/todo between <@u1> <@u2>` to list tasks involving two people.
- Refreshed task board UI with status badges and action buttons.
- `Edit` button to update task title, assignee, and status in a modal.
- Message shortcut (`Add message to Ticky`) to convert DM/channel messages into tasks.
- `Mark Done` / `Reopen` actions directly in Slack.
- Optional completion updates (channel thread or creator DM).
- Settings modal (`/todo settings`) to configure update behavior.
- `Discuss` button to open/start a task-specific thread.

## Commands

- `/todo add <@user> <task>`
- `/todo add <task>`
- Note: for assignee resolution, pick the user from Slack mention autocomplete.
- `/todo list [@user] [all]`
- `/todo between <@user1> <@user2> [all]`
- `/todo settings`
- `/todo help`
- Message shortcut: `Add message to Ticky`

## Local setup

1. Install dependencies:

```bash
pnpm install
```

1. Configure environment:

```bash
cp .env.example .env
```

1. Fill `.env` values:

- `SLACK_BOT_TOKEN`
- `SLACK_SIGNING_SECRET`
- `SLACK_APP_TOKEN` (required for Socket Mode, optional for HTTP mode)
- `MONGODB_URI` (recommended primary persistence backend)
- `MONGODB_DB_NAME` (optional database name override)
- `PORT` (optional)
- `STORE_PATH` (optional fallback file store)

1. Run in dev mode:

```bash
pnpm dev
```

1. Run quality checks:

```bash
pnpm lint
pnpm format:check
pnpm check
pnpm build
```

## Slack app configuration

Create a Slack app and enable:

1. **Slash Commands**

- Command: `/todo`
- Escape channels, users, and links sent to your app: enabled (`should_escape: true`).
- Request URL: required only for HTTP mode.

1. **Interactivity & Shortcuts**

- Enable Interactivity.
- Request URL: required only for HTTP mode.
- Add a Message Shortcut with callback id `todo_add_message_as_task` (manifest already includes it).

1. **OAuth Scopes (Bot Token)**

- `commands`
- `chat:write`

1. **Socket Mode**

- Enable Socket Mode and generate an app-level token with `connections:write` scope.
- Put that token into `SLACK_APP_TOKEN`.

1. Install the app to your workspace.
2. Invite the bot user into channels where it should post: `/invite @Ticky`.
3. Optional: import `slack-manifest.yaml` to prefill app config.

## Runtime modes

- **Socket Mode**: set `SLACK_APP_TOKEN` and run `pnpm dev` (recommended for local development).
- **HTTP Mode**: leave `SLACK_APP_TOKEN` empty, expose your app URL publicly, and set Slash Command + Interactivity Request URLs to `https://<your-host>/slack/events`.

## Project structure

- `src/index.ts` Slack command + action handlers.
- `src/blocks.ts` Block Kit UI builders.
- `src/store.ts` MongoDB-first persistence with file fallback.
- `src/types.ts` shared types.

## Notes

- Primary persistence is MongoDB (`MONGODB_URI`), with automatic fallback to `STORE_PATH` if unavailable.
- Legacy key `MONGODB` is still accepted for compatibility but should be renamed to `MONGODB_URI`.
- Existing file data is auto-migrated into MongoDB on first successful DB connection when collections are empty.
- Task list messages and task cards are interactive and support edit + status actions.
- Tasks now persist richer metadata for future roadmap features (scope, source, recurrence placeholders).
- User activity/profile data is persisted for future features (preferences, analytics, scheduling).
- Completion notifications are controlled per conversation in the settings modal.
