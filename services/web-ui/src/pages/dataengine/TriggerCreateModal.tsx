import { useState, useEffect, useCallback } from "react";
import { Button } from "../../design-system";
import { createVastTrigger } from "../../api/dataengine-proxy";
import type { TriggerType, ElementEventType } from "../../types/dataengine";

/* ── Constants ── */

const EVENT_TYPES: { value: ElementEventType; label: string }[] = [
  { value: "ElementCreated", label: "Element Created" },
  { value: "ElementDeleted", label: "Element Deleted" },
  { value: "ElementTagCreated", label: "Element Tag Created" },
  { value: "ElementTagDeleted", label: "Element Tag Deleted" },
];

const inputClass =
  "w-full rounded-[var(--radius-ah-md)] border border-[var(--color-ah-border)] bg-[var(--color-ah-bg)] px-3 py-2 text-sm text-[var(--color-ah-text)] placeholder:text-[var(--color-ah-text-subtle)]";

const labelClass = "text-xs font-medium text-[var(--color-ah-text-muted)] mb-1 block";

const selectClass =
  "w-full rounded-[var(--radius-ah-md)] border border-[var(--color-ah-border)] bg-[var(--color-ah-bg)] px-3 py-2 text-sm text-[var(--color-ah-text)]";

/* ── Component ── */

export function TriggerCreateModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [type, setType] = useState<TriggerType>("element");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  // Element fields
  const [sourceView, setSourceView] = useState("");
  const [eventType, setEventType] = useState<ElementEventType>("ElementCreated");
  const [targetBrokerView, setTargetBrokerView] = useState("");
  const [prefixFilter, setPrefixFilter] = useState("");
  const [suffixFilter, setSuffixFilter] = useState("");

  // Schedule fields
  const [kafkaView, setKafkaView] = useState("");
  const [scheduleExpression, setScheduleExpression] = useState("");

  // Shared
  const [topic, setTopic] = useState("");

  // State
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when opening
  useEffect(() => {
    if (open) {
      setType("element");
      setName("");
      setDescription("");
      setSourceView("");
      setEventType("ElementCreated");
      setTargetBrokerView("");
      setPrefixFilter("");
      setSuffixFilter("");
      setKafkaView("");
      setScheduleExpression("");
      setTopic("");
      setSubmitting(false);
      setError(null);
    }
  }, [open]);

  // Escape key handler
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const canSubmit = name.trim() !== "" && topic.trim() !== "" && !submitting;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await createVastTrigger({
        name: name.trim(),
        description: description.trim() || undefined,
        type,
        topic: topic.trim(),
        ...(type === "element"
          ? {
              source_view: sourceView.trim() || undefined,
              event_type: eventType,
              target_event_broker_view: targetBrokerView.trim() || undefined,
              prefix_filter: prefixFilter.trim() || undefined,
              suffix_filter: suffixFilter.trim() || undefined,
            }
          : {
              kafka_view: kafkaView.trim() || undefined,
              schedule_expression: scheduleExpression.trim() || undefined,
            }),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create trigger");
    } finally {
      setSubmitting(false);
    }
  }, [
    canSubmit,
    name,
    description,
    type,
    topic,
    sourceView,
    eventType,
    targetBrokerView,
    prefixFilter,
    suffixFilter,
    kafkaView,
    scheduleExpression,
    onCreated,
  ]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      data-testid="trigger-create-modal"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        data-testid="trigger-modal-backdrop"
      />

      {/* Dialog */}
      <div className="relative w-full max-w-lg mx-4 rounded-[var(--radius-ah-lg)] border border-[var(--color-ah-border)] bg-[var(--color-ah-bg-raised)] shadow-xl max-h-[85vh] overflow-y-auto">
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-4">Create Trigger</h3>

          {/* Error */}
          {error && (
            <div
              className="mb-4 rounded-[var(--radius-ah-sm)] border border-[var(--color-ah-danger)]/30 bg-[var(--color-ah-danger)]/10 px-3 py-2 text-sm text-[var(--color-ah-danger)]"
              data-testid="trigger-create-error"
            >
              {error}
            </div>
          )}

          {/* Type toggle */}
          <div className="mb-4">
            <label className={labelClass}>Trigger Type</label>
            <div
              className="inline-flex rounded-[var(--radius-ah-md)] border border-[var(--color-ah-border)] overflow-hidden"
              data-testid="trigger-type-toggle"
            >
              <button
                type="button"
                className={`px-4 py-1.5 text-sm font-medium transition-colors cursor-pointer ${
                  type === "element"
                    ? "bg-[var(--color-ah-accent-muted)] text-white"
                    : "bg-[var(--color-ah-bg)] text-[var(--color-ah-text-muted)] hover:text-[var(--color-ah-text)]"
                }`}
                onClick={() => setType("element")}
                data-testid="trigger-type-element"
              >
                Element
              </button>
              <button
                type="button"
                className={`px-4 py-1.5 text-sm font-medium transition-colors cursor-pointer ${
                  type === "schedule"
                    ? "bg-[var(--color-ah-accent-muted)] text-white"
                    : "bg-[var(--color-ah-bg)] text-[var(--color-ah-text-muted)] hover:text-[var(--color-ah-text)]"
                }`}
                onClick={() => setType("schedule")}
                data-testid="trigger-type-schedule"
              >
                Schedule
              </button>
            </div>
          </div>

          {/* Common fields */}
          <div className="space-y-3 mb-4">
            <div>
              <label className={labelClass}>
                Name <span className="text-[var(--color-ah-danger)]">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-trigger"
                className={inputClass}
                data-testid="trigger-name-input"
              />
            </div>

            <div>
              <label className={labelClass}>Description</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description"
                className={inputClass}
                data-testid="trigger-description-input"
              />
            </div>

            <div>
              <label className={labelClass}>
                Topic <span className="text-[var(--color-ah-danger)]">*</span>
              </label>
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="events.ingest"
                className={inputClass}
                data-testid="trigger-topic-input"
              />
            </div>
          </div>

          {/* Element-specific fields */}
          {type === "element" && (
            <div className="space-y-3 mb-4" data-testid="trigger-element-fields">
              <div>
                <label className={labelClass}>Source View</label>
                <input
                  type="text"
                  value={sourceView}
                  onChange={(e) => setSourceView(e.target.value)}
                  placeholder="View name"
                  className={inputClass}
                  data-testid="trigger-source-view"
                />
              </div>

              <div>
                <label className={labelClass}>Event Type</label>
                <select
                  value={eventType}
                  onChange={(e) => setEventType(e.target.value as ElementEventType)}
                  className={selectClass}
                  data-testid="trigger-event-type"
                >
                  {EVENT_TYPES.map((et) => (
                    <option key={et.value} value={et.value}>
                      {et.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={labelClass}>Target Event Broker View</label>
                <input
                  type="text"
                  value={targetBrokerView}
                  onChange={(e) => setTargetBrokerView(e.target.value)}
                  placeholder="Broker view name"
                  className={inputClass}
                  data-testid="trigger-target-broker"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Prefix Filter</label>
                  <input
                    type="text"
                    value={prefixFilter}
                    onChange={(e) => setPrefixFilter(e.target.value)}
                    placeholder="/data/ingest/"
                    className={inputClass}
                    data-testid="trigger-prefix-filter"
                  />
                </div>
                <div>
                  <label className={labelClass}>Suffix Filter</label>
                  <input
                    type="text"
                    value={suffixFilter}
                    onChange={(e) => setSuffixFilter(e.target.value)}
                    placeholder=".exr"
                    className={inputClass}
                    data-testid="trigger-suffix-filter"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Schedule-specific fields */}
          {type === "schedule" && (
            <div className="space-y-3 mb-4" data-testid="trigger-schedule-fields">
              <div>
                <label className={labelClass}>Kafka View</label>
                <input
                  type="text"
                  value={kafkaView}
                  onChange={(e) => setKafkaView(e.target.value)}
                  placeholder="Kafka view name"
                  className={inputClass}
                  data-testid="trigger-kafka-view"
                />
              </div>

              <div>
                <label className={labelClass}>Schedule Expression</label>
                <input
                  type="text"
                  value={scheduleExpression}
                  onChange={(e) => setScheduleExpression(e.target.value)}
                  placeholder="0 */5 * * * ?"
                  className={inputClass}
                  data-testid="trigger-schedule-expr"
                />
                <p className="text-xs text-[var(--color-ah-text-subtle)] mt-1">
                  Quartz cron syntax (e.g. &quot;0 */5 * * * ?&quot; for every 5 minutes)
                </p>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-4 border-t border-[var(--color-ah-border-muted)]">
            <Button variant="ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!canSubmit}
              onClick={() => void handleSubmit()}
              data-testid="trigger-create-submit"
            >
              {submitting ? "Creating..." : "Create"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
