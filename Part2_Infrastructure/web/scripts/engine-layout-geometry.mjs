/**
 * Geometry primitives and browser snapshot collection for the workspace audit.
 * Keeping this boundary independent from the CLI makes both the paint model and
 * failure classification directly testable without pretending Node has a DOM.
 */

export const TOLERANCE_PX = 1;
export const SURFACE_SELECTOR = [
  ".console-card",
  ".coh-figure",
  ".coh-table",
  ".metric-card",
  ".lesson-card",
  ".seg",
  "[role='tablist']",
  "details.disclosure",
  "main svg",
  "main pre",
].join(",");
export const OWNER_SELECTOR = [
  ".console-card",
  ".workspace-panel",
  "[role='tabpanel']",
  "header",
  "main",
].join(",");

/** @typedef {{left:number,top:number,right:number,bottom:number,width:number,height:number}} Rect */

/**
 * @param {Rect} child
 * @param {Rect} owner
 * @param {number} [tolerance]
 */
export function overflowBy(child, owner, tolerance = TOLERANCE_PX) {
  const overflow = {
    left: Math.max(0, owner.left - child.left),
    top: Math.max(0, owner.top - child.top),
    right: Math.max(0, child.right - owner.right),
    bottom: Math.max(0, child.bottom - owner.bottom),
  };
  return Object.values(overflow).some((value) => value > tolerance) ? overflow : null;
}

/**
 * @param {Rect} first
 * @param {Rect} second
 * @param {number} [tolerance]
 */
export function intersection(first, second, tolerance = TOLERANCE_PX) {
  const width = Math.min(first.right, second.right) - Math.max(first.left, second.left);
  const height = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
  return width > tolerance && height > tolerance ? { width, height } : null;
}

/**
 * Convert one browser snapshot into stable, serialisable failures.
 *
 * @param {{
 *   viewport:{width:number,height:number},
 *   documentOverflow:boolean,
 *   elements:Array<{
 *     key:string,role:string,rect:Rect,ownerRect:Rect,
 *     scrollWidth:number,clientWidth:number,overflowX:string,
 *     localScrollport:boolean,accessibleName:string,
 *     clipAncestors?:Array<{key:string,overflow:{left:number,right:number}}>
 *   }>,
 *   siblingPairs:Array<{first:string,second:string,overlap:{width:number,height:number}}>,
 *   obstructions:Array<{blocker:string,target:string,overlap:{width:number,height:number}}>
 * }} snapshot
 */
export function auditGeometrySnapshot(snapshot) {
  const issues = [];
  if (snapshot.documentOverflow) {
    issues.push({
      kind: "document-overflow",
      viewport: snapshot.viewport,
    });
  }

  for (const element of snapshot.elements) {
    for (const clip of element.clipAncestors ?? []) {
      issues.push({
        kind: "nested-clipping",
        key: element.key,
        role: element.role,
        ancestor: clip.key,
        overflow: clip.overflow,
      });
    }

    const horizontallyScrollable = /^(auto|scroll)$/.test(element.overflowX);
    const namedScrollport = element.localScrollport
      && horizontallyScrollable
      && element.accessibleName.trim().length > 0;
    const silentlyClipped = element.scrollWidth > element.clientWidth + TOLERANCE_PX
      && /^(clip|hidden)$/.test(element.overflowX)
      && !namedScrollport;

    if (silentlyClipped) {
      issues.push({
        kind: "silent-clipping",
        key: element.key,
        role: element.role,
        clippedByPx: element.scrollWidth - element.clientWidth,
      });
      continue;
    }

    const crossing = overflowBy(element.rect, element.ownerRect);
    if (crossing && !namedScrollport) {
      issues.push({
        kind: "container-overflow",
        key: element.key,
        role: element.role,
        overflow: crossing,
      });
    }
  }

  for (const pair of snapshot.siblingPairs) {
    issues.push({ kind: "sibling-intersection", ...pair });
  }
  for (const obstruction of snapshot.obstructions) {
    issues.push({ kind: "sticky-obstruction", ...obstruction });
  }
  return issues;
}

/** Collect the currently painted geometry from one hydrated browser route. */
export async function browserSnapshot(page) {
  return page.evaluate(({ surfaceSelector, ownerSelector, tolerance }) => {
    const documentElement = document.documentElement;
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      /* A closed <details> retains its body in the DOM and gives those nodes
         layout rectangles, but only the summary is painted. Counting the
         retained body reported ReplayBackfillPanel as hundreds of pixels
         outside Data Lineage even though the disclosure was closed. */
      /* Start above the candidate itself. A nested <details> can be closed and
         still retain a rectangle hundreds of pixels below its closed parent.
         Starting at `element.closest(...)` mistakes that inner disclosure for
         its own painting boundary and never notices the closed ancestor. */
      const closedDetails = element.parentElement?.closest("details:not([open])");
      const closedSummary = closedDetails?.querySelector(":scope > summary");
      const retainedUnderClosedDetails = closedDetails && !closedSummary?.contains(element);
      return style.display !== "none"
        && style.visibility !== "hidden"
        && !element.closest("[hidden]")
        && !retainedUnderClosedDetails
        && rect.width > 0
        && rect.height > 0;
    };
    /* getBoundingClientRect reports an element's layout position even when it
       sits below a nested `overflow-y: auto` viewport. That box is reachable,
       not painted at the current scroll position. Only intermediate clipping
       ancestors are considered here: the geometry owner itself remains the
       boundary being audited, and the workspace's primary scroller continues
       to expose the complete route rather than only the initial fold. */
    const paintedWithinVerticalClips = (element) => {
      const rect = element.getBoundingClientRect();
      const owner = element.parentElement?.closest(ownerSelector);
      let ancestor = element.parentElement;
      while (ancestor && ancestor !== owner) {
        const style = getComputedStyle(ancestor);
        if (/^(auto|scroll|hidden|clip)$/.test(style.overflowY)) {
          const clip = ancestor.getBoundingClientRect();
          if (rect.bottom <= clip.top + tolerance || rect.top >= clip.bottom - tolerance) {
            return false;
          }
        }
        ancestor = ancestor.parentElement;
      }
      return true;
    };
    const toRect = (reading) => ({
      left: reading.left,
      top: reading.top,
      right: reading.right,
      bottom: reading.bottom,
      width: reading.width,
      height: reading.height,
    });
    const keyFor = (element, index) => {
      if (element.id) return `#${element.id}`;
      const role = element.getAttribute("role");
      const classes = [...element.classList].slice(0, 3).join(".");
      return `${element.tagName.toLowerCase()}${role ? `[role=${role}]` : ""}${classes ? `.${classes}` : ""}:${index}`;
    };
    const accessibleName = (element) => {
      const labelledBy = element.getAttribute("aria-labelledby");
      const labelled = labelledBy
        ? labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ")
        : "";
      return element.getAttribute("aria-label")
        ?? labelled
        ?? element.getAttribute("title")
        ?? "";
    };
    const localScrollportFor = (element, owner) => {
      let candidate = element;
      while (candidate && candidate !== owner) {
        const style = getComputedStyle(candidate);
        if (/^(auto|scroll)$/.test(style.overflowX)
          && candidate.scrollWidth > candidate.clientWidth + tolerance) return candidate;
        candidate = candidate.parentElement;
      }
      return null;
    };
    /* A surface can fit its nearest geometry owner and still be cut by an
       intermediate overflow:hidden/clip wrapper. Only report a wrapper when
       the surface actually crosses its inner horizontal clipping edge; the
       common contained use of overflow:hidden for rounded corners stays quiet. */
    const nestedHorizontalClipsFor = (element, owner) => {
      const rect = element.getBoundingClientRect();
      const clips = [];
      let ancestor = element.parentElement;
      while (ancestor && ancestor !== owner) {
        const style = getComputedStyle(ancestor);
        if (/^(hidden|clip)$/.test(style.overflowX)) {
          const boundary = ancestor.getBoundingClientRect();
          const clipMargin = style.overflowX === "clip"
            ? Number.parseFloat(style.overflowClipMargin) || 0
            : 0;
          const leftEdge = boundary.left + ancestor.clientLeft - clipMargin;
          const rightEdge = leftEdge + ancestor.clientWidth + (2 * clipMargin);
          const overflow = {
            left: Math.max(0, leftEdge - rect.left),
            right: Math.max(0, rect.right - rightEdge),
          };
          if (overflow.left > tolerance || overflow.right > tolerance) {
            clips.push({ key: keyFor(ancestor, 0), overflow });
          }
        }
        ancestor = ancestor.parentElement;
      }
      return clips;
    };

    const surfaces = [...document.querySelectorAll(surfaceSelector)]
      .filter((element) => visible(element) && paintedWithinVerticalClips(element));
    const elements = surfaces.map((element, index) => {
      const owner = element.parentElement?.closest(ownerSelector)
        ?? document.querySelector("main")
        ?? document.body;
      const scrollport = localScrollportFor(element, owner);
      const geometryOwner = scrollport ?? owner;
      const style = getComputedStyle(scrollport ?? element);
      return {
        key: keyFor(element, index),
        role: element.getAttribute("role") ?? element.tagName.toLowerCase(),
        rect: toRect(element.getBoundingClientRect()),
        ownerRect: toRect(geometryOwner.getBoundingClientRect()),
        scrollWidth: (scrollport ?? element).scrollWidth,
        clientWidth: (scrollport ?? element).clientWidth,
        overflowX: style.overflowX,
        localScrollport: Boolean(scrollport),
        accessibleName: scrollport ? accessibleName(scrollport) : accessibleName(element),
        // A named overflow:auto ancestor is the deliberate viewing boundary.
        // Do not walk past it to a rounded outer frame and report reachable
        // content as clipped merely because the scrollport itself is wider.
        clipAncestors: nestedHorizontalClipsFor(element, scrollport ?? owner),
      };
    });

    const siblingPairs = [];
    const bordered = surfaces.filter((element) => {
      const style = getComputedStyle(element);
      return [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth]
        .some((width) => Number.parseFloat(width) > 0);
    });
    for (let firstIndex = 0; firstIndex < bordered.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < bordered.length; secondIndex += 1) {
        const first = bordered[firstIndex];
        const second = bordered[secondIndex];
        if (first.parentElement !== second.parentElement) continue;
        const a = first.getBoundingClientRect();
        const b = second.getBoundingClientRect();
        const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (width <= tolerance || height <= tolerance) continue;
        siblingPairs.push({
          first: keyFor(first, firstIndex),
          second: keyFor(second, secondIndex),
          overlap: { width, height },
        });
      }
    }

    const activePanel = [...document.querySelectorAll("[role='tabpanel']")]
      .find((element) => visible(element) && element.getAttribute("aria-hidden") !== "true")
      ?? document.querySelector("main");
    /* Intersections must use the painted fragment, not the element's full
       layout box. A control can straddle the bottom of the workspace
       scrollport while the clipped fragment ends exactly where the fixed
       mobile navigator begins; comparing the un-clipped box invents an
       obstruction that the user cannot see. */
    const paintedRectForObstruction = (element) => {
      if (!visible(element)) return false;
      const rect = element.getBoundingClientRect();
      const painted = {
        left: Math.max(rect.left, 0),
        top: Math.max(rect.top, 0),
        right: Math.min(rect.right, window.innerWidth),
        bottom: Math.min(rect.bottom, window.innerHeight),
      };
      let ancestor = element.parentElement;
      while (ancestor && ancestor !== document.body) {
        const style = getComputedStyle(ancestor);
        if (/^(auto|scroll|hidden|clip)$/.test(style.overflowY)) {
          const clip = ancestor.getBoundingClientRect();
          painted.top = Math.max(painted.top, clip.top + ancestor.clientTop);
          painted.bottom = Math.min(
            painted.bottom,
            clip.top + ancestor.clientTop + ancestor.clientHeight,
          );
        }
        if (/^(auto|scroll|hidden|clip)$/.test(style.overflowX)) {
          const clip = ancestor.getBoundingClientRect();
          painted.left = Math.max(painted.left, clip.left + ancestor.clientLeft);
          painted.right = Math.min(
            painted.right,
            clip.left + ancestor.clientLeft + ancestor.clientWidth,
          );
        }
        ancestor = ancestor.parentElement;
      }
      if (painted.right - painted.left <= tolerance
        || painted.bottom - painted.top <= tolerance) return null;
      return painted;
    };
    const targets = activePanel
      ? [...activePanel.querySelectorAll("h1,h2,h3,button,a[href],input,select,textarea")]
        .map((element) => ({ element, rect: paintedRectForObstruction(element) }))
        .filter((target) => target.rect)
      : [];
    const blockers = [...document.querySelectorAll("body *")].map((element) => ({
      element,
      rect: paintedRectForObstruction(element),
    })).filter(({ element, rect }) => {
      if (!rect) return false;
      const style = getComputedStyle(element);
      if (Number.parseFloat(style.opacity) === 0) return false;
      const position = style.position;
      return position === "sticky" || position === "fixed";
    });
    const obstructions = [];
    blockers.forEach(({ element: blocker, rect: a }, blockerIndex) => {
      targets.forEach(({ element: target, rect: b }, targetIndex) => {
        // A sticky control and its own labelled descendants share geometry by
        // design; only unrelated content beneath it can be obstructed.
        if (blocker === target || blocker.contains(target) || target.contains(blocker)) return;
        const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (width <= tolerance || height <= tolerance) return;
        obstructions.push({
          blocker: keyFor(blocker, blockerIndex),
          target: keyFor(target, targetIndex),
          overlap: { width, height },
        });
      });
    });

    return {
      documentOverflow: documentElement.scrollWidth > documentElement.clientWidth + tolerance,
      elements,
      siblingPairs,
      obstructions,
      overlay: Boolean(document.querySelector("[data-nextjs-dialog-overlay],#nextjs__container_errors_label")),
    };
  }, {
    surfaceSelector: SURFACE_SELECTOR,
    ownerSelector: OWNER_SELECTOR,
    tolerance: TOLERANCE_PX,
  });
}
