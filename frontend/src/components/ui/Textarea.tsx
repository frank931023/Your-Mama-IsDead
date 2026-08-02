import * as React from "react";
import { cn } from "@/lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  errorText?: string;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, hint, errorText, id, rows = 4, ...rest }, ref) => {
    const fallbackId = React.useId();
    const inputId = id ?? fallbackId;
    return (
      <div className="flex flex-col gap-1.5">
        {label ? (
          <label htmlFor={inputId} className="text-sm font-medium text-ink">
            {label}
          </label>
        ) : null}
        <textarea
          ref={ref}
          id={inputId}
          rows={rows}
          className={cn(
            "w-full rounded-md border border-ink/20 bg-paper px-3 py-2",
            "text-sm text-ink placeholder:text-ink-muted",
            "focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/40",
            "disabled:cursor-not-allowed disabled:opacity-60",
            errorText && "border-red-600 focus:border-red-600 focus:ring-red-300",
            className,
          )}
          aria-invalid={errorText ? true : undefined}
          {...rest}
        />
        {errorText ? (
          <p className="text-xs text-red-700">{errorText}</p>
        ) : hint ? (
          <p className="text-xs text-ink-muted">{hint}</p>
        ) : null}
      </div>
    );
  },
);
Textarea.displayName = "Textarea";
