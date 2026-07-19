import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import {
  emptyGitStatus,
  parseGitStatus,
  sameGitStatus,
  type GitStatusSummary,
} from "./amp/git-status";
import { getThinkingLevel } from "./shared/editor-meta";

const TIMER_INTERVAL_MS = 1_000;
const GIT_TIMEOUT_MS = 5_000;

export interface AgentTimerState {
  seconds: number;
  active: boolean;
}

export interface InputStyleRuntime {
  currentGit(): GitStatusSummary;
  getAgentTimer(): AgentTimerState | undefined;
  getThinkingLevel(ctx: ExtensionContext): string;
  registerActiveTui(tui: TUI | undefined): void;
  requestRender(): void;
}

export class InputStyleRuntimeController implements InputStyleRuntime {
  private readonly pi: ExtensionAPI;
  private activeTui: TUI | undefined;
  private cachedThinkingLevel: string | undefined;
  private gitStatus = emptyGitStatus();
  private gitRefreshGeneration = 0;
  private agentStartedAt: number | undefined;
  private lastAgentDurationSeconds: number | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(pi: ExtensionAPI) {
    this.pi = pi;
  }

  currentGit(): GitStatusSummary {
    return this.gitStatus;
  }

  getAgentTimer(): AgentTimerState | undefined {
    if (this.agentStartedAt !== undefined) {
      return { seconds: this.activeAgentElapsedSeconds(), active: true };
    }

    return this.lastAgentDurationSeconds === undefined
      ? undefined
      : { seconds: this.lastAgentDurationSeconds, active: false };
  }

  getThinkingLevel(ctx: ExtensionContext): string {
    return this.cachedThinkingLevel ?? getThinkingLevel(ctx);
  }

  registerActiveTui(tui: TUI | undefined): void {
    this.activeTui = tui;
  }

  refreshThinkingLevel(ctx: ExtensionContext): void {
    this.cachedThinkingLevel = getThinkingLevel(ctx);
  }

  refreshThinkingLevelAndRender(ctx: ExtensionContext): void {
    this.refreshThinkingLevel(ctx);
    this.requestRender();
  }

  startAgentTimer(): void {
    if (this.agentStartedAt !== undefined) return;

    this.lastAgentDurationSeconds = undefined;
    this.agentStartedAt = Date.now();
    this.timer = setInterval(() => this.requestRender(), TIMER_INTERVAL_MS);
    this.timer.unref?.();
    this.requestRender();
  }

  handleAgentSettled(ctx: ExtensionContext): void {
    this.stopAgentTimer();
    this.refreshGit(ctx.cwd);
  }

  requestRender(): void {
    this.activeTui?.requestRender();
  }

  shutdown(): void {
    this.stopAgentTimer(false);
    this.gitRefreshGeneration += 1;
    this.gitStatus = emptyGitStatus();
    this.activeTui = undefined;
    this.cachedThinkingLevel = undefined;
    this.lastAgentDurationSeconds = undefined;
  }

  refreshGit(cwd: string): void {
    const generation = ++this.gitRefreshGeneration;

    this.pi.exec(
      "git",
      ["status", "--porcelain=2", "--branch"],
      { timeout: GIT_TIMEOUT_MS },
    ).then((result) => {
      if (generation !== this.gitRefreshGeneration) return;

      const next = result.code === 0 ? parseGitStatus(result.stdout) : emptyGitStatus();
      if (sameGitStatus(this.gitStatus, next)) return;

      this.gitStatus = next;
      this.requestRender();
    }).catch(() => {
      if (generation !== this.gitRefreshGeneration) return;
      if (sameGitStatus(this.gitStatus, emptyGitStatus())) return;

      this.gitStatus = emptyGitStatus();
      this.requestRender();
    });
  }

  private activeAgentElapsedSeconds(): number {
    if (this.agentStartedAt === undefined) return 0;
    return Math.max(0, Math.floor((Date.now() - this.agentStartedAt) / TIMER_INTERVAL_MS));
  }

  private stopAgentTimer(render = true): void {
    const wasRunning = this.agentStartedAt !== undefined;
    if (wasRunning) this.lastAgentDurationSeconds = this.activeAgentElapsedSeconds();

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.agentStartedAt = undefined;
    if (render && wasRunning) this.requestRender();
  }
}
