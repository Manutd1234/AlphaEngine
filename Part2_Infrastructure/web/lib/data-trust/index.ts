/**
 * Whether the desk's numbers can be believed, and the evidence for the answer.
 *
 * This was one 786-line file. It is now four, and this barrel is why every
 * importer still says `@/lib/data-trust`. The list is written out name by name
 * rather than as `export *`, so a rename in a sibling is a compile error here
 * instead of a name that quietly stops existing at this path.
 */

export { deriveDataTrust } from "./model";
export type {
  DataTrustAction,
  DataTrustDestination,
  DataTrustEvidence,
  DataTrustModel,
  DataTrustTone,
  DataTrustVerdict,
} from "./model";

export { deriveTrustSlis, TRUST_MIN_SAMPLES } from "./slis";
export type { TrustSli } from "./slis";

export {
  deriveFailoverDepth,
  deriveInstanceScope,
  deriveProviderSupply,
  deriveQuotaHeadroom,
  humanDuration,
} from "./analytics";
export type {
  FailoverDepthRow,
  InstanceScopeFact,
  QuotaHeadroomRow,
  SupplyCounts,
} from "./analytics";

export { deriveFeedThroughput, resolveLatencySource } from "./feeds";
export type { FeedBookRow, FeedThroughputRow, LatencySourceRef } from "./feeds";
