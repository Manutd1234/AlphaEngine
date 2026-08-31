"use client";

/**
 * Content-safe analytical view navigation.
 *
 * Radix owns selection, roving focus, and keyboard behavior. This wrapper owns
 * the Quant OS geometry: every option stays visible in bounded tracks and the
 * labels wrap within their own buttons when a row cannot fit. Domain sections
 * therefore never fall back to the global equal-flex `.seg button` sizing that
 * allowed adjacent labels to collide, or to an undiscoverable local scroller.
 */

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

export interface QuantViewSwitcherProps<Value extends string> {
  label: string;
  options: ReadonlyArray<readonly [Value, string]>;
  value: Value;
  onValue: (next: Value) => void;
  className?: string;
  optionLabel?: (label: string) => string;
  optionDescription?: (value: Value, label: string) => string | undefined;
}

export default function QuantViewSwitcher<Value extends string>({
  label,
  options,
  value,
  onValue,
  className,
  optionLabel = (option) => `${option} view`,
  optionDescription,
}: QuantViewSwitcherProps<Value>) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next) onValue(next as Value);
      }}
      aria-label={label}
      className={cn("seg quant-view-switcher", className)}
      variant="default"
      size="sm"
      data-quant-view-switcher=""
      data-option-count={options.length}
    >
      {options.map(([name, text]) => {
        const description = optionDescription?.(name, text);
        return (
          <ToggleGroupItem key={name} value={name} aria-label={optionLabel(text)}>
            <span className="quant-view-switcher__label">{text}</span>
            {description ? (
              <span className="quant-view-switcher__description" aria-hidden="true">{description}</span>
            ) : null}
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}
