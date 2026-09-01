/** Phase-aware reconstruction of recorder polls from event-level tape rows. */

export interface PollCadence {
  /** Normal cadence before the bounded campaign and after it completes. */
  readonly baselineSeconds: number;
  /** Cadence while the bounded observation campaign is running. */
  readonly campaignSeconds: number;
  /** Completion time of the first durable campaign poll, in milliseconds. */
  readonly campaignFromMs: number | null;
  /** Completion time of the target poll; null while the campaign is running. */
  readonly campaignThroughMs: number | null;
}

export interface Poll {
  /** Milliseconds, from the first reading in the cluster. */
  readonly at: number;
  /** How many events the recorder read on that visit. */
  readonly readings: number;
}

export interface PollOutage {
  readonly from: number;
  readonly to: number;
  /** Scheduled polls strictly between the two observed polls. */
  readonly missed: number;
}

export interface EpisodeFloors {
  readonly campaign: number | null;
  readonly baseline: number;
  readonly current: number;
}

function positive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

/** Cadence supported by durable campaign boundaries at one wall-clock time. */
export function cadenceAt(schedule: PollCadence, atMs: number): number {
  const campaign = schedule.campaignFromMs != null
    && atMs >= schedule.campaignFromMs
    && (schedule.campaignThroughMs == null || atMs <= schedule.campaignThroughMs);
  return positive(campaign ? schedule.campaignSeconds : schedule.baselineSeconds);
}

/** Two-poll episode floors kept separate so a completed campaign stays historical. */
export function episodeFloors(
  schedule: PollCadence,
  currentSeconds: number,
  campaignConfigured: boolean,
): EpisodeFloors {
  return {
    campaign: campaignConfigured ? positive(schedule.campaignSeconds) * 2 : null,
    baseline: positive(schedule.baselineSeconds) * 2,
    current: positive(currentSeconds) * 2,
  };
}

/** Expected cadence intervals across a gap, including phase transitions. */
function intervalsBetween(schedule: PollCadence, fromMs: number, toMs: number): number {
  const duration = Math.max(0, toMs - fromMs);
  if (!duration) return 0;
  const campaignFrom = schedule.campaignFromMs;
  if (campaignFrom == null) return duration / (positive(schedule.baselineSeconds) * 1000);
  const campaignTo = schedule.campaignThroughMs ?? toMs;
  const overlap = Math.max(0, Math.min(toMs, campaignTo) - Math.max(fromMs, campaignFrom));
  const baseline = duration - overlap;
  return baseline / (positive(schedule.baselineSeconds) * 1000)
    + overlap / (positive(schedule.campaignSeconds) * 1000);
}

/** Cluster event-level readings into the poll that produced each group. */
export function pollsOf(points: readonly { ts_ns: number }[], schedule: PollCadence): Poll[] {
  const stamps = points
    .map((point) => Number(point.ts_ns) / 1e6)
    .filter((ms) => Number.isFinite(ms))
    .sort((a, b) => a - b);
  if (!stamps.length) return [];

  const out: Poll[] = [{ at: stamps[0], readings: 1 }];
  for (let i = 1; i < stamps.length; i += 1) {
    const last = out[out.length - 1];
    // Use the tighter phase at a boundary. A campaign poll must not be folded
    // into a pre-campaign visit merely because that older visit ran at 300s.
    const cut = Math.min(cadenceAt(schedule, last.at), cadenceAt(schedule, stamps[i])) * 500;
    if (stamps[i] - last.at > cut) out.push({ at: stamps[i], readings: 1 });
    else out[out.length - 1] = { at: last.at, readings: last.readings + 1 };
  }
  return out;
}

/** Gaps wide enough to contain more than the allowed scheduled intervals. */
export function outagesOf(
  polls: readonly Poll[],
  schedule: PollCadence,
  outagePolls = 2,
): PollOutage[] {
  const out: PollOutage[] = [];
  for (let i = 1; i < polls.length; i += 1) {
    const from = polls[i - 1].at;
    const to = polls[i].at;
    const intervals = intervalsBetween(schedule, from, to);
    if (intervals > outagePolls) {
      out.push({ from, to, missed: Math.max(0, Math.round(intervals) - 1) });
    }
  }
  return out;
}
