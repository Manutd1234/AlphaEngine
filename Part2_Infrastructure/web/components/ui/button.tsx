import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-[var(--radius-control)] text-fs-body font-semibold whitespace-nowrap transition-[background-color,border-color,color,box-shadow,opacity] duration-(--dur-fast) ease-(--ease) outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-critical-text aria-invalid:outline-critical-text [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "border border-series-1 bg-series-1 text-on-accent hover:brightness-[0.92]",
        destructive:
          "border border-critical-text bg-critical-text text-on-accent hover:brightness-[0.92] focus-visible:outline-[var(--critical-text)]",
        outline:
          "border border-[var(--border-strong)] bg-surface-1 text-text-primary hover:bg-surface-2",
        secondary:
          "border border-[var(--border-strong)] bg-surface-2 text-text-primary hover:bg-surface-3",
        ghost:
          "border border-transparent bg-transparent text-text-secondary hover:bg-surface-2 hover:text-text-primary",
        link: "border border-transparent bg-transparent text-series-1 underline-offset-4 hover:underline",
      },
      size: {
        default: "h-[var(--control-h)] px-3 has-[>svg]:px-2.5",
        xs: "h-6 gap-1 px-2 text-fs-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1.5 px-2.5 text-fs-sm has-[>svg]:px-2",
        lg: "h-10 px-5 text-fs-md has-[>svg]:px-3.5",
        icon: "size-[var(--control-h)]",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
