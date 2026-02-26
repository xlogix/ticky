# Slack App Setup

You can configure manually in Slack UI or import `slack-manifest.yaml`.

## 1. Basic app settings

- App name: `Ticky`
- Description: `Mini Slack task manager for channels and DMs`

## 2. Add slash command

- Command: `/todo`
- Description: `Manage shared todos`
- Enable escape mode (`should_escape: true`) so mentions resolve correctly

Request URL rules:
- Socket Mode: not required
- HTTP Mode: `https://<your-host>/slack/events`

## 3. Add message shortcut

- Name: `Add message to Ticky`
- Type: Message shortcut
- Callback ID: `todo_add_message_as_task`

## 4. Bot token scopes

Add these bot scopes:
- `commands`
- `chat:write`
- `users:read`

Why `users:read` matters:
- Enables assignee resolution from plain `@name` input in commands.

## 5. Interactivity

Enable interactivity.

Request URL rules:
- Socket Mode: not required
- HTTP Mode: `https://<your-host>/slack/events`

## 6. Socket Mode (recommended local)

- Enable Socket Mode
- Create an app-level token with scope `connections:write`
- Put it in `SLACK_APP_TOKEN`

Suggested token label:
- `ticky-socket-mode-local`

## 7. Install and re-install

- Install app to workspace after initial setup
- Re-install app every time you change scopes, commands, or shortcuts

## 8. Channel usage

In channels, invite the bot before usage:

```text
/invite @Ticky
```

Without invite, posting can fail with `channel_not_found`.
