import { App } from "@slack/bolt";
import dotenv from "dotenv";
import path from "node:path";
import { TodoStore } from "./store";
import { registerSlackHandlers } from "./slack/handlers/register";
import { TodoRuntime } from "./slack/runtime";

dotenv.config();

const botToken = process.env.SLACK_BOT_TOKEN;
const signingSecret = process.env.SLACK_SIGNING_SECRET;
const appToken = process.env.SLACK_APP_TOKEN;
const mongoUri = process.env.MONGODB_URI ?? process.env.MONGODB;
const mongoDbName = process.env.MONGODB_DB_NAME;

if (!botToken || !signingSecret) {
  throw new Error("SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET are required.");
}

const storePath = path.resolve(process.cwd(), process.env.STORE_PATH ?? "data/store.json");
const store = new TodoStore({
  filePath: storePath,
  mongoUri,
  mongoDbName,
});

if (process.env.MONGODB && !process.env.MONGODB_URI) {
  console.warn("[config] MONGODB is deprecated. Please rename it to MONGODB_URI.");
}

const app = new App({
  token: botToken,
  signingSecret,
  socketMode: Boolean(appToken),
  ...(appToken ? { appToken } : {}),
});

const runtime = new TodoRuntime(store);
registerSlackHandlers(app, store, runtime);

app.error(async (error) => {
  console.error("Slack app error", error);
});

async function main(): Promise<void> {
  await store.init();

  const port = Number(process.env.PORT ?? 46731);
  await app.start(port);

  const mode = appToken ? "Socket Mode" : "HTTP Mode";
  const localUrl = `http://localhost:${port}`;
  console.log(`Ticky running on ${mode} (port ${port})`);
  console.log(`Local URL: ${localUrl}`);
  console.log(`Slack Events URL: ${localUrl}/slack/events`);
  if (appToken) {
    console.log("Socket Mode is enabled, so Slack does not need the Events URL.");
  }
}

main().catch((error) => {
  console.error("Application startup failed", error);
  process.exit(1);
});
