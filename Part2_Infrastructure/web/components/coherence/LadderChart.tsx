"use client";

import { BookLadderConsole } from "./BooksInstruments";

export interface LadderLevel {
  price: string;
  size: string;
}

export interface LadderChartProps {
  yesBids: LadderLevel[];
  noBids: LadderLevel[];
  /** Retained in the public contract; the mirror derives asks from native NO bids. */
  yesAsks: LadderLevel[];
  /** How much of the venue book this snapshot actually contains. */
  depth: string;
  caption: string;
  unquotedReason?: string | null;
}

export default function LadderChart({ yesBids, noBids, depth, caption, unquotedReason }: LadderChartProps) {
  return (
    <BookLadderConsole
      yesBids={yesBids}
      noBids={noBids}
      depth={depth}
      caption={caption}
      unquotedReason={unquotedReason}
    />
  );
}
