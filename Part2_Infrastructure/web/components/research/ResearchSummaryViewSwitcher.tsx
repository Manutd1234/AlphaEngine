import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** The addressable Result/Setup split inside the published Summary section. */
export default function ResearchSummaryViewSwitcher({
  options,
  value,
  onValueChange,
}: {
  options: ReadonlyArray<readonly [string, string]>;
  value: string;
  onValueChange: (next: string) => void;
}) {
  return (
    <Tabs
      className="research-summary-views"
      value={value}
      onValueChange={onValueChange}
    >
      <TabsList aria-label={options.map(([, label]) => label).join(" / ")}>
        {options.map(([id, label]) => (
          <TabsTrigger
            key={id}
            id={`research-summary-${id}-tab`}
            value={id}
            aria-controls="research-summary-view-panel"
          >
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
