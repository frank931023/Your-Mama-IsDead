import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "outline" | "danger";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const variants: Record<Variant, string> = {
  // 鎏金主按鈕:上亮下沉的燭光漸層 + 輝光,是全站唯一的高飽和元素
  primary:
    "bg-gradient-to-b from-gold-soft via-gold to-gold-dark text-paper font-semibold shadow-glow hover:brightness-110 active:brightness-95 disabled:opacity-40 disabled:shadow-none",
  secondary:
    "border border-gold/35 bg-gold/10 text-gold-soft hover:border-gold/60 hover:bg-gold/15 active:bg-gold/20 disabled:opacity-40",
  ghost:
    "bg-transparent text-ink-muted hover:bg-ink/5 hover:text-ink disabled:text-ink-muted/50",
  outline:
    "bg-transparent text-ink border border-ink/15 hover:border-gold/50 hover:text-gold-soft disabled:opacity-40",
  danger:
    "bg-red-500/90 text-white hover:bg-red-500 active:bg-red-600 disabled:opacity-40",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", loading, disabled, children, ...rest }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-lg font-medium",
          "transition-all duration-200 active:scale-[0.985] focus-visible:outline-none",
          "focus-visible:ring-2 focus-visible:ring-gold/70 focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
          "disabled:cursor-not-allowed disabled:active:scale-100",
          variants[variant],
          sizes[size],
          className,
        )}
        {...rest}
      >
        {loading ? (
          <span
            className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden
          />
        ) : null}
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";
