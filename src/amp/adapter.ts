import type {
  ExtensionContext,
  KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import type { InputStyleRuntime } from "../runtime";
import { EmptyComponent } from "../shared/empty-component";
import { AmpInputEditor } from "./editor";

export const ampStyle = {
  id: "amp" as const,
  label: "Amp-inspired",
  description: "Minimal chrome with timer, Git, cost, model, thinking, context use, and cwd",

  apply(ctx: ExtensionContext, runtime: InputStyleRuntime): void {
    ctx.ui.setHeader(() => new EmptyComponent());
    ctx.ui.setWorkingMessage();
    ctx.ui.setWorkingIndicator();
    ctx.ui.setWorkingVisible(true);

    ctx.ui.setEditorComponent((tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => {
      runtime.registerActiveTui(tui);
      return new AmpInputEditor(
        tui,
        theme,
        keybindings,
        ctx,
        () => runtime.getThinkingLevel(ctx),
        () => runtime.getAgentTimer(),
        () => runtime.currentGit(),
        ctx.ui.theme,
      );
    });

    ctx.ui.setFooter(() => new EmptyComponent());
  },
};
