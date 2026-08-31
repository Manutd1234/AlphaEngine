import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-[var(--radius-pill)] border px-2 py-0.5 text-fs-xs font-semibold whitespace-nowrap transition-[background-color,border-color,color,opacity] duration-(--dur-fast) ease-(--ease) outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--series-1)] aria-invalid:border-critical-text aria-invalid:outline-critical-text [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default:
          "border-[color-mix(in_srgb,var(--series-1)_28%,var(--border))] bg-[color-mix(in_srgb,var(--series-1)_8%,var(--surface-1))] text-series-1 [a&]:hover:bg-[color-mix(in_srgb,var(--series-1)_13%,var(--surface-1))]",
        secondary:
          "border-border bg-surface-2 text-text-secondary [a&]:hover:bg-surface-3",
        destructive:
          "border-[color-mix(in_srgb,var(--status-critical)_35%,var(--border))] bg-[color-mix(in_srgb,var(--status-critical)_8%,var(--surface-1))] text-critical-text [a&]:hover:bg-[color-mix(in_srgb,var(--status-critical)_13%,var(--surface-1))]",
        outline:
          "border-border bg-surface-1 text-text-primary [a&]:hover:bg-surface-2",
        ghost: "border-transparent text-text-secondary [a&]:hover:bg-surface-2 [a&]:hover:text-text-primary",
        link: "border-transparent text-series-1 underline-offset-4 [a&]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
