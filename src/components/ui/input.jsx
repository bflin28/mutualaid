import * as React from "react"
import { cn } from "./utils"

function Input({ className, type, ...props }) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 py-1 text-sm transition-colors placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Input }
