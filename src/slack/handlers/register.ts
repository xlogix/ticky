import { App } from "@slack/bolt";
import { TodoStore } from "../../store";
import { TodoRuntime } from "../runtime";
import { registerTodoActions } from "./todo-actions";
import { registerTodoCommand } from "./todo-command";
import { registerTodoShortcuts } from "./todo-shortcuts";
import { registerTodoViews } from "./todo-views";

export function registerSlackHandlers(app: App, store: TodoStore, runtime: TodoRuntime): void {
  registerTodoCommand(app, store, runtime);
  registerTodoActions(app, store, runtime);
  registerTodoShortcuts(app, store);
  registerTodoViews(app, store, runtime);
}
