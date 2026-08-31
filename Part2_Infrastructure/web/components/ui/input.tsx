import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-[var(--control-h)] w-full min-w-0 rounded-[var(--radius-control)] border border-[var(--border-strong)] bg-surface-1 px-3 py-1 text-fs-body text-text-primary transition-[background-color,border-color,box-shadow] duration-(--dur-fast) ease-(--ease) outline-none selection:bg-[var(--state-info-bg)] selection:text-text-primary file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-fs-sm file:font-semibold file:text-text-primary placeholder:text-text-muted disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-[var(--disabled-border)] disabled:bg-[var(--disabled-bg)] disabled:text-text-muted disabled:placeholder:text-text-muted",
        "focus-visible:border-series-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
        "aria-invalid:border-critical-text aria-invalid:outline-critical-text",
        className
      )}
      {...props}
    />
  )
}

export { Input }
