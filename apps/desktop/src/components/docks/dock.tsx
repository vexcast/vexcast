import type { LucideIcon } from "lucide-react";
import { createContext, forwardRef, type ReactNode, useContext, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** True inside the dockview workspace: the tab already shows the title. */
export const InWorkspace = createContext(false);

/** OBS-style dock: title bar, content, optional bottom toolbar. */
export function Dock({ title, actions, toolbar, children, className, testId }: { title: string; actions?: ReactNode; toolbar?: ReactNode; children: ReactNode; className?: string; testId?: string }) {
  const inWs = useContext(InWorkspace);
  return (
    <section className={cn("flex h-full min-h-0 min-w-0 flex-col bg-background", className)} data-testid={testId}>
      {!inWs ? (
        <header className="flex h-8 shrink-0 items-center gap-1 border-b px-2.5">
          <h2 className="truncate text-xs font-medium">{title}</h2>
          <div className="ml-auto flex items-center gap-0.5">{actions}</div>
        </header>
      ) : (
        actions && <header className="flex h-8 shrink-0 items-center justify-end gap-0.5 border-b px-1.5">{actions}</header>
      )}
      <div className="relative min-h-0 flex-1">{children}</div>
      {toolbar && <footer className="flex h-9 shrink-0 items-center gap-0.5 border-t px-1">{toolbar}</footer>}
    </section>
  );
}

export const ToolButton = forwardRef<
  HTMLButtonElement,
  { icon: LucideIcon; label: string; onClick?: () => void; disabled?: boolean; active?: boolean; className?: string; testId?: string } & Omit<React.ComponentProps<"button">, "ref">
>(function ToolButton({ icon: Icon, label, onClick, disabled, active, className, testId, ...rest }, ref) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          ref={ref}
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          onClick={onClick}
          disabled={disabled}
          data-active={active || undefined}
          className={cn("text-muted-foreground hover:text-foreground data-[active]:bg-accent data-[active]:text-foreground", className)}
          data-testid={testId}
          {...rest}
        >
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
});

/** Inline rename field (Enter = save, Esc = cancel). */
export function InlineRename({ value, onDone }: { value: string; onDone: (v: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <Input
      ref={ref}
      defaultValue={value}
      className="h-6 px-1.5 py-0 text-sm"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") onDone(e.currentTarget.value.trim() || null);
        if (e.key === "Escape") onDone(null);
      }}
      onBlur={(e) => onDone(e.currentTarget.value.trim() || null)}
    />
  );
}

export function EmptyHint({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 p-4 text-center">
      <p className="text-sm text-muted-foreground">{title}</p>
      {hint && <p className="text-xs text-muted-foreground/80">{hint}</p>}
    </div>
  );
}
