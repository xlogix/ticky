# Development Guide

## Scripts

- `pnpm dev` - run in watch mode with `tsx`
- `pnpm lint` - run ESLint
- `pnpm lint:fix` - auto-fix lint issues
- `pnpm format` - run Prettier write
- `pnpm format:check` - check formatting
- `pnpm check` - TypeScript typecheck
- `pnpm test` - run unit tests with coverage
- `pnpm test:watch` - run tests in watch mode
- `pnpm build` - compile to `dist/`
- `pnpm start` - run compiled app

## Project structure (high-level)

- `src/index.ts` bootstrap
- `src/slack/handlers/*` Slack entrypoints
- `src/slack/runtime.ts` shared runtime behavior
- `src/blocks.ts` Block Kit UI builders
- `src/store.ts` persistence layer
- `src/types.ts` domain types
- `src/tasks/*` parsing/id helper utilities
- `src/slack/assignee-resolver.ts` assignee parsing + directory lookup

## Recommended change workflow

1. Make code changes in focused modules.
2. Run `pnpm lint`.
3. Run `pnpm check`.
4. Run `pnpm test`.
5. Run `pnpm build`.
6. Test behavior in Slack workspace.

## Working with Slack safely

- Re-install app after changing scopes/commands/shortcuts.
- Prefer Socket Mode for local development.
- Keep `.env` values local; never commit secrets.
