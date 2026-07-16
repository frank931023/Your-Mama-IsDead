import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StepperStep {
  id: string;
  label: string;
  description?: string;
}

export interface StepperProps {
  steps: readonly StepperStep[];
  current: number; // zero-indexed
  className?: string;
}

export function Stepper({ steps, current, className }: StepperProps): React.ReactElement {
  return (
    <ol className={cn("flex w-full flex-wrap items-start gap-4", className)}>
      {steps.map((s, idx) => {
        const done = idx < current;
        const active = idx === current;
        return (
          <li key={s.id} className="flex flex-1 min-w-[140px] items-start gap-3">
            <div
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold transition-colors",
                done && "border-gold/70 bg-gold text-paper",
                active && "border-gold/60 bg-gold/10 text-gold-soft shadow-glow",
                !done && !active && "border-ink/15 bg-paper-soft text-ink-muted",
              )}
              aria-current={active ? "step" : undefined}
            >
              {done ? <Check className="h-4 w-4" aria-hidden /> : idx + 1}
            </div>
            <div className="flex flex-col">
              <span
                className={cn(
                  "text-sm font-medium",
                  active ? "text-ink" : "text-ink-muted",
                )}
              >
                {s.label}
              </span>
              {s.description ? (
                <span className="text-xs text-ink-muted">{s.description}</span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
