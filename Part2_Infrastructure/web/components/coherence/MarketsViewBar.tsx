"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { marketsViewContract } from "@/lib/markets/view-contracts";

type CopyState = "copied" | "failed";

interface CopyResult {
  deepLink: string;
  state: CopyState;
}

function CopyIcon({ done }: { done: boolean }) {
  return done ? (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m4 10 3.5 3.5L16 5" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  ) : (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="7" y="3" width="9" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5 7H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-1" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function ResetIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 7V3m0 0h4M4 3l2.2 2.2A6 6 0 1 1 4 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export interface MarketsViewBarProps {
  section: string;
  view: string;
  canReset: boolean;
  onReset: () => void;
}

function currentDeepLink(deepLink: string): string {
  if (typeof window === "undefined") return `#${deepLink}`;
  return `${window.location.origin}${window.location.pathname}${window.location.search}#${deepLink}`;
}

export default function MarketsViewBar({ section, view, canReset, onReset }: MarketsViewBarProps) {
  const contract = marketsViewContract(section, view);
  const [copyResult, setCopyResult] = useState<CopyResult | null>(null);

  if (!contract) return null;

  // A route change invalidates feedback during render. Keeping the route beside
  // the result avoids an effect-driven reset and, more importantly, prevents a
  // one-frame "copied" announcement from belonging to the next view.
  const copyState: CopyState | "idle" = copyResult?.deepLink === contract.deepLink
    ? copyResult.state
    : "idle";

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(currentDeepLink(contract.deepLink));
      setCopyResult({ deepLink: contract.deepLink, state: "copied" });
    } catch {
      setCopyResult({ deepLink: contract.deepLink, state: "failed" });
    }
  };

  return (
    <div className="markets-viewbar" data-copy-state={copyState} aria-label="Active Markets route actions">
      <div className="markets-viewbar__actions">
        {canReset ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Reset to the section's default view"
            title="Reset view"
            onClick={onReset}
          >
            <ResetIcon />
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={copyState === "copied" ? "Deep link copied" : "Copy deep link"}
          title="Copy deep link"
          onClick={copyLink}
        >
          <CopyIcon done={copyState === "copied"} />
        </Button>
      </div>

      <p className="markets-viewbar__copy-state" role="status" aria-live="polite">
        {copyState === "copied"
          ? "Deep link copied to the clipboard."
          : copyState === "failed"
            ? "The browser refused clipboard access; use the route shown in Evidence."
            : ""}
      </p>
    </div>
  );
}
