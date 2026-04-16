/**
 * Custom React Flow node — one card per workflow step.
 *
 * Visuals are tinted by NodeKind (start = success-green, approval = warning-amber, etc).
 * Handles: start has only an outgoing port; end has only incoming; everything
 * else has both. The canvas uses the metadata to surface a `describe()`
 * one-liner under the kind label so admins can scan the graph fast.
 */
import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";

import { NODE_KINDS, TONE_CLASSES, type NodeKind } from "./node-kinds";

export interface WorkflowNodeData {
  kind: NodeKind;
  config: Record<string, unknown> | undefined;
}

function WorkflowNodeImpl({ data, selected, id }: NodeProps<WorkflowNodeData>) {
  const meta = NODE_KINDS[data.kind];
  const tone = TONE_CLASSES[meta.tone];
  return (
    <div
      className={`relative w-[200px] rounded-[var(--radius-ah-sm)] border ${tone.border} ${tone.bg} px-3 py-2 shadow-sm ${
        selected ? "ring-2 ring-[var(--color-ah-accent)]" : ""
      }`}
      data-testid={`workflow-node-${id}`}
      data-node-kind={data.kind}
    >
      {meta.allowsIncoming && (
        <Handle
          type="target"
          position={Position.Left}
          className="!bg-[var(--color-ah-border)] !w-2 !h-2"
          aria-label="incoming"
        />
      )}
      <div className="flex items-center justify-between gap-2">
        <span className={`text-[10px] uppercase tracking-wider font-[var(--font-ah-mono)] ${tone.accent}`}>
          {meta.label}
        </span>
      </div>
      <div className="mt-1 font-[var(--font-ah-mono)] text-xs text-[var(--color-ah-text)] truncate" title={id}>
        {id}
      </div>
      <div className="mt-1 text-[10px] text-[var(--color-ah-text-muted)] truncate" title={meta.describe(data.config)}>
        {meta.describe(data.config)}
      </div>
      {meta.allowsOutgoing && (
        <Handle
          type="source"
          position={Position.Right}
          className="!bg-[var(--color-ah-accent)] !w-2 !h-2"
          aria-label="outgoing"
        />
      )}
    </div>
  );
}

export const WorkflowNodeComponent = memo(WorkflowNodeImpl);
