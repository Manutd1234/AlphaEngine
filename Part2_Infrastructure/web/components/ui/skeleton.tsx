import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("rounded-[var(--radius-sm)] bg-surface-3", className)}
      {...props}
    />
  )
}

export { Skeleton }
