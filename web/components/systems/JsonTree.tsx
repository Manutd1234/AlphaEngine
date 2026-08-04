"use client";

/**
 * A collapsible JSON viewer for payloads nobody designed for a screen.
 *
 * A `<pre>{JSON.stringify(x, null, 2)}</pre>` is fine until the payload is a
 * thousand-row aggregate array or an Alpha Vantage response whose keys are
 * `"1. open"` and `"Time Series (Daily)"`. The point of opening a raw body is
 * almost always to check a *shape* — does the field exist, is it a string or a
 * number, did the vendor rename it — and that question is answered by structure,
 * not by scrolling.
 *
 * So: containers collapse, arrays announce their length before you expand them,
 * and everything below the first two levels starts closed. Types are shown by
 * colour *and* by form (quoted strings, bare numbers, italic null), because
 * colour alone is not a distinction every reader can make.
 */

import { useState } from "react";

interface JsonTreeProps {
  value: unknown;
  /** Levels expanded on first render. Two is enough to see the top-level shape. */
  initialDepth?: number;
  /** Root label, e.g. the field name this payload arrived under. */
  name?: string;
}

export default function JsonTree({ value, initialDepth = 2, name }: JsonTreeProps) {
  return (
    <div className="json-tree">
      <JsonNode value={value} name={name} depth={0} initialDepth={initialDepth} isLast />
    </div>
  );
}

interface NodeProps {
  value: unknown;
  name?: string;
  depth: number;
  initialDepth: number;
  isLast: boolean;
}

function JsonNode({ value, name, depth, initialDepth, isLast }: NodeProps) {
  const [open, setOpen] = useState(depth < initialDepth);

  const container = value !== null && typeof value === "object";
  if (!container) {
    return (
      <div className="json-row" style={{ paddingLeft: depth * 12 }}>
        {name !== undefined && <span className="json-key">{name}</span>}
        <Scalar value={value} />
        {!isLast && <span className="json-punct">,</span>}
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const entries: [string, unknown][] = isArray
    ? (value as unknown[]).map((item, index) => [String(index), item])
    : Object.entries(value as Record<string, unknown>);
  const open_ = isArray ? "[" : "{";
  const close = isArray ? "]" : "}";

  return (
    <div>
      <div className="json-row" style={{ paddingLeft: depth * 12 }}>
        <button
          type="button"
          className="json-toggle"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          // Screen readers get the count without needing the visual summary.
          aria-label={`${open ? "Collapse" : "Expand"} ${name ?? "root"}, ${entries.length} ${
            entries.length === 1 ? "entry" : "entries"
          }`}
        >
          <span aria-hidden>{open ? "▾" : "▸"}</span>
        </button>
        {name !== undefined && <span className="json-key">{name}</span>}
        <span className="json-punct">{open_}</span>
        {!open && (
          <span className="json-summary">
            {entries.length} {entries.length === 1 ? "entry" : "entries"}
          </span>
        )}
        {!open && <span className="json-punct">{close}</span>}
        {!open && !isLast && <span className="json-punct">,</span>}
      </div>

      {open && (
        <>
          {entries.map(([key, item], index) => (
            <JsonNode
              key={key}
              // Array indices are noise once the shape is visible; object keys
              // are the whole point. Suppressing them keeps a 25-element sample
              // from reading as a wall of numbers.
              name={isArray ? undefined : key}
              value={item}
              depth={depth + 1}
              initialDepth={initialDepth}
              isLast={index === entries.length - 1}
            />
          ))}
          <div className="json-row" style={{ paddingLeft: depth * 12 }}>
            <span className="json-punct">{close}</span>
            {!isLast && <span className="json-punct">,</span>}
          </div>
        </>
      )}
    </div>
  );
}

function Scalar({ value }: { value: unknown }) {
  if (value === null) return <span className="json-null">null</span>;
  switch (typeof value) {
    case "string":
      return <span className="json-string">&quot;{value}&quot;</span>;
    case "number":
      return <span className="json-number">{Number.isFinite(value) ? value : String(value)}</span>;
    case "boolean":
      return <span className="json-bool">{String(value)}</span>;
    default:
      return <span className="json-null">{String(value)}</span>;
  }
}
