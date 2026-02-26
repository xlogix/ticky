# Architecture

## Layered structure

1. Composition root
- `src/index.ts`
- Loads env/config, initializes store/runtime, registers handlers, starts Slack app.

2. Slack interface layer
- `src/slack/handlers/todo-command.ts`
- `src/slack/handlers/todo-actions.ts`
- `src/slack/handlers/todo-views.ts`
- `src/slack/handlers/todo-shortcuts.ts`
- Handles Slack payloads and responses.

3. Runtime/application service layer
- `src/slack/runtime.ts`
- Shared operational behavior used by handlers (post, sync, notify, settings modal open).

4. Domain helpers/parsers
- `src/slack/assignee-resolver.ts`
- `src/tasks/input-parser.ts`
- `src/tasks/id-helpers.ts`
- `src/app/todo-behavior.ts`

5. Persistence + model
- `src/store.ts`
- `src/types.ts`

6. UI composition
- `src/blocks.ts`
- Block Kit builders for cards, boards, and modals.

## Why this is appropriate

- Keeps Slack transport details away from persistence logic.
- Keeps shared behavior centralized in one runtime service.
- Allows feature growth by adding focused modules instead of growing a single monolith file.

## Extension guidelines

1. Add new slash subcommands in `todo-command.ts`.
2. Keep reusable logic in `runtime.ts` or dedicated helper/service modules.
3. Keep Slack block composition in `blocks.ts`.
4. Keep DB access in `store.ts` only.
5. Extend `types.ts` first when adding new domain fields.

## Next architectural step

For repeating tasks/reminders, introduce application services under `src/tasks/services/` and migrate task lifecycle rules out of handlers.
