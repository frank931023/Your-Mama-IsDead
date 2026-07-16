import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  errorText?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, hint, errorText, id, ...rest }, ref) => {
    const fallbackId = React.useId();
    const inputId = id ?? fallbackId;
    return (
      <div className="flex flex-col gap-1.5">
        {label ? (
          <label htmlFor={inputId} className="text-sm font-medium text-ink">
            {label}
          </label>
        ) : null}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            "h-10 w-full rounded-lg border border-ink/15 bg-paper-soft/50 px-3 py-2",
            "text-sm text-ink placeholder:text-ink-muted/70",
            "transition-colors focus:border-gold/60 focus:bg-paper-soft focus:outline-none focus:ring-2 focus:ring-gold/25",
            "disabled:cursor-not-allowed disabled:opacity-60",
            errorText && "border-red-500/60 focus:border-red-500 focus:ring-red-500/25",
            className,
          )}
          aria-invalid={errorText ? true : undefined}
          {...rest}
        />
        {errorText ? (
          <p className="text-xs text-red-400">{errorText}</p>
        ) : hint ? (
          <p className="text-xs text-ink-muted">{hint}</p>
        ) : null}
      </div>
    );
  },
);
Input.displayName = "Input";
