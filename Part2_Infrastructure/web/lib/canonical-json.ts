/**
 * Stable JSON encoding, shared verbatim by every runtime that makes an
 * evidence claim.
 *
 * Extracted from `lib/delivery-readiness.ts` (which re-exports it unchanged)
 * so the browser can canonicalise too: the Monte Carlo parity check compares a
 * result computed in the page's worker against the committed reference, and a
 * *second* serialiser would be a second thing that can drift — the exact
 * failure a byte-for-byte comparison exists to rule out. No Node imports; the
 * hashing stays in the server-only module.
 *
 * Number formatting is safe cross-engine: ECMAScript specifies the
 * shortest-round-trip decimal rendering, so identical doubles stringify
 * identically in V8, JavaScriptCore and SpiderMonkey.
 */

function canonicalise(value: unknown, ancestors: Set<object>): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value)!;
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("canonical JSON requires finite numbers");
      return JSON.stringify(value)!;
    case "object": {
      if (ancestors.has(value)) throw new TypeError("canonical JSON cannot contain cycles");
      ancestors.add(value);
      try {
        if (Array.isArray(value)) {
          const entries = Array.from({ length: value.length }, (_, index) => {
            if (!(index in value)) throw new TypeError("canonical JSON cannot contain sparse arrays");
            return canonicalise(value[index], ancestors);
          });
          return `[${entries.join(",")}]`;
        }

        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
          throw new TypeError("canonical JSON requires plain objects");
        }

        const object = value as Record<string, unknown>;
        const fields = Object.keys(object)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonicalise(object[key], ancestors)}`);
        return `{${fields.join(",")}}`;
      } finally {
        ancestors.delete(value);
      }
    }
    default:
      throw new TypeError(`canonical JSON cannot represent ${typeof value}`);
  }
}

/** Stable JSON encoding: object keys sort recursively; array order is retained. */
export function canonicalJson(value: unknown): string {
  return canonicalise(value, new Set());
}
