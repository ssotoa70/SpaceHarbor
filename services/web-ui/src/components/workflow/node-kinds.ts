/**
 * Workflow node kind metadata — labels, colors, default config templates.
 *
 * The 8 kinds match the engine's handler registry in
 * services/control-plane/src/workflow/engine.ts. Adding a new kind here
 * without registering an engine handler will let users author broken DSLs.
 */

export type NodeKind =
  | "start"
  | "end"
  | "approval"
  | "http"
  | "script"
  | "branch"
  | "wait_for_event"
  | "enqueue_job";

export interface NodeKindMeta {
  kind: NodeKind;
  label: string;
  // Tailwind class-fragment for the node card border/background tint.
  tone: "neutral" | "success" | "info" | "warning" | "danger" | "accent";
  // Default config emitted when the user adds a node of this kind.
  defaultConfig: () => Record<string, unknown> | undefined;
  // Whether the node may have outgoing edges. start/end/branch all do; end does not.
  allowsOutgoing: boolean;
  allowsIncoming: boolean;
  // Short caption shown under the kind label on the canvas card.
  describe: (config: Record<string, unknown> | undefined) => string;
}

export const NODE_KINDS: Record<NodeKind, NodeKindMeta> = {
  start: {
    kind: "start",
    label: "Start",
    tone: "success",
    defaultConfig: () => undefined,
    allowsOutgoing: true,
    allowsIncoming: false,
    describe: () => "entry point",
  },
  end: {
    kind: "end",
    label: "End",
    tone: "neutral",
    defaultConfig: () => undefined,
    allowsOutgoing: false,
    allowsIncoming: true,
    describe: () => "terminal",
  },
  approval: {
    kind: "approval",
    label: "Approval",
    tone: "warning",
    defaultConfig: () => ({ approvers: [] }),
    allowsOutgoing: true,
    allowsIncoming: true,
    describe: (c) => {
      const approvers = (c?.approvers as unknown[] | undefined) ?? [];
      return approvers.length === 0 ? "no approvers configured" : `${approvers.length} approver(s)`;
    },
  },
  http: {
    kind: "http",
    label: "HTTP Call",
    tone: "info",
    defaultConfig: () => ({ url: "", method: "POST" }),
    allowsOutgoing: true,
    allowsIncoming: true,
    describe: (c) => `${(c?.method as string) || "POST"} ${(c?.url as string) || "<url>"}`,
  },
  script: {
    kind: "script",
    label: "Script",
    tone: "accent",
    defaultConfig: () => ({ code: "" }),
    allowsOutgoing: true,
    allowsIncoming: true,
    describe: (c) => {
      const code = (c?.code as string) || "";
      return code ? `${code.slice(0, 40)}${code.length > 40 ? "…" : ""}` : "no code";
    },
  },
  branch: {
    kind: "branch",
    label: "Branch",
    tone: "accent",
    defaultConfig: () => ({}),
    allowsOutgoing: true,
    allowsIncoming: true,
    describe: () => "conditional fan-out via edge `when`",
  },
  wait_for_event: {
    kind: "wait_for_event",
    label: "Wait for Event",
    tone: "info",
    defaultConfig: () => ({ event: "" }),
    allowsOutgoing: true,
    allowsIncoming: true,
    describe: (c) => `event: ${(c?.event as string) || "<unset>"}`,
  },
  enqueue_job: {
    kind: "enqueue_job",
    label: "Enqueue Job",
    tone: "info",
    defaultConfig: () => ({ queue: "", payload: {} }),
    allowsOutgoing: true,
    allowsIncoming: true,
    describe: (c) => `queue: ${(c?.queue as string) || "<unset>"}`,
  },
};

export const NODE_KIND_ORDER: NodeKind[] = [
  "start",
  "approval",
  "branch",
  "http",
  "script",
  "wait_for_event",
  "enqueue_job",
  "end",
];

export const TONE_CLASSES: Record<NodeKindMeta["tone"], { border: string; bg: string; accent: string }> = {
  neutral: { border: "border-[var(--color-ah-border)]",   bg: "bg-[var(--color-ah-bg-raised)]",  accent: "text-[var(--color-ah-text-muted)]" },
  success: { border: "border-emerald-500/40",             bg: "bg-emerald-500/5",                accent: "text-emerald-400" },
  info:    { border: "border-sky-500/40",                 bg: "bg-sky-500/5",                    accent: "text-sky-400" },
  warning: { border: "border-amber-500/40",               bg: "bg-amber-500/5",                  accent: "text-amber-400" },
  danger:  { border: "border-red-500/40",                 bg: "bg-red-500/5",                    accent: "text-red-400" },
  accent:  { border: "border-fuchsia-500/40",             bg: "bg-fuchsia-500/5",                accent: "text-fuchsia-400" },
};
