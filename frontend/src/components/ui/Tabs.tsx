"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface TabsContextValue {
  value: string;
  setValue: (v: string) => void;
}

const TabsContext = React.createContext<TabsContextValue | null>(null);

function useTabsContext(): TabsContextValue {
  const ctx = React.useContext(TabsContext);
  if (!ctx) throw new Error("Tabs subcomponents must be used within <Tabs>");
  return ctx;
}

export interface TabsProps {
  value?: string;
  defaultValue: string;
  onValueChange?: (v: string) => void;
  className?: string;
  children: React.ReactNode;
}

export function Tabs({
  value: controlled,
  defaultValue,
  onValueChange,
  className,
  children,
}: TabsProps): React.ReactElement {
  const [internal, setInternal] = React.useState(defaultValue);
  const value = controlled ?? internal;

  const setValue = React.useCallback(
    (v: string) => {
      if (controlled === undefined) setInternal(v);
      onValueChange?.(v);
    },
    [controlled, onValueChange],
  );

  const ctx = React.useMemo(() => ({ value, setValue }), [value, setValue]);

  return (
    <TabsContext.Provider value={ctx}>
      <div className={cn("flex flex-col gap-4", className)}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex flex-wrap gap-1 rounded-xl border border-ink/10 bg-paper-soft/80 p-1",
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface TabsTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
}

export function TabsTrigger({
  value,
  className,
  children,
  ...rest
}: TabsTriggerProps): React.ReactElement {
  const ctx = useTabsContext();
  const active = ctx.value === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => ctx.setValue(value)}
      className={cn(
        "rounded-lg px-4 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-gold/15 text-gold-soft shadow-[inset_0_1px_0_rgba(201,164,94,0.25)]"
          : "text-ink-muted hover:text-ink",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function TabsContent({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: React.ReactNode;
}): React.ReactElement | null {
  const ctx = useTabsContext();
  if (ctx.value !== value) return null;
  return (
    <div role="tabpanel" className={cn("focus:outline-none", className)}>
      {children}
    </div>
  );
}
