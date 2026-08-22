// AlphaEngine institutional whitepaper — shared layout.
//
// One template, imported by main.typ, so every section inherits the same
// measure, type ladder and figure treatment. Section files own CONTENT only:
// none of them sets a page, a font or a numbering scheme, which is what keeps
// six independently written chapters reading as one document.
//
// British spelling throughout, in prose and in identifiers — the house rule
// this repository holds its code and its documentation to alike.

#let accent = rgb("#1f4e79")
#let rule = rgb("#d4d8dd")
#let muted = rgb("#5b6470")

#let whitepaper(title: "", subtitle: "", version: "", generated: "", body) = {
  set document(title: title, author: "AlphaEngine")
  set page(
    paper: "a4",
    margin: (top: 26mm, bottom: 24mm, left: 22mm, right: 22mm),
    header: context {
      if counter(page).get().first() > 1 {
        set text(8.5pt, fill: muted)
        grid(columns: (1fr, auto), align: (left, right),
          [AlphaEngine — Institutional Whitepaper], [#version])
        line(length: 100%, stroke: 0.4pt + rule)
      }
    },
    footer: context {
      set text(8.5pt, fill: muted)
      grid(columns: (1fr, auto, 1fr), align: (left, center, right),
        [#generated], [#counter(page).display("1")], [])
    },
  )
  set text(font: ("New Computer Modern", "Times New Roman", "Georgia"), size: 9.8pt, lang: "en", region: "gb")
  set par(justify: true, leading: 0.62em, first-line-indent: 0pt, spacing: 0.72em)

  set heading(numbering: "1.1")
  show heading.where(level: 1): it => {
    pagebreak(weak: true)
    block(above: 0pt, below: 14pt)[
      #set text(17pt, weight: 700, fill: accent)
      #counter(heading).display() #h(8pt) #it.body
      #v(4pt)
      #line(length: 100%, stroke: 1pt + accent)
    ]
  }
  show heading.where(level: 2): it => block(above: 15pt, below: 7pt)[
    #set text(12.2pt, weight: 700); #counter(heading).display() #h(6pt) #it.body
  ]
  show heading.where(level: 3): it => block(above: 11pt, below: 5pt)[
    #set text(10.4pt, weight: 700, fill: accent.darken(10%)); #it.body
  ]

  show raw.where(block: true): it => block(
    width: 100%, fill: rgb("#f6f7f9"), inset: 8pt, radius: 3pt,
    stroke: 0.5pt + rule,
  )[#set text(8.2pt, font: ("DejaVu Sans Mono", "Menlo", "Courier New")); #it]
  show raw.where(block: false): it => box(
    fill: rgb("#f2f3f5"), inset: (x: 2.5pt, y: 0pt), outset: (y: 2.5pt), radius: 2pt,
  )[#set text(8.6pt, font: ("DejaVu Sans Mono", "Menlo", "Courier New")); #it]

  set table(stroke: 0.4pt + rule, inset: 5pt)
  show table.cell.where(y: 0): set text(weight: 700, size: 8.6pt)
  set figure(numbering: "1")
  show figure.caption: set text(8.4pt, fill: muted)
  set math.equation(numbering: "(1)")

  // Title page
  v(52mm)
  align(center)[
    #block(text(26pt, weight: 700, fill: accent, title))
    #v(5pt)
    #block(text(12.5pt, fill: muted, subtitle))
    #v(20pt)
    #line(length: 46%, stroke: 0.8pt + accent)
    #v(12pt)
    #block(text(9.6pt, fill: muted)[#version • #generated])
  ]
  v(1fr)
  align(center)[
    #block(width: 78%)[
      #set text(8.6pt, fill: muted)
      #set par(justify: false)
      Every figure in this document is either measured and sourced to the
      artefact that produced it, or explicitly labelled as illustrative. No
      benchmark is quoted that was not run. Where a capability is absent it is
      named as absent, with the reason it waits.
    ]
  ]
  pagebreak()

  outline(depth: 2, indent: auto)
  pagebreak()

  body
}

// A measured figure: the number, and where it came from. Used instead of a bare
// numeral anywhere a reader might otherwise assume a benchmark.
#let measured(value, source) = [#value #text(7.6pt, fill: muted)[[#source]]]

// An explicitly illustrative value — never to be read as a measurement.
#let illustrative(value) = [#value #text(7.6pt, fill: muted)[[illustrative]]]

#let note(title, body) = block(
  width: 100%, inset: 8pt, radius: 3pt, stroke: 0.5pt + accent.lighten(45%),
  fill: accent.lighten(96%),
)[#text(weight: 700, size: 9pt, fill: accent)[#title] #v(3pt) #body]
