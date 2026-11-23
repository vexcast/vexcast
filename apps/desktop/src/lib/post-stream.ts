import { create } from "zustand";
import type { SessionSummary } from "@vexcast/protocol";

// Kept apart from the dialog: store.ts imports this, and the dialog's imports lead back to store.ts.

export interface SessionEnded {
  id: string;
  title: string;
  summary: SessionSummary;
  droppedPct: number;
}

export const usePostStream = create<{ ended: SessionEnded | null }>(() => ({ ended: null }));

/** Called when the core reports that a stream ended (WebSocket `session_ended`). */
export function showPostStream(ended: SessionEnded) {
  usePostStream.setState({ ended });
}
