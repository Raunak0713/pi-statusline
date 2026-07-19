import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  getAgentDir,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

// ── Data types ──────────────────────────────────────────────────────────────

interface ModelStats {
  inputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
}

interface ModelRow extends ModelStats {
  model: string;
}

interface CostTable {
  rows: ModelRow[];
  grandTotal: ModelRow;
}

// ── Session scanning ────────────────────────────────────────────────────────

function* walkSessionFiles(): Generator<string> {
  const sessionsDir = join(getAgentDir(), "sessions");

  let projectDirs: string[];
  try {
    projectDirs = readdirSync(sessionsDir);
  } catch {
    return;
  }

  for (const projectDir of projectDirs) {
    const projectPath = join(sessionsDir, projectDir);
    let files: string[];
    try {
      if (!statSync(projectPath).isDirectory()) continue;
      files = readdirSync(projectPath);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      yield join(projectPath, file);
    }
  }
}

// ── Cost table builder ──────────────────────────────────────────────────────

function buildCostTable(): CostTable {
  const modelMap = new Map<string, ModelStats>();

  for (const filePath of walkSessionFiles()) {
    try {
      const content = readFileSync(filePath, "utf-8");
      const lines = content.trim().split("\n");

      for (const line of lines) {
        if (!line.trim()) continue;

        let entry: any;
        try {
          entry = JSON.parse(line);
        } catch {
          continue;
        }
        if (!entry || typeof entry !== "object") continue;

        if (entry.type === "message" && entry.message?.role === "assistant") {
          const msg = entry.message;
          const usage = msg.usage;
          if (!usage || typeof usage !== "object") continue;

          const modelId = msg.model || "unknown";
          const provider = msg.provider || "?";
          const modelKey = `${provider}/${modelId}`;

          let stats = modelMap.get(modelKey);
          if (!stats) {
            stats = {
              inputTokens: 0,
              cacheRead: 0,
              cacheWrite: 0,
              outputTokens: 0,
              totalTokens: 0,
              cost: 0,
            };
            modelMap.set(modelKey, stats);
          }

          stats.inputTokens += usage.input ?? 0;
          stats.cacheRead += usage.cacheRead ?? 0;
          stats.cacheWrite += usage.cacheWrite ?? 0;
          stats.outputTokens += usage.output ?? 0;
          stats.totalTokens += usage.totalTokens ?? ((usage.input ?? 0) + (usage.output ?? 0));
          stats.cost += usage.cost?.total ?? 0;
        }
      }
    } catch {
      // skip unreadable files
    }
  }

  const rows: ModelRow[] = Array.from(modelMap.entries())
    .map(([model, stats]) => ({ model, ...stats }))
    .sort((a, b) => b.cost - a.cost);

  const grandTotal = rows.reduce(
    (acc, row) => {
      acc.inputTokens += row.inputTokens;
      acc.cacheRead += row.cacheRead;
      acc.cacheWrite += row.cacheWrite;
      acc.outputTokens += row.outputTokens;
      acc.totalTokens += row.totalTokens;
      acc.cost += row.cost;
      return acc;
    },
    { inputTokens: 0, cacheRead: 0, cacheWrite: 0, outputTokens: 0, totalTokens: 0, cost: 0 } satisfies ModelStats,
  );

  return { rows, grandTotal: { model: "TOTAL", ...grandTotal } };
}

// ── Table rendering ─────────────────────────────────────────────────────────

function renderTable(table: CostTable): string[] {
  const lines: string[] = [];

  if (table.rows.length === 0) {
    return [" No session data found yet. Start chatting with pi!"];
  }

  const cols = [
    { w: 22, h: "Model" },
    { w: 14, h: "Input Tokens" },
    { w: 14, h: "Cached Tokens" },
    { w: 16, h: "Uncached Tokens" },
    { w: 10, h: "Cache %" },
    { w: 16, h: "Output Tokens" },
    { w: 10, h: "Cost" },
    { w: 14, h: "Total Tokens" },
  ] as const;

  const bar = (w: number) => "─".repeat(w);
  const top = `╭${cols.map(({ w }) => bar(w)).join("┬")}╮`;
  const sep = `├${cols.map(({ w }) => bar(w)).join("┼")}┤`;
  const bot = `╰${cols.map(({ w }) => bar(w)).join("┴")}╯`;

  const fmtNum = (n: number) => n.toLocaleString("en-US");
  const fmtCost = (n: number) => {
    if (n >= 100) return `$${Math.floor(n)}`;
    return `$${(Math.floor(n * 100) / 100).toFixed(2)}`;
  };

  const center = (s: string, w: number): string => {
    const pad = w - s.length;
    if (pad <= 0) return s.slice(0, w);
    return " ".repeat(Math.floor(pad / 2)) + s + " ".repeat(Math.ceil(pad / 2));
  };

  const renderRow = (model: string, inp: number, cached: number, out: number, cost: number, total: number) => {
    const totalInput = inp + cached;
    const cachePct = totalInput > 0 ? (cached / totalInput) * 100 : 0;

    return `│${[
      center(model, cols[0].w),
      center(fmtNum(totalInput), cols[1].w),
      center(fmtNum(cached), cols[2].w),
      center(fmtNum(inp), cols[3].w),
      center(cachePct > 0 ? cachePct.toFixed(1) + "%" : "—", cols[4].w),
      center(fmtNum(out), cols[5].w),
      center(fmtCost(cost), cols[6].w),
      center(fmtNum(total), cols[7].w),
    ].join("│")}│`;
  };

  lines.push(top);
  lines.push(`│${cols.map(({ w, h }) => center(h, w)).join("│")}│`);
  lines.push(sep);

  for (let i = 0; i < table.rows.length; i++) {
    const r = table.rows[i];
    const modelName = (r.model.split("/").pop() || r.model)
      .split("-").map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(" ");
    const shortModel = modelName.length > 20 ? modelName.slice(0, 18) + "…" : modelName;
    lines.push(renderRow(shortModel, r.inputTokens, r.cacheRead, r.outputTokens, r.cost, r.totalTokens));
    if (i < table.rows.length - 1) {
      lines.push(sep);
    }
  }

  lines.push(sep);
  lines.push(renderRow(" TOTAL", table.grandTotal.inputTokens, table.grandTotal.cacheRead, table.grandTotal.outputTokens, table.grandTotal.cost, table.grandTotal.totalTokens));
  lines.push(bot);
  lines.push("");  // bottom margin from the editor

  return lines;
}

// ── Public API ──────────────────────────────────────────────────────────────

/** Track whether the cost table widget has been dismissed */
let costWidgetDismissed = false;

function dismissCostWidget(ctx: ExtensionContext): void {
  if (costWidgetDismissed) return;
  costWidgetDismissed = true;
  ctx.ui.setWidget("cost-table", () => ({
    render: () => [],
    invalidate: () => {},
  }));
}

export function registerCostCommand(pi: ExtensionAPI): void {
  // Auto-dismiss the cost widget when user types something
  pi.on("input", (_event, ctx) => {
    dismissCostWidget(ctx);
  });

  pi.registerCommand("cost", {
    description: "Show cost breakdown across all sessions",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/cost requires TUI mode", "error");
        return;
      }

      const table = buildCostTable();
      const lines = renderTable(table);

      if (lines.length === 0) {
        ctx.ui.notify("No session data found.", "info");
        return;
      }

      // Reset dismiss flag and show widget
      costWidgetDismissed = false;
      ctx.ui.setWidget("cost-table", (_tui, _theme) => ({
        render: () => lines,
        invalidate: () => {},
      }));
      ctx.ui.notify("Type anything to dismiss the cost table", "info");
    },
  });
}
