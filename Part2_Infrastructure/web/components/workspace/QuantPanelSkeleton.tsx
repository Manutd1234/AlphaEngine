import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import QuantStateSurface from "@/components/workspace/QuantStateSurface";

const METRICS = ["exposure", "quality", "latency"] as const;
const RAIL_STOPS = ["one", "two", "three", "four", "five", "six"] as const;
const LEDGER_ROWS = ["source", "method", "sample", "decision"] as const;

const Shape = ({ className }: { className: string }) => (
  <Skeleton aria-hidden="true" className={`${className} animate-none`} />
);

/** A cold-chunk fallback shaped like the workspace that will replace it. */
export default function QuantPanelSkeleton() {
  return (
    <QuantStateSurface state="loading" label="Loading workspace" busy>
      <div className="quant-panel-skeleton">
        <div className="quant-panel-skeleton__head">
          <div className="quant-panel-skeleton__head-copy">
            <Shape className="quant-panel-skeleton__kicker" />
            <Shape className="quant-panel-skeleton__title" />
            <Shape className="quant-panel-skeleton__summary" />
          </div>
          <Shape className="quant-panel-skeleton__stamp" />
        </div>

        <div className="quant-panel-skeleton__metrics" aria-hidden="true">
          {METRICS.map((metric) => (
            <div className="quant-panel-skeleton__metric" key={metric}>
              <Shape className="quant-panel-skeleton__metric-label" />
              <Shape className="quant-panel-skeleton__metric-value" />
              <Shape className="quant-panel-skeleton__metric-note" />
            </div>
          ))}
        </div>

        <Separator className="quant-panel-skeleton__separator" />
        <div className="quant-panel-skeleton__rail" aria-hidden="true">
          {RAIL_STOPS.map((stop) => <Shape className="quant-panel-skeleton__rail-stop" key={stop} />)}
        </div>

        <div className="quant-panel-skeleton__body">
          <div className="quant-panel-skeleton__plot" aria-hidden="true">
            <Shape className="quant-panel-skeleton__plot-title" />
            <div className="quant-panel-skeleton__chart">
              <i /><i /><i /><i />
            </div>
            <Shape className="quant-panel-skeleton__plot-note" />
          </div>
          <div className="quant-panel-skeleton__ledger" aria-hidden="true">
            <Shape className="quant-panel-skeleton__ledger-title" />
            {LEDGER_ROWS.map((row) => (
              <div className="quant-panel-skeleton__ledger-row" key={row}>
                <Shape className="quant-panel-skeleton__ledger-key" />
                <Shape className="quant-panel-skeleton__ledger-value" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </QuantStateSurface>
  );
}
