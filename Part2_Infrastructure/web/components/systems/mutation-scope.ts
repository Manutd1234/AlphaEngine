/**
 * What each server mutation clears, and what it deliberately leaves intact.
 *
 * WHY THIS IS A MODULE AND NOT A PARAGRAPH. `OperatorControls` ended with a
 * disclosure — "What each server control touches, and leaves alone" — carrying
 * five sentences of prose. Prose is where this fact was, and prose is exactly
 * the wrong shape for it: the question an operator actually asks mid-incident
 * is not "what does Purge do" but "which of the six things I care about will
 * still be there afterwards", and a list of five sentences answers that only if
 * you read all five and hold the negative space in your head. The relation is a
 * matrix, so it is stored as one and drawn as one.
 *
 * EVERY CELL WAS READ OUT OF THE WRITE PATH, NOT INFERRED. `lib/operator.ts` is
 * the only place in this deployment that mutates provider-routing state, and
 * every claim below names the function or the constant it came from in
 * `source`. The rejected alternative was to write the matrix from the existing
 * prose: that would have made the diagram a picture of a paragraph rather than
 * a picture of the system, and a paragraph is not a thing you can check. Two of
 * the cells came out DIFFERENT from the prose reading once the code was open —
 * `clear_telemetry` zeroes the cache *counters* while leaving cached responses
 * in place, and `reload_providers` drops the cached OpenBB readiness verdict
 * while leaving the response cache alone. Both are drawn as they are.
 *
 * THE SEVENTH STORE IS THE POINT. Six of the stores live in this instance and
 * can be counted. The vendor's meter cannot: it is held by the provider, no
 * route in this deployment reads it, and no control on this pane can reset it.
 * "Reset a quota ledger" is the one button on the desk whose name most invites
 * the opposite belief, so the store it does NOT touch is drawn beside the ones
 * it does, dashed and with the reason attached, rather than left out — an
 * absence a reader has to notice is not an absence a reader will notice.
 */

/** Effect of one mutation on one store. Four kinds, because three would lie. */
export type MutationEffect = "clears" | "rereads" | "intact" | "unreachable";

/**
 * Mark, word and tone per effect. The MARK carries the meaning and the WORD
 * repeats it; colour is the third carrier and never the first, so the matrix
 * survives a greyscale print and Windows High Contrast alike. Filled, arrow,
 * hollow, dotted is the same ramp `DependencyMix` uses for present / degraded /
 * absent — a hollow ring is a thing that is there and untouched, a dotted ring
 * is a thing this deployment cannot see at all.
 */
export const EFFECT_STYLE: Record<MutationEffect, { glyph: string; word: string; tone: string }> = {
  clears: { glyph: "●", word: "cleared", tone: "var(--critical-text)" },
  rereads: { glyph: "→", word: "re-read", tone: "var(--notice-text)" },
  intact: { glyph: "○", word: "left intact", tone: "var(--text-secondary)" },
  unreachable: { glyph: "◌", word: "out of reach", tone: "var(--text-muted)" },
};

export interface MutationStore {
  id: string;
  /** Full name, used by the matrix and by the spoken description. */
  label: string;
  /** Short name, used by the drawing where 190px is all there is. */
  short: string;
  /** Where the quantity beside it is read from, so the figure is checkable. */
  source: string;
}

/**
 * The six stores this instance holds, plus the one it does not.
 *
 * Order is the order a request meets them: the cache answers first, routing
 * state decides which provider is asked, configuration decides which providers
 * exist at all, the ledger counts the call, telemetry records that it happened,
 * and the vendor bills for it.
 */
export const MUTATION_STORES: MutationStore[] = [
  { id: "cache", label: "Cached responses", short: "Cached responses", source: "health.cache.entries" },
  { id: "circuits", label: "Circuit state", short: "Circuit state", source: "providers[].circuitOpen" },
  { id: "outages", label: "Simulated outages", short: "Simulated outages", source: "providers[].simulatedOutage" },
  { id: "config", label: "Provider configuration", short: "Provider config", source: "providers[]" },
  { id: "ledgers", label: "Quota ledgers", short: "Quota ledgers", source: "providers[].quota" },
  { id: "telemetry", label: "Telemetry buffers", short: "Telemetry buffers", source: "health.events.retained" },
  { id: "vendor", label: "The vendor's meter", short: "Vendor's meter", source: "not on the wire" },
];

export interface MutationRow {
  id: string;
  /** The control's own heading, word for word as `OperatorControls` prints it. */
  label: string;
  /** Short name for the drawing and the selector. */
  short: string;
  /** The wire action names this row dispatches, from `OPERATOR_ACTIONS`. */
  actions: string[];
  /** Per-store effect, and the reason in the repository's own words. */
  effects: Record<string, { effect: MutationEffect; reason: string }>;
}

const OUT_OF_REACH = {
  effect: "unreachable" as const,
  reason: "no control in this instance reaches the vendor's meter",
};

/**
 * The five rows, in the order `OperatorControls` renders them, so a reader
 * moving between the buttons and the map is never re-ordering in their head.
 */
export const SERVER_MUTATIONS: MutationRow[] = [
  {
    id: "purge_cache",
    label: "Purge cached responses",
    short: "Purge cache",
    actions: ["purge_cache"],
    effects: {
      cache: { effect: "clears", reason: "matching entries in the six cache namespaces are dropped" },
      circuits: { effect: "intact", reason: "CACHE_PREFIXES excludes breaker state deliberately" },
      outages: { effect: "intact", reason: "a simulated outage is routing state, not a cached answer" },
      config: { effect: "intact", reason: "no key or environment value is re-read" },
      ledgers: { effect: "intact", reason: "CACHE_PREFIXES excludes the quota namespace deliberately" },
      telemetry: { effect: "intact", reason: "the hit and miss counters keep counting from where they were" },
      vendor: OUT_OF_REACH,
    },
  },
  {
    id: "reset_breaker",
    label: "Restore routing",
    short: "Restore routing",
    actions: ["reset_breaker", "clear_outage"],
    effects: {
      cache: { effect: "intact", reason: "closing a circuit does not bring a purged answer back" },
      circuits: { effect: "clears", reason: "every open circuit closes and learned licence blocks are forgotten" },
      outages: { effect: "clears", reason: "every operator-caused outage is lifted" },
      config: { effect: "intact", reason: "no key or environment value is re-read" },
      ledgers: { effect: "intact", reason: "a closed circuit has spent nothing and refunds nothing" },
      telemetry: { effect: "intact", reason: "the closing transition is written to the ring, not over it" },
      vendor: OUT_OF_REACH,
    },
  },
  {
    id: "reload_providers",
    label: "Re-read provider configuration",
    short: "Re-read config",
    actions: ["reload_providers"],
    effects: {
      cache: { effect: "intact", reason: "only the cached OpenBB readiness verdict is dropped; responses stay" },
      circuits: { effect: "intact", reason: "a reload is not a recovery and closes nothing" },
      outages: { effect: "intact", reason: "a reload is not a recovery and lifts nothing" },
      config: { effect: "rereads", reason: "the secrets already in this process's environment are registered again" },
      ledgers: { effect: "intact", reason: "counts survive a reload; only the registry is re-evaluated" },
      telemetry: { effect: "intact", reason: "nothing observed is discarded" },
      vendor: OUT_OF_REACH,
    },
  },
  {
    id: "reset_quota",
    label: "Reset a quota ledger",
    short: "Reset a ledger",
    actions: ["reset_quota"],
    effects: {
      cache: { effect: "intact", reason: "an already-cached answer is still served without a call" },
      circuits: { effect: "intact", reason: "a spent quota and an open circuit are separate conditions" },
      outages: { effect: "intact", reason: "routing is unchanged by an accounting reset" },
      config: { effect: "intact", reason: "no key or environment value is re-read" },
      ledgers: { effect: "clears", reason: "one chosen provider's local counter returns to zero" },
      telemetry: { effect: "intact", reason: "the reset is written to the ring, not over it" },
      vendor: {
        effect: "unreachable",
        reason: "the provider still believes it served those calls, and may reject or bill the next ones",
      },
    },
  },
  {
    id: "clear_telemetry",
    label: "Clear telemetry buffers",
    short: "Clear telemetry",
    actions: ["clear_telemetry"],
    effects: {
      cache: { effect: "intact", reason: "cached responses stay; only the counters over them are zeroed" },
      circuits: { effect: "intact", reason: "circuit state is behaviour, not observation" },
      outages: { effect: "intact", reason: "a simulated outage is behaviour, not observation" },
      config: { effect: "intact", reason: "no key or environment value is re-read" },
      ledgers: { effect: "intact", reason: "the quota ledger is accounting, not observation" },
      telemetry: { effect: "clears", reason: "the event ring, the latency buffers and the cache counters empty" },
      vendor: OUT_OF_REACH,
    },
  },
];

/**
 * The counts the badges beside the buttons already print.
 *
 * Taken as the SAME inputs `OperatorControls` receives rather than re-derived
 * from the snapshot here: two derivations of one fact agree only for as long as
 * they happen to coincide, and a map that disagreed with the badge ten pixels
 * above it would be worse than no map.
 */
export interface MutationScopeInput {
  /** False when the health route refused: a zero here would be a claim. */
  registryObserved: boolean;
  providerCount: number;
  openCircuits: number;
  simulated: number;
  quotaLedgers: number;
  cacheEntries: number | null;
  stateEntries: number | null;
  eventsRetained: number | null;
  eventsCapacity: number | null;
}

export interface StoreQuantity extends MutationStore {
  /** The measured figure, or null when there is no measurement to state. */
  value: string | null;
  /** Why the figure is missing. Never null when `value` is null. */
  absence: string | null;
}

const NOT_OBSERVED = "the provider registry has not been observed";

/**
 * Attach a live quantity to each store, or say why there is none.
 *
 * A dash and a reason, never a zero. `providers === null` upstream means the
 * health route refused and nothing was counted; an empty registry counted to
 * zero is a measurement and keeps its zero. The two are different findings and
 * this is the function that has to tell them apart.
 */
export function deriveStoreQuantities(input: MutationScopeInput): StoreQuantity[] {
  const registry = (value: string): { value: string | null; absence: string | null } =>
    input.registryObserved ? { value, absence: null } : { value: null, absence: NOT_OBSERVED };

  const measured: Record<string, { value: string | null; absence: string | null }> = {
    cache: input.cacheEntries == null
      ? { value: null, absence: "this snapshot carries no cache counter" }
      : {
        value: `${input.cacheEntries.toLocaleString()} cached`
          + (input.stateEntries == null ? "" : `, ${input.stateEntries.toLocaleString()} state`),
        absence: null,
      },
    circuits: registry(`${input.openCircuits} open of ${input.providerCount}`),
    outages: registry(`${input.simulated} simulated`),
    config: registry(`${input.providerCount} providers`),
    ledgers: registry(`${input.quotaLedgers} ledgers`),
    /* Retained and capacity are two readings, and an older snapshot can carry
       the first without the second. `16/?` would print a punctuation mark where
       a number belongs, so the ratio is only claimed when both halves exist. */
    telemetry: input.eventsRetained == null
      ? { value: null, absence: "this snapshot carries no event counter" }
      : {
        value: input.eventsCapacity == null
          ? `${input.eventsRetained} events, capacity not stated`
          : `${input.eventsRetained}/${input.eventsCapacity} events`,
        absence: null,
      },
    vendor: {
      value: null,
      absence: "held by the provider; nothing in this deployment can read it",
    },
  };

  return MUTATION_STORES.map((store) => ({ ...store, ...measured[store.id] }));
}

/**
 * One spoken sentence per mutation, for the drawing's `aria-label`.
 *
 * The drawing is `role="img"`: a reader with no pointer and no sight of it gets
 * this string and must be able to answer the same question from it, including
 * the quantities. Built from the model rather than written beside it, so the
 * two cannot drift.
 */
export function describeMutationScope(quantities: StoreQuantity[]): string {
  const by = new Map(quantities.map((store) => [store.id, store]));
  const say = (id: string): string => {
    const store = by.get(id);
    if (!store) return id;
    return store.value ? `${store.label} (${store.value})` : `${store.label} (not stated: ${store.absence})`;
  };
  const lines = SERVER_MUTATIONS.map((row) => {
    const touched = MUTATION_STORES
      .filter((store) => {
        const effect = row.effects[store.id]?.effect;
        return effect === "clears" || effect === "rereads";
      })
      .map((store) => say(store.id));
    return `${row.label} touches ${touched.length ? touched.join(" and ") : "nothing"}.`;
  });
  /* "Leaves every other store intact" is stated ONCE rather than after each of
     the five. Said per line it is 235 characters of repetition in a label a
     screen reader reads start to finish, and the rule is the same for all five
     — which is exactly the kind of thing a preamble is for. */
  return "What each of the five server mutations clears; each leaves every store not named "
    + `for it intact. ${lines.join(" ")} `
    + "None of them reaches the vendor's meter, which this deployment cannot read or reset.";
}
