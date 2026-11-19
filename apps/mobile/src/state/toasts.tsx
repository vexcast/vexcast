import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

export type ToastLevel = "info" | "success" | "warning" | "error";
export interface Toast {
  id: number;
  level: ToastLevel;
  message: string;
}

interface ToastValue {
  toasts: Toast[];
  show: (message: string, level?: ToastLevel) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (message: string, level: ToastLevel = "info") => {
      const id = nextId.current++;
      setToasts((ts) => (ts.some((x) => x.message === message) ? ts : [...ts.slice(-2), { id, level, message }]));
      setTimeout(() => dismiss(id), level === "error" ? 4500 : 2800);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toasts, show, dismiss }), [toasts, show, dismiss]);
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast(): ToastValue {
  const v = useContext(ToastContext);
  if (!v) throw new Error("useToast outside ToastProvider");
  return v;
}
