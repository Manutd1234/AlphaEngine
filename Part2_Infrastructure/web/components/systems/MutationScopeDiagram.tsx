"use client";

/**
 * The mutation map, drawn: five writes on the left, the state they act on on
 * the right, and an edge only where something is actually cleared.
 *
 * WHY A BIPARTITE DRAWING RATHER THAN A LIST. `FailoverGraph` argues that a
 * chain is a list and that a list survives a narrow screen and reduced motion,
 * and it is right about a chain. This is not one: the interesting property here
 * is FAN-OUT and, more than that, the SPARSENESS — six edges across a five by
 * seven grid — and sparseness is the one thing a list cannot show. "Purge does
 * not touch circuits" is a gap you can see from across the room here and a
 * sentence you have to read there.
 *
 * WHAT THIS DRAWING IS NOT. It is `role="img"` with the whole matrix spoken in
 * its label, and it is deliberately NOT the accessible surface: the table
 * beside it carries the same cells as text, and the selector above it is
 * ordinary buttons. Nothing here is the only route to a fact. That split is on
 * purpose — an SVG full of individually focusable nodes is a keyboard trap
 * wearing a diagram's clothes, and this desk has one drawing already
 * (`BreakerStateMachine`) that settled the same question the same way.
 *
 * NO ANIMATION AND NO TRANSITION. Selection repaints; it does not tween. There
 * is therefore nothing for `prefers-reduced-motion` to remove, which is the
 * same argument `DependencyTree` makes for its CSS connectors.
 */

import {
  EFFECT_STYLE,
  MUTATION_STORES,
  SERVER_MUTATIONS,
  type StoreQuantity,
} from "@/components/systems/mutation-scope";

/** Geometry. Written out rather than computed so the labels can be checked
 *  against the boxes they have to fit inside. */
const LEFT_X = 4;
const LEFT_W = 150;
const LEFT_H = 36;
const LEFT_STEP = 52;
const RIGHT_X = 396;
const RIGHT_W = 160;
const RIGHT_H = 30;
const RIGHT_STEP = 36;
const TOP = 14;

const leftY = (index: number) => TOP + index * LEFT_STEP;
const rightY = (index: number) => TOP + index * RIGHT_STEP;

export default function MutationScopeDiagram({
  quantities,
  selected,
  label,
}: {
  quantities: StoreQuantity[];
  /** Mutation id, or null for the whole map at rest. */
  selected: string | null;
  /** The spoken form of everything drawn here, built from the same model. */
  label: string;
}) {
  const active = SERVER_MUTATIONS.find((row) => row.id === selected) ?? null;
  const byStore = new Map(quantities.map((store) => [store.id, store]));

  return (
    <svg
      className="mutation-map__diagram"
      viewBox="0 0 560 266"
      width="100%"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={label}
    >
      <text x={LEFT_X + 2} y={8} fontSize={10} fill="var(--text-muted)" letterSpacing="0.06em">
        SERVER MUTATIONS
      </text>
      <text x={RIGHT_X + 2} y={8} fontSize={10} fill="var(--text-muted)" letterSpacing="0.06em">
        STATE IN THIS INSTANCE
      </text>

      {/* Edges first, so a box always draws over the line that reaches it.
          Flattened rather than nested, so every path is a keyed sibling: a
          nested array renders identically and makes the keys positional.

          There are six of these across a five by seven grid, and the SPARSENESS
          is the finding. An edge is drawn only where something is actually
          cleared or re-read; "leaves intact" is the empty space, said in words
          in the table under the drawing. */}
      {SERVER_MUTATIONS.flatMap((row, rowIndex) =>
        MUTATION_STORES.map((store, storeIndex) => {
          const cell = row.effects[store.id];
          if (!cell || (cell.effect !== "clears" && cell.effect !== "rereads")) return null;
          const y1 = leftY(rowIndex) + LEFT_H / 2;
          const y2 = rightY(storeIndex) + RIGHT_H / 2;
          const dim = active !== null && active.id !== row.id;
          return (
            <path
              key={`${row.id}-${store.id}`}
              d={`M${LEFT_X + LEFT_W},${y1} C${LEFT_X + LEFT_W + 100},${y1} ${RIGHT_X - 100},${y2} ${RIGHT_X},${y2}`}
              fill="none"
              stroke={EFFECT_STYLE[cell.effect].tone}
              strokeWidth={dim ? 1 : active ? 2 : 1.4}
              /* Dashed for a re-read: a reload does not empty the registry, it
                 evaluates it again, and drawing that as the same solid line as
                 an emptying would say the wrong thing at a glance. */
              strokeDasharray={cell.effect === "rereads" ? "5 3" : undefined}
              opacity={dim ? 0.14 : active ? 1 : 0.6}
            />
          );
        }))}

      {SERVER_MUTATIONS.map((row, index) => {
        const y = leftY(index);
        const chosen = active?.id === row.id;
        const dim = active !== null && !chosen;
        return (
          <g key={row.id} opacity={dim ? 0.4 : 1}>
            <rect
              x={LEFT_X}
              y={y}
              width={LEFT_W}
              height={LEFT_H}
              rx={8}
              fill="var(--surface-2)"
              stroke={chosen ? "var(--critical-text)" : "var(--border)"}
              strokeWidth={chosen ? 1.8 : 1}
            />
            <text x={LEFT_X + 12} y={y + 22} fontSize={12} fontWeight={650} fill="var(--text-primary)">
              {row.short}
            </text>
          </g>
        );
      })}

      {MUTATION_STORES.map((store, index) => {
        const y = rightY(index);
        const cell = active?.effects[store.id] ?? null;
        const style = cell ? EFFECT_STYLE[cell.effect] : null;
        const quantity = byStore.get(store.id);
        /* The vendor's meter is dashed at rest and dashed when selected: it is
           not a box this deployment can open, and drawing it solid alongside
           six boxes that can be opened would be the fabrication this whole
           panel exists to prevent. */
        const outside = store.id === "vendor";
        const touched = cell?.effect === "clears" || cell?.effect === "rereads";
        return (
          <g key={store.id} opacity={active && !touched && !outside ? 0.55 : 1}>
            <rect
              x={RIGHT_X}
              y={y}
              width={RIGHT_W}
              height={RIGHT_H}
              rx={7}
              fill={outside ? "none" : "var(--surface-2)"}
              stroke={touched && style ? style.tone : "var(--border)"}
              strokeWidth={touched ? 1.8 : 1}
              strokeDasharray={outside ? "4 3" : undefined}
            />
            <text x={RIGHT_X + 10} y={y + 13} fontSize={12} fontWeight={620} fill="var(--text-primary)">
              {store.short}
            </text>
            {/* A dash and the reason live in the table; the drawing prints the
                dash alone, because a fifteen-word reason does not fit a 28px
                box and half a reason is worse than none. */}
            <text
              x={RIGHT_X + 10}
              y={y + 25}
              fontSize={10}
              fontFamily="var(--mono)"
              fill="var(--text-muted)"
            >
              {quantity?.value ?? "—"}
            </text>
            {style && (
              <text
                x={RIGHT_X + RIGHT_W - 9}
                y={y + 20}
                textAnchor="end"
                fontSize={12}
                fill={style.tone}
              >
                {style.glyph}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
