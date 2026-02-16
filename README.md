# Ticky

A mini task management Slack tool for channels and DMs.

## Features

- `/todo add` to create tasks in a DM or channel.
- `/todo list` to show tasks in an interactive list.
- `/todo between <@u1> <@u2>` to list tasks involving two people.
- Checkbox UI to mark tasks done directly in Slack.
- Optional completion updates (channel thread or creator DM).
- Settings modal (`/todo settings`) to configure update behavior.
- `Discuss` button to open/start a task-specific thread.

## Commands

- `/todo add <@user> <task>`
- `/todo add <task>`
- `/todo list [@user] [all]`
- `/todo between <@user1> <@user2> [all]`
- `/todo settings`
- `/todo help`

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
- `PORT` (optional)
- `STORE_PATH` (optional)

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
- `src/store.ts` JSON-backed persistence.
- `src/types.ts` shared types.

## Notes

- Data is stored in `data/store.json` by default.
- Task list messages and task cards are interactive and can be updated by checkboxes.
- Completion notifications are controlled per conversation in the settings modal.
