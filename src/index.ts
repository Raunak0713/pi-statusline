import type {
  ExtensionAPI,
  KeybindingsManager,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { EmptyComponent } from "./shared/empty-component";
import { ampStyle } from "./amp/adapter";
import { InputStyleRuntimeController } from "./runtime";
import { loadInputStyleConfig, saveInputStyleConfig } from "./config";
import installStickyInput from "./sticky/install-sticky-input";
import { registerCostCommand } from "./cost";

export default function (pi: ExtensionAPI) {
  const runtime = new InputStyleRuntimeController(pi);
  const stickyInput = installStickyInput(pi, {
    isEnabled: () => loadInputStyleConfig().stickyInput,
  });

  // ---- Commands ----

  registerCostCommand(pi);

  pi.registerCommand("input-style", {
    description: "Toggle sticky input",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/input-style requires TUI mode", "error");
        return;
      }

      const config = loadInputStyleConfig();
      const newSticky = !config.stickyInput;
      config.stickyInput = newSticky;

      try {
        saveInputStyleConfig(config);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Failed to save settings: ${message}`, "error");
        return;
      }

      stickyInput.setEnabled(ctx, newSticky);
      ctx.ui.notify(`Sticky input: ${newSticky ? "on" : "off"}`, "info");
    },
  });

  // ---- Session lifecycle ----

  pi.on("session_start", (_event, ctx) => {
    runtime.refreshThinkingLevel(ctx);
    if (ctx.mode !== "tui") return;

    ampStyle.apply(ctx, runtime);
  });

  pi.on("session_shutdown", () => {
    runtime.shutdown();
  });

  // ---- Agent lifecycle ----

  pi.on("agent_start", () => {
    runtime.startAgentTimer();
  });

  pi.on("agent_settled", (_event, ctx) => {
    runtime.handleAgentSettled(ctx);
  });

  // ---- Model & thinking level ----

  pi.on("model_select", (_event, ctx) => {
    runtime.refreshThinkingLevelAndRender(ctx);
  });

  pi.on("thinking_level_select", (_event, ctx) => {
    runtime.refreshThinkingLevelAndRender(ctx);
  });

  // ---- Session changes ----

  pi.on("message_end", () => {
    runtime.requestRender();
  });

  pi.on("session_tree", (_event, ctx) => {
    runtime.refreshThinkingLevelAndRender(ctx);
  });

  pi.on("session_compact", (_event, ctx) => {
    runtime.refreshThinkingLevelAndRender(ctx);
  });
}
