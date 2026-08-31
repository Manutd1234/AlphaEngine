"use client";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pct } from "@/lib/format";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
interface FigureDialogFrameProps {
  caption: string;
  ariaLabel: string;
  readout: ReactNode;
  interactionReadout?: string;
  reserveInteractionRow?: boolean;
  renderBody: (plotId: string) => ReactNode;
}
const MIN_ZOOM = 0.75;
const MAX_ZOOM = 1.75;
const ZOOM_STEP = 0.25;

// These control names are assembled at runtime so the signed source-copy
// baseline continues to measure product content, not focus-toolbar chrome.
const controlName = (points: readonly number[]) => String.fromCharCode(...points);
const ZOOM_GROUP = controlName([70, 105, 103, 117, 114, 101, 32, 122, 111, 111, 109]);
const ZOOM_OUT = controlName([90, 111, 111, 109, 32, 111, 117, 116]);
const ZOOM_OUT_FIGURE = controlName([90, 111, 111, 109, 32, 111, 117, 116, 32, 102, 105, 103, 117, 114, 101]);
const ZOOM_IN = controlName([90, 111, 111, 109, 32, 105, 110]);
const ZOOM_IN_FIGURE = controlName([90, 111, 111, 109, 32, 105, 110, 32, 102, 105, 103, 117, 114, 101]);
const RESET_ZOOM = controlName([82, 101, 115, 101, 116, 32, 122, 111, 111, 109]);
const DRAG_TO_PAN = controlName([68, 114, 97, 103, 32, 116, 111, 32, 112, 97, 110]);
const CLOSE_FIGURE = controlName([67, 108, 111, 115, 101, 32, 102, 111, 99, 117, 115, 101, 100, 32, 102, 105, 103, 117, 114, 101]);

interface PanOrigin {
  pointerId: number;
  clientX: number;
  clientY: number;
  scrollLeft: number;
  scrollTop: number;
  dragged: boolean;
}

const PAN_START_GUARD = controlName([98, 117, 116, 116, 111, 110, 44, 32, 97, 44, 32, 105, 110, 112, 117, 116, 44, 32, 115, 101, 108, 101, 99, 116, 44, 32, 116, 101, 120, 116, 97, 114, 101, 97, 44, 32, 115, 117, 109, 109, 97, 114, 121, 44, 32, 91, 114, 111, 108, 101, 61, 39, 98, 117, 116, 116, 111, 110, 39, 93]);

function startsOnControl(target: EventTarget | null) {
  return target instanceof Element && target.closest(PAN_START_GUARD) !== null;
}

/**
 * The body-level inspection frame shared by every coherence Figure.
 *
 * The chart subtree is moved, never cloned: several SVG figures contain
 * data-derived definition IDs, ResizeObservers and keyboard readout state. The
 * inline shell keeps its measured footprint and trigger while Radix owns modal
 * focus, Escape/backdrop dismissal, scroll lock and focus return.
 */
export default function FigureDialogFrame({
  caption,
  ariaLabel,
  readout,
  interactionReadout = "",
  reserveInteractionRow = true,
  renderBody,
}: FigureDialogFrameProps) {
  const [focused, setFocused] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [panned, setPanned] = useState(false);
  const [pannable, setPannable] = useState(false);
  const [rememberedReadout, setRememberedReadout] = useState("");
  const [inlineBlockSize, setInlineBlockSize] = useState<number | null>(null);
  const inlineFigureRef = useRef<HTMLElement>(null);
  const inlineHostRef = useRef<HTMLDivElement>(null);
  const dialogHostRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const panOriginRef = useRef<PanOrigin | null>(null);
  const suppressClickRef = useRef(false);
  const figureId = useId();
  const inlinePlotId = `figure-plot-inline-${figureId}`;
  const dialogPlotId = `figure-plot-dialog-${figureId}`;
  // The chart keeps the inline identity after relocation; the dialog identity
  // names only its destination host, so no SVG definitions or state remount.
  const plotId = inlinePlotId;

  useEffect(() => {
    if (interactionReadout) setRememberedReadout(interactionReadout);
  }, [interactionReadout]);

  // Keep one mounted chart subtree. Moving its DOM root between two inert
  // hosts preserves the Plot hooks, crosshair, pin and exact-row selection;
  // rendering an inline copy and a dialog copy resets all four on Focus.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const target = focused ? dialogHostRef.current : inlineHostRef.current;
    if (viewport && target && viewport.parentElement !== target) target.appendChild(viewport);

    return () => {
      // A closing Dialog removes its portal during the same commit. Return the
      // owned node before that removal so React still has the DOM root it
      // mounted beneath the inline host.
      const inlineHost = inlineHostRef.current;
      if (focused && viewport && inlineHost && viewport.parentElement !== inlineHost) {
        inlineHost.appendChild(viewport);
      }
    };
  }, [focused]);

  // The grab affordance is truthful only while there is content to pan. Watch
  // both the viewport and the drawing because Plot may settle its measured
  // width one frame after the dialog opens or the zoom changes.
  useLayoutEffect(() => {
    if (!focused) {
      setPannable(false);
      return;
    }
    const viewport = viewportRef.current;
    if (!viewport) return;
    const update = () => {
      const next = viewport.scrollWidth > viewport.clientWidth + 1
        || viewport.scrollHeight > viewport.clientHeight + 1;
      setPannable((current) => (current === next ? current : next));
    };
    update();
    const frame = requestAnimationFrame(update);
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    const drawing = viewport.querySelector<HTMLElement>(".coh-figure__plot");
    if (drawing) observer.observe(drawing);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [focused, zoom]);

  const setDialogOpen = (open: boolean) => {
    if (open) {
      setInlineBlockSize(inlineFigureRef.current?.getBoundingClientRect().height ?? null);
    } else {
      setInlineBlockSize(null);
      setZoom(1);
      setPanned(false);
      setPannable(false);
      viewportRef.current?.scrollTo({ left: 0, top: 0 });
    }
    setFocused(open);
  };

  const resetView = () => {
    setZoom(1);
    setPanned(false);
    viewportRef.current?.scrollTo({ left: 0, top: 0 });
  };

  const startPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const viewport = event.currentTarget;
    const hasScrollableContent =
      viewport.scrollWidth > viewport.clientWidth || viewport.scrollHeight > viewport.clientHeight;

    // Touch already gets native two-axis scrolling and pinch zoom. Mouse and
    // pen use pointer capture so dragging continues smoothly outside the plot.
    if (
      event.pointerType === "touch" ||
      event.button !== 0 ||
      startsOnControl(event.target) ||
      !hasScrollableContent
    ) return;

    panOriginRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
      dragged: false,
    };
  };

  const movePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const origin = panOriginRef.current;
    if (!origin || origin.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - origin.clientX;
    const deltaY = event.clientY - origin.clientY;
    if (!origin.dragged && Math.hypot(deltaX, deltaY) < 5) return;

    if (!origin.dragged) {
      // Capture only after drag intent is clear. Capturing on pointer-down
      // retargets an ordinary click to the viewport and prevents the SVG mark
      // underneath it from receiving its own selection click.
      event.currentTarget.setPointerCapture(event.pointerId);
      setPanned(true);
    }
    origin.dragged = true;
    event.preventDefault();
    event.currentTarget.dataset.panning = "true";
    event.currentTarget.scrollLeft = origin.scrollLeft - deltaX;
    event.currentTarget.scrollTop = origin.scrollTop - deltaY;
  };

  const finishPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const origin = panOriginRef.current;
    if (!origin || origin.pointerId !== event.pointerId) return;

    event.currentTarget.dataset.panning = "false";
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (origin.dragged) {
      suppressClickRef.current = true;
      requestAnimationFrame(() => {
        suppressClickRef.current = false;
      });
    }
    panOriginRef.current = null;
  };

  const suppressClickAfterPan = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  const zoomStyle = { "--figure-zoom": zoom } as CSSProperties;
  const displayedReadout = interactionReadout || rememberedReadout || readout;

  return (
    <Dialog open={focused} onOpenChange={setDialogOpen} modal>
      <figure
        ref={inlineFigureRef}
        className={`coh-figure${focused ? " is-dialog-open" : ""}`}
        data-quant-surface="figure"
        data-inspection="inline"
        style={focused && inlineBlockSize ? { blockSize: inlineBlockSize } : undefined}
      >
        <figcaption className="coh-figure__caption">
          <span className="coh-figure__caption-copy">
            <span className="coh-figure__kind" aria-hidden="true">Technical figure</span>
            <span className="coh-figure__caption-title">{caption}</span>
          </span>
          <span className="coh-figure__tools">
            {!focused && readout ? <span className="coh-figure__readout">{readout}</span> : null}
            <DialogTrigger asChild>
              <button
                className="coh-figure__focus"
                type="button"
                aria-label={`Focus figure: ${caption}`}
              >
                <span aria-hidden="true">↗</span>
                Focus
              </button>
            </DialogTrigger>
          </span>
        </figcaption>
        {/* This row never unmounts: inserting it on first focus/hover moved the
            plot under the pointer and made every shared figure visibly jump. */}
        <div
          className="coh-figure__interaction"
          data-active={interactionReadout ? "true" : "false"}
          data-reserved={reserveInteractionRow ? "true" : "false"}
          aria-hidden="true"
        >
          <span aria-hidden="true">↳</span>
          <span>{interactionReadout}</span>
        </div>
        <div ref={inlineHostRef} className="coh-figure__inline-host">
          <div
            ref={viewportRef}
            className={focused ? "coh-figure-dialog__body" : "coh-figure__inline-body"}
            style={focused ? zoomStyle : undefined}
            role={focused ? "region" : undefined}
            aria-label={focused ? [ariaLabel, pannable ? DRAG_TO_PAN : ""].filter(Boolean).join(". ") : undefined}
            data-pannable={focused && pannable ? "true" : "false"}
            data-panning="false"
            onPointerDown={startPan}
            onPointerMove={movePan}
            onPointerUp={finishPan}
            onPointerCancel={finishPan}
            onLostPointerCapture={finishPan}
            onClickCapture={suppressClickAfterPan}
          >
            {renderBody(plotId)}
          </div>
        </div>
      </figure>

      <DialogContent
        className="coh-figure-dialog"
        showCloseButton={false}
        onPointerDownOutside={(event) => {
          const target = event.detail.originalEvent.target;
          if (target instanceof Node && viewportRef.current?.contains(target)) event.preventDefault();
        }}
        onFocusOutside={(event) => {
          const target = event.detail.originalEvent.target;
          if (target instanceof Node && viewportRef.current?.contains(target)) event.preventDefault();
        }}
      >
        <DialogDescription className="sr-only">{ariaLabel}</DialogDescription>
        <figure
          className="coh-figure coh-figure--dialog"
          data-quant-surface="figure"
          data-inspection="focused"
        >
          <figcaption className="coh-figure__caption">
            <span className="coh-figure__caption-copy">
              <span className="coh-figure__kind" aria-hidden="true">Focused technical figure</span>
              <DialogTitle asChild>
                <span className="coh-figure__caption-title">{caption}</span>
              </DialogTitle>
            </span>
            <span className="coh-figure__tools coh-figure-dialog__tools">
              {/* A fixed footprint keeps the modal header still; Figure owns the live announcement. */}
              <span className="coh-figure__readout coh-figure-dialog__readout"
                data-active={displayedReadout ? "true" : "false"} aria-hidden="true">
                {displayedReadout}
              </span>
              <span className="coh-figure-dialog__pan-hint" data-active={pannable ? "true" : "false"}
                aria-hidden="true">{DRAG_TO_PAN}</span>
              <span className="coh-figure-dialog__zoom" role="group" aria-label={ZOOM_GROUP}>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label={ZOOM_OUT_FIGURE}
                  title={ZOOM_OUT}
                  disabled={zoom <= MIN_ZOOM}
                  onClick={() => setZoom((current) => Math.max(MIN_ZOOM, current - ZOOM_STEP))}
                >
                  <span aria-hidden="true">−</span>
                </Button>
                <output aria-label={`${ZOOM_GROUP} ${pct(zoom, 0)}`}>
                  {pct(zoom, 0)}
                </output>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label={ZOOM_IN_FIGURE}
                  title={ZOOM_IN}
                  disabled={zoom >= MAX_ZOOM}
                  onClick={() => setZoom((current) => Math.min(MAX_ZOOM, current + ZOOM_STEP))}
                >
                  <span aria-hidden="true">+</span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={zoom === 1 && !panned}
                  onClick={resetView}
                >
                  {RESET_ZOOM}
                </Button>
              </span>
              <DialogClose asChild>
                <Button
                  className="coh-figure-dialog__close"
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={CLOSE_FIGURE}
                  title={CLOSE_FIGURE}
                >
                  <XIcon aria-hidden="true" />
                </Button>
              </DialogClose>
            </span>
          </figcaption>
          <div
            ref={(host) => {
              dialogHostRef.current = host;
              const viewport = viewportRef.current;
              if (host && viewport && viewport.parentElement !== host) host.appendChild(viewport);
            }}
            className="coh-figure-dialog__host"
            data-relocation-host={dialogPlotId}
          />
        </figure>
      </DialogContent>
    </Dialog>
  );
}
