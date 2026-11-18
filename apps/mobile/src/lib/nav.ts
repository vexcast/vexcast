import { router } from "expo-router";

/** Clears any modal/stack history and lands on the dashboard. */
export function goHome() {
  try {
    if (router.canDismiss()) router.dismissAll();
  } catch {
    /* nothing to dismiss */
  }
  router.replace("/dashboard");
}

/** Set by the QR scanner's "enter manually" button; the connect screen consumes it on focus. */
let manualRequested = false;
export function requestManualConnect() {
  manualRequested = true;
}
export function takeManualRequest(): boolean {
  const v = manualRequested;
  manualRequested = false;
  return v;
}
