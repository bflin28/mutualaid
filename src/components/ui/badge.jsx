import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva } from "class-variance-authority"
import { cn } from "./utils"

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 gap-1 transition-colors overflow-hidden",
  {
    variants: {
      variant: {
        default: "border-transparent bg-green-600 text-white",
        secondary: "border-transparent bg-gray-100 text-gray-900",
        destructive: "border-transparent bg-red-500 text-white",
        outline: "text-gray-700 border-gray-300",
        green: "border-green-200 bg-green-50 text-green-700",
        blue: "border-blue-200 bg-blue-50 text-blue-700",
        purple: "border-purple-200 bg-purple-50 text-purple-700",
        orange: "border-orange-200 bg-orange-50 text-orange-700",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({ className, variant, asChild = false, ...props }) {
  const Comp = asChild ? Slot : "span"

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
