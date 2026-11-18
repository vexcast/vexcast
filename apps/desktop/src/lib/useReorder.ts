import { useState } from "react";

/**
 * Minimal HTML5 drag-and-drop reordering for vertical lists.
 * `ids` is the displayed order; `onReorder` receives the new displayed order.
 */
export function useReorder<T extends string | number>(ids: T[], onReorder: (next: T[]) => void) {
  const [dragId, setDragId] = useState<T | null>(null);
  const [over, setOver] = useState<{ id: T; after: boolean } | null>(null);

  const rowProps = (id: T) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      setDragId(id);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(id));
    },
    onDragOver: (e: React.DragEvent) => {
      if (!dragId) return;
      e.preventDefault();
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      if (over?.id !== id || over.after !== after) setOver({ id, after });
    },
    onDragLeave: () => {},
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      if (dragId && over && dragId !== over.id) {
        const next = ids.filter((x) => x !== dragId);
        let idx = next.indexOf(over.id);
        if (over.after) idx += 1;
        next.splice(idx, 0, dragId);
        if (next.join() !== ids.join()) onReorder(next);
      }
      setDragId(null);
      setOver(null);
    },
    onDragEnd: () => {
      setDragId(null);
      setOver(null);
    },
  });

  /** "before" | "after" | null indicator for a row. */
  const indicator = (id: T): "before" | "after" | null => (over && over.id === id && dragId !== id ? (over.after ? "after" : "before") : null);

  return { rowProps, indicator, dragId };
}
