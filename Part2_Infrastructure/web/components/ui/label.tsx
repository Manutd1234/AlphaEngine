"use client"

import * as React from "react"
import { Label as LabelPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-fs-sm leading-none font-semibold text-text-secondary select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:text-text-muted peer-disabled:cursor-not-allowed peer-disabled:text-text-muted",
        className
      )}
      {...props}
    />
  )
}

export { Label }
