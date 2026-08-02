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
            "h-10 w-full rounded-md border border-ink/20 bg-paper px-3 py-2",
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
Input.displayName = "Input";
