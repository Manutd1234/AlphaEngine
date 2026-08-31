"use client";

/** One content-safe roving-focus control for every addressable Proofs view. */

import QuantViewSwitcher from "@/components/workspace/QuantViewSwitcher";

export default function ProofsViewControl<Value extends string>({
  label,
  options,
  value,
  onValue,
  className = "seg proofs-view-control",
}: {
  label: string;
  options: ReadonlyArray<readonly [Value, string]>;
  value: Value;
  onValue: (next: Value) => void;
  className?: string;
}) {
  return (
    <QuantViewSwitcher
      label={label}
      options={options}
      value={value}
      onValue={onValue}
      className={className}
    />
  );
}
