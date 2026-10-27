# Getting Started

## Prerequisites

- Node.js 22.13+ (pnpm 11 needs it)
- pnpm 11+
- A Slack workspace where you can create/install apps
- MongoDB connection (recommended), or local file persistence fallback

## Installation

```bash
pnpm install
cp .env.example .env
```

Fill `.env` values before starting.

## Start in development mode

```bash
pnpm dev
```

By default, the app runs at:
- `http://localhost:46731`
- Events endpoint (HTTP mode): `http://localhost:46731/slack/events`

## Quality checks

```bash
pnpm lint
pnpm format:check
pnpm check
pnpm build
```

## Runtime modes

1. Socket Mode (recommended for local)
- Set `SLACK_APP_TOKEN`
- No public request URL required for Events/Interactivity

2. HTTP Mode
- Leave `SLACK_APP_TOKEN` empty
- Expose your app publicly (for example via tunnel)
- Set Slack Request URL(s) to `https://<public-host>/slack/events`
