// AlphaEngine — Institutional Whitepaper.
//
// Assembled from sections/, one file per chapter, so chapters can be written
// and reviewed independently while the layout stays in template.typ. Compile:
//
//   typst compile docs/whitepaper/main.typ docs/whitepaper/AlphaEngine_Institutional_Whitepaper.pdf
//
// The section files are content only. If a chapter needs a new layout idiom,
// it goes in template.typ so every chapter can use it.

#import "template.typ": *

#show: whitepaper.with(
  title: "AlphaEngine",
  subtitle: "From market signal to governed decision — architecture, mathematics and operations of a quantitative trading desk",
  version: "Revision A",
  generated: "22 August 2026",
)

#include "sections/01-abstract-topology.typ"
#include "sections/02-researcher-pm.typ"
#include "sections/03-risk-trader.typ"
#include "sections/04-data-sre-developer.typ"
#include "sections/05-mathematical-foundations.typ"
#include "sections/06-infrastructure-telemetry.typ"
