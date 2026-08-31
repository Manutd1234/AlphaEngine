"use client"

import * as React from "react"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex min-w-0 flex-col gap-3", className)}
      {...props}
    />
  )
}

function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "inline-flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-[var(--radius-control)] border border-[var(--border-strong)] bg-surface-2 p-1 text-fs-sm text-text-secondary",
        className
      )}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex min-h-[var(--control-h)] shrink-0 items-center justify-center gap-2 rounded-[var(--radius-control)] border border-transparent bg-transparent px-3 py-1 font-semibold whitespace-nowrap transition-[background-color,border-color,color,box-shadow] duration-(--dur-fast) ease-(--ease) hover:border-[var(--border-strong)] hover:bg-[var(--nav-hover-bg)] hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] disabled:pointer-events-none disabled:border-[var(--disabled-border)] disabled:bg-[var(--disabled-bg)] disabled:text-text-muted disabled:data-[state=active]:border-[var(--disabled-border)] disabled:data-[state=active]:bg-[var(--disabled-bg)] disabled:data-[state=active]:text-text-muted data-[state=active]:border-[var(--border-strong)] data-[state=active]:bg-[var(--control-selected-bg)] data-[state=active]:text-text-primary data-[state=active]:[box-shadow:inset_0_-2px_0_var(--series-1),var(--shadow-control)]",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn(
        "min-w-0 flex-1 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--series-1)]",
        className
      )}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
