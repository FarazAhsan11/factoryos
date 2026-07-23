import * as React from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

interface TextFieldProps extends React.ComponentProps<"input"> {
  /** Field label rendered above the input. */
  label: string;
  /** Optional leading icon (lucide). */
  icon?: LucideIcon;
  /** Optional node rendered to the right of the label (e.g. a "Forgot?" link). */
  labelAction?: React.ReactNode;
  /** Optional node rendered inside, at the input's trailing edge (e.g. a show-password toggle). */
  trailing?: React.ReactNode;
}

/**
 * Labeled input with an optional leading icon, trailing adornment, and a
 * label-row action. The shared field style for FactoryOS forms.
 */
export function TextField({
  label,
  id,
  icon: Icon,
  labelAction,
  trailing,
  className,
  ...props
}: TextFieldProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-xs font-medium text-[#475569]">
          {label}
        </label>
        {labelAction}
      </div>
      <div className="relative">
        {Icon && (
          <Icon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#94A3B8]" />
        )}
        <input
          id={id}
          className={cn(
            "h-12 w-full rounded-xl border border-transparent bg-[#F1F4F9] px-4 text-sm text-[#0F1B34] outline-none transition placeholder:text-[#94A3B8] focus:border-[#2563EB] focus:bg-white focus:ring-4 focus:ring-[#2563EB]/12",
            Icon && "pl-10",
            trailing && "pr-11",
            className
          )}
          {...props}
        />
        {trailing}
      </div>
    </div>
  );
}
