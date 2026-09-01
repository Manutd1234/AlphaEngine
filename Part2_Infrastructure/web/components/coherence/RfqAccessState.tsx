"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export interface RfqStateRow {
  state: string;
  mark: string;
  word: string;
  means: string;
  not: string;
}

export function rfqAccessFailure(code: string | null | undefined, error: string | null): RfqStateRow | null {
  if (!code?.startsWith("rfq_auth_")) return null;
  if (code === "rfq_auth_membership_required") {
    return {
      state: "membership_required",
      mark: "◇",
      word: "Desk membership required",
      means: error ?? "The signed-in account is not assigned to this private RFQ desk.",
      not: "Not a broken gateway or venue connection; no private venue request was sent.",
    };
  }
  if (code === "rfq_auth_required" || code === "rfq_auth_invalid") {
    return {
      state: "account_required",
      mark: "◇",
      word: code === "rfq_auth_invalid" ? "Account sign-in expired" : "Account sign-in required",
      means: error ?? "A verified account session is required for this private RFQ channel.",
      not: "Not a broken gateway or venue connection; no private venue request was sent.",
    };
  }
  return {
    state: "account_required",
    mark: "◇",
    word: "Account verification unavailable",
    means: error ?? "The account boundary could not be evaluated, so the private read was not attempted.",
    not: "Not an RFQ venue failure; the request stopped at the account boundary.",
  };
}

export function RfqAccessNotice({ row, onRetry }: { row: RfqStateRow; onRetry: () => void }) {
  return (
    <Alert role="status" variant="default" className="coh-rfq__connection" data-state={row.state}>
      <AlertTitle><span aria-hidden="true">✓</span> RFQ gateway route verified; {row.word.toLowerCase()}</AlertTitle>
      <AlertDescription>
        <p>
          The browser reached the protected RFQ route and its access policy answered. {row.means}
          {" "}No private venue request was dispatched, so this is not shown as a failed gateway connection.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Retry account check
        </Button>
      </AlertDescription>
    </Alert>
  );
}
