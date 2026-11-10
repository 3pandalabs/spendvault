import * as React from "react";
import { cn } from "@/lib/utils";

// AdVault's field style. text-base below md keeps iOS from zooming on focus.
export const fieldBase =
  "w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-base text-zinc-100 placeholder:text-zinc-500 focus:border-amber-400/60 focus:outline-none focus:ring-1 focus:ring-amber-400/60 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input type={type} ref={ref} className={cn(fieldBase, "flex h-10", className)} {...props} />
  ),
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(fieldBase, "flex min-h-24 resize-y", className)} {...props} />
));
Textarea.displayName = "Textarea";

export const Label = ({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
  <label className={cn("text-sm font-medium leading-none text-zinc-300", className)} {...props} />
);
