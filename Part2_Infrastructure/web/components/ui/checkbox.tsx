"use client"

import * as React from "react"
import { CheckIcon } from "lucide-react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer size-4 shrink-0 rounded-[calc(var(--radius-sm)/2)] border border-[var(--border-strong)] bg-surface-1 text-on-accent transition-[background-color,border-color,color] duration-(--dur-fast) ease-(--ease) outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] disabled:cursor-not-allowed disabled:border-[var(--disabled-border)] disabled:bg-[var(--disabled-bg)] disabled:text-text-muted disabled:data-[state=checked]:border-[var(--disabled-border)] disabled:data-[state=checked]:bg-[var(--disabled-bg)] aria-invalid:border-critical-text aria-invalid:outline-critical-text data-[state=checked]:border-series-1 data-[state=checked]:bg-series-1",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none"
      >
        <CheckIcon className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
