# Troubleshooting

## Slash command does not appear in Slack

Checklist:
1. Slash command `/todo` is created in app settings.
2. App installed (or re-installed) after command/scopes changes.
3. In channels, bot invited via `/invite @Ticky`.
4. `commands` scope is present.

## `dispatch_failed` when running `/todo`

Common causes:
- App is not running
- Invalid token/signing secret in `.env`
- Slack app not installed/re-installed after changes
- Command exists but backend not reachable in HTTP mode

Actions:
1. Start app with `pnpm dev`.
2. Verify env values.
3. Re-install app in Slack.
4. If HTTP mode, verify public Request URL points to `/slack/events`.

## `channel_not_found` in logs

Typical cause:
- Bot is not in that channel, or posting context is invalid.

Fix:
- Invite bot to channel.
- For DMs, use the conversation where Ticky is installed/available.

## `/todo add @user <task>` did not assign

Checklist:
1. Use Slack mention autocomplete (not plain text names).
2. Ensure `users:read` scope is added.
3. Re-install app after adding scopes.

## No logs appear

- Confirm app process is actually running.
- Run with `pnpm dev` in active terminal.
- Ensure no silent crash at startup due to missing env vars.

## Message shortcut not visible

Checklist:
1. Message shortcut callback id is `todo_add_message_as_task`.
2. Interactivity is enabled.
3. App re-installed after shortcut changes.

## Data disappears after restart

- Configure `MONGODB_URI` to use persistent DB.
- If using file mode, confirm `STORE_PATH` points to stable writable location.
