"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Loader2,
  Pencil,
  RotateCcw,
  Users,
} from "lucide-react";
import {
  SEGMENT_FIELDS,
  SEGMENT_OPERATORS,
  type SegmentDefinition,
  type SegmentField,
  type SegmentLeaf,
  type SegmentOperator,
  type SegmentValue,
} from "@xeno/shared";

import { previewSegment } from "@/lib/analytics-api";
import type { SampleCustomer, SegmentRuleSuccess } from "@/lib/ai/tool-results";
import {
  collectLeaves,
  readableDefinition,
  readableLeaf,
  updateLeafAt,
} from "@/lib/segment-readable";

/** The consolidated, possibly-edited segment the console hands to the LaunchPanel. */
export interface ActiveSegment {
  toolCallId: string;
  name: string;
  description: string;
  definition: SegmentDefinition;
  count: number;
  sample: SampleCustomer[];
}

interface Props {
  toolCallId: string;
  result: SegmentRuleSuccess;
  onActive: (segment: ActiveSegment) => void;
}

// ─── Value coercion for inline edits ────────────────────────────────

function valueToInput(value: SegmentValue): string {
  return Array.isArray(value) ? value.join(", ") : String(value);
}

function coerceValue(raw: string, previous: SegmentValue): SegmentValue {
  if (Array.isArray(previous)) {
    const parts = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const allNumeric = parts.length > 0 && parts.every((p) => p !== "" && !isNaN(Number(p)));
    return allNumeric ? parts.map(Number) : parts;
  }
  if (typeof previous === "number") {
    const n = Number(raw);
    return raw.trim() === "" || isNaN(n) ? 0 : n;
  }
  return raw;
}

// ─── Inline leaf editor ─────────────────────────────────────────────

function LeafEditor({
  leaf,
  onChange,
}: {
  leaf: SegmentLeaf;
  onChange: (next: SegmentLeaf) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-background/40 p-2">
      <select
        value={leaf.field}
        onChange={(e) =>
          onChange({ ...leaf, field: e.target.value as SegmentField })
        }
        aria-label="Field"
        className="rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      >
        {SEGMENT_FIELDS.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
      <select
        value={leaf.operator}
        onChange={(e) =>
          onChange({ ...leaf, operator: e.target.value as SegmentOperator })
        }
        aria-label="Operator"
        className="rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      >
        {SEGMENT_OPERATORS.map((op) => (
          <option key={op} value={op}>
            {op}
          </option>
        ))}
      </select>
      <input
        value={valueToInput(leaf.value)}
        onChange={(e) =>
          onChange({ ...leaf, value: coerceValue(e.target.value, leaf.value) })
        }
        aria-label="Value"
        className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        placeholder={Array.isArray(leaf.value) ? "a, b, c" : "value"}
      />
    </div>
  );
}

// ─── Card ───────────────────────────────────────────────────────────

export function SegmentRuleCard({ toolCallId, result, onActive }: Props) {
  const [name, setName] = useState(result.name);
  const [definition, setDefinition] = useState<SegmentDefinition>(
    result.definition,
  );
  const [count, setCount] = useState(result.count);
  const [sample, setSample] = useState<SampleCustomer[]>(result.sample);
  const [editing, setEditing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // The rule as last successfully priced. Edits diff against this to trigger a re-preview.
  const pricedRef = useRef(JSON.stringify(result.definition));
  const reqIdRef = useRef(0);

  // Report the current consolidated segment upward whenever it settles.
  useEffect(() => {
    onActive({ toolCallId, name, description: result.description, definition, count, sample });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, definition, count, sample]);

  // Debounced live re-pricing when the rule is edited.
  useEffect(() => {
    const serialized = JSON.stringify(definition);
    if (serialized === pricedRef.current) return;

    const id = ++reqIdRef.current;
    setPreviewing(true);
    setPreviewError(null);
    const handle = setTimeout(async () => {
      try {
        const next = await previewSegment(definition);
        if (id !== reqIdRef.current) return; // a newer edit superseded this one
        pricedRef.current = serialized;
        setCount(next.count);
        setSample(next.sample);
      } catch (err) {
        if (id !== reqIdRef.current) return;
        setPreviewError(
          err instanceof Error ? err.message : "Could not re-evaluate the rule.",
        );
      } finally {
        if (id === reqIdRef.current) setPreviewing(false);
      }
    }, 450);
    return () => clearTimeout(handle);
  }, [definition]);

  const leaves = collectLeaves(definition);

  function resetRule() {
    setDefinition(result.definition);
    setName(result.name);
    pricedRef.current = JSON.stringify(result.definition);
    reqIdRef.current++;
    setCount(result.count);
    setSample(result.sample);
    setPreviewError(null);
    setPreviewing(false);
  }

  return (
    <div className="artifact-in overflow-hidden rounded-2xl border border-border bg-card/40 shadow-elevated">
      {/* Header band */}
      <div className="flex items-start justify-between gap-3 border-b border-border/60 bg-gradient-to-br from-seg/10 to-transparent px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-seg">
            <Users className="h-3.5 w-3.5" />
            Audience segment
          </div>
          {editing ? (
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-base font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          ) : (
            <h2 className="mt-1 truncate text-base font-semibold tracking-tight text-foreground">
              {name}
            </h2>
          )}
          <p className="mt-0.5 text-sm text-muted-foreground">
            {result.description}
          </p>
        </div>

        {/* Live count */}
        <div className="shrink-0 text-right">
          <div className="flex items-center justify-end gap-1.5">
            {previewing && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-seg" />
            )}
            <span className="text-3xl font-bold tabular-nums tracking-tight text-foreground">
              {count.toLocaleString()}
            </span>
          </div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            customers match
          </p>
        </div>
      </div>

      <div className="space-y-4 px-5 py-4">
        {/* Readable rule */}
        <p className="text-sm leading-relaxed text-foreground/90">
          <span className="text-muted-foreground">Targeting customers who </span>
          {readableDefinition(definition)}.
        </p>

        {/* Condition chips / inline editor */}
        {editing ? (
          <div className="space-y-2">
            {leaves.map((ref, i) => (
              <LeafEditor
                key={`${ref.path.join("-")}-${i}`}
                leaf={ref.leaf}
                onChange={(next) =>
                  setDefinition((d) => updateLeafAt(d, ref.path, next))
                }
              />
            ))}
            <p className="text-[11px] text-muted-foreground">
              Adjust the rule and the audience re-counts as you type.
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {leaves.map((ref, i) => (
              <span
                key={i}
                className="rounded-full border border-border/70 bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground"
              >
                {readableLeaf(ref.leaf)}
              </span>
            ))}
          </div>
        )}

        {previewError && (
          <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {previewError}
          </div>
        )}

        {/* Sample customers */}
        {sample.length > 0 && (
          <div>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Sample of the audience
            </p>
            <div className="flex flex-wrap gap-1.5">
              {sample.slice(0, 6).map((c) => (
                <span
                  key={c.id}
                  className="inline-flex items-center gap-1.5 rounded-full bg-muted/50 py-1 pl-1 pr-2.5 text-xs text-foreground/80"
                  title={c.email}
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-seg/15 text-[10px] font-semibold text-seg">
                    {c.firstName?.[0] ?? "?"}
                    {c.lastName?.[0] ?? ""}
                  </span>
                  {c.firstName} {c.lastName}
                </span>
              ))}
              {count > sample.length && (
                <span className="inline-flex items-center rounded-full px-2 py-1 text-xs text-muted-foreground">
                  +{(count - Math.min(sample.length, 6)).toLocaleString()} more
                </span>
              )}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          {editing ? (
            <>
              <button
                onClick={() => setEditing(false)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:bg-primary/90 active:scale-[0.98]"
              >
                <Check className="h-3.5 w-3.5" />
                Done
              </button>
              <button
                onClick={resetRule}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground active:scale-[0.98]"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </button>
            </>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background/50 px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-accent active:scale-[0.98]"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit rule
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
