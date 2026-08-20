"use client";

/**
 * Every parameter the terminal-distribution Monte Carlo runs on, as controls.
 *
 * Five of the six were fixed constants in the simulation and one, the seed,
 * was derived and never shown — so two runs of the same card could differ and
 * a reader had no way to say how. Each one is now chosen here and reported by
 * the card beside the figure it moved.
 *
 * The horizon is deliberately NOT here: it is owned by the Risk section above,
 * shared with the GBM panel, so the two loss estimates cannot be read against
 * each other on two different clocks.
 */

import type { McResampler } from "@/lib/mc-distribution";

/** Path counts offered. The default is the middle one: 2,000 is quick but
 *  visibly lumpy in the tail, 50,000 costs seconds of worker time for a
 *  distribution that has already stopped moving. */
export const PATH_CHOICES = [2_000, 10_000, 50_000] as const;

/** Mean block lengths offered, in bars, beside the derived default.
 *
 * 1 is deliberately absent: a block of one bar IS the i.i.d. draw, and that
 * choice belongs to the resampler control rather than hiding at the bottom of
 * a length list where it reads as "a bit shorter". */
export const BLOCK_CHOICES = [5, 10, 20, 50] as const;

/** The confidence triples offered. The standard three are the default, and
 *  that matters beyond taste: a default request serialises exactly as it
 *  always has, which is what lib/mc-parity.ts compares byte for byte. */
export type McBandChoice = "standard" | "tail";
export const TAIL_CONFIDENCES: [number, number, number] = [90, 99, 99.9];

/** A seed is a uint32: `mulberry32` masks it with `>>> 0`, so anything wider
 *  would silently be a different seed from the one on screen. */
export const MC_SEED_MAX = 0xffff_ffff;

export interface McParameterRailProps {
  paths: number;
  onPaths: (paths: number) => void;
  resampler: McResampler;
  onResampler: (resampler: McResampler) => void;
  /** "auto" is the √N heuristic the equity band uses, not a hidden constant. */
  blockLength: "auto" | number;
  onBlockLength: (blockLength: "auto" | number) => void;
  bands: McBandChoice;
  onBands: (bands: McBandChoice) => void;
  /** Raw text, not a number: an empty box means "use the derived seed", and a
   *  half-typed one must not be committed as some other number. */
  seedText: string;
  onSeedText: (seedText: string) => void;
  /** The run's own seed, shown as the placeholder so it is never a secret. */
  derivedSeed: number;
}

export default function McParameterRail({
  paths,
  onPaths,
  resampler,
  onResampler,
  blockLength,
  onBlockLength,
  bands,
  onBands,
  seedText,
  onSeedText,
  derivedSeed,
}: McParameterRailProps) {
  return (
    <>
      <label className="rail-toggle">
        Paths
        <select
          value={paths}
          onChange={(event) => onPaths(Number(event.target.value))}
          aria-label="Simulation path count"
        >
          {PATH_CHOICES.map((choice) => (
            <option key={choice} value={choice}>{choice.toLocaleString()}</option>
          ))}
        </select>
      </label>
      <label className="rail-toggle">
        Resampler
        <select
          value={resampler}
          onChange={(event) => onResampler(event.target.value as McResampler)}
          aria-label="Resampler drawing the paths"
        >
          <option value="stationary">Stationary blocks</option>
          <option value="iid">Independent bars</option>
        </select>
      </label>
      <label className="rail-toggle">
        Block
        <select
          value={String(blockLength)}
          onChange={(event) => {
            const next = event.target.value;
            onBlockLength(next === "auto" ? "auto" : Number(next));
          }}
          // Disabled rather than hidden: an i.i.d. draw has no block length,
          // and a control that vanished would leave the reader unsure whether
          // the last one they set is still in force.
          disabled={resampler === "iid"}
          aria-label="Mean bootstrap block length, in bars"
        >
          <option value="auto">auto (&radic;N)</option>
          {BLOCK_CHOICES.map((choice) => (
            <option key={choice} value={choice}>{choice} bars</option>
          ))}
        </select>
      </label>
      <label className="rail-toggle">
        Bands
        <select
          value={bands}
          onChange={(event) => onBands(event.target.value as McBandChoice)}
          aria-label="Loss confidences to report"
        >
          <option value="standard">50 / 95 / 99</option>
          <option value="tail">90 / 99 / 99.9</option>
        </select>
      </label>
      <label className="rail-toggle">
        Seed
        {/* `type=text` with a numeric keypad, not `type=number`: the number
            input reports an empty string for anything not yet a valid number,
            and committing `Number("")` would run the simulation on seed 0
            while the box still read what was typed. */}
        <input
          type="text"
          inputMode="numeric"
          value={seedText}
          placeholder={String(derivedSeed)}
          onChange={(event) => onSeedText(event.target.value)}
          style={{ width: "12ch" }}
          aria-label={`Simulation seed; empty runs the seed derived from the sweep, ${derivedSeed}`}
        />
      </label>
    </>
  );
}

/**
 * The typed seed as a number, or `null` when the box does not hold one.
 *
 * An empty box is `null` too, and the caller must not conflate the two: empty
 * means "use the seed the sweep derived", unusable means the reader asked for
 * something this cannot honour. `Number("")` is 0 and `Number("12x")` is NaN,
 * either of which would run a real simulation under a seed nobody chose.
 */
export function parseMcSeed(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,10}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value <= MC_SEED_MAX ? value : null;
}
