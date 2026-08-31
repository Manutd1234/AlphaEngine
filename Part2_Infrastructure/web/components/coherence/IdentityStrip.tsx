"use client";

/**
 * Lesson 0, operated: `yes_ask + no_ask` and `1 + spread` share one scale.
 *
 * The algebra is three lines and most readers will take it on trust, which is
 * exactly the problem — the strategy it retires appears in two of the
 * most-starred prediction-market bots on GitHub, written by people who had the
 * same three lines available. The route lab therefore pairs proportional rails
 * with a local quote shock and the selected market's exact depth histogram.
 *
 * The routes are stacked from their parts so the equality stays structural,
 * while every histogram mark comes from the live native YES/NO bid arrays.
 */

import { BookIdentityLab } from "./BookIdentityLab";
import type { LadderLevel } from "./LadderChart";

export interface IdentityStripProps {
  yesAsk: string | null;
  noAsk: string | null;
  bestYesBid?: string | null;
  bestNoBid?: string | null;
  spread: string | null;
  identitySum: string | null;
  identityOnePlusSpread: string | null;
  yesBids: LadderLevel[];
  noBids: LadderLevel[];
  unquotedReason?: string | null;
}

export default function IdentityStrip({
  yesAsk,
  noAsk,
  bestYesBid,
  bestNoBid,
  spread,
  identitySum,
  identityOnePlusSpread,
  yesBids,
  noBids,
  unquotedReason,
}: IdentityStripProps) {
  return (
    <BookIdentityLab
      yesAsk={yesAsk}
      noAsk={noAsk}
      bestYesBid={bestYesBid}
      bestNoBid={bestNoBid}
      spread={spread}
      identitySum={identitySum}
      identityOnePlusSpread={identityOnePlusSpread}
      yesBids={yesBids}
      noBids={noBids}
      unquotedReason={unquotedReason}
    />
  );
}
