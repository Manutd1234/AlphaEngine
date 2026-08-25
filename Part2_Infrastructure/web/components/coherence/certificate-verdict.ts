/**
 * The verdict chip, shared by the two sections that read one `certify` answer.
 *
 * ITS OWN MODULE SINCE 2026-08-25, and the reason is an import closure rather
 * than tidiness. `Basket` needs this chip for its verdict band and took it from
 * `CertificateViews`, which drags that file's two whole views — the money strip,
 * the check ladder, the six-row arithmetic table — into Basket's closure for one
 * six-line function. Nothing rendered wrong; what broke was every measurement
 * over "what does this section carry", including the prose count this pass is
 * judged on.
 *
 * `verdictReading` stays in `CertificateViews`: it is used by one section, and
 * moving a function to be near a function it is unrelated to is how a shared
 * module becomes a junk drawer.
 */

import type { CoherenceCertificate } from "@/lib/coherence/types";

export function verdictChip(certificate: CoherenceCertificate) {
  if (certificate.verdict === "incoherent") {
    return certificate.worth_doing
      ? { mark: "▲", word: "Dutch book, net of fees", tone: "critical" as const }
      : { mark: "▲", word: "Violated, but the fees eat it", tone: "warn" as const };
  }
  if (certificate.verdict === "untestable") {
    return { mark: "◌", word: "Not testable", tone: "muted" as const };
  }
  // The solver found no portfolio worth putting on, but the closed-form
  // checks found prices that admit no probability measure. Both are true and
  // they are different claims, so this does not render as "Coherent".
  if (certificate.priced_out) {
    return { mark: "▲", word: "Incoherent, but priced out by fees", tone: "warn" as const };
  }
  return { mark: "●", word: "Coherent", tone: "good" as const };
}
