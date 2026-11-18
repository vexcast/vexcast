import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { checkForUpdate, dismissUpdate, getDismissedUpdate, type UpdateStatus } from "@/lib/updates";

interface UpdatesValue {
  status: UpdateStatus | null;
  checking: boolean;
  /** True when a newer release exists and the user has not dismissed it. */
  showBanner: boolean;
  check: (force?: boolean) => Promise<void>;
  dismiss: () => void;
}

const UpdatesContext = createContext<UpdatesValue | null>(null);

export function UpdatesProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async (force = false) => {
    setChecking(true);
    try {
      setStatus(await checkForUpdate(force));
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    getDismissedUpdate().then(setDismissed);
    void check(false); // at most once a day (cached)
  }, [check]);

  const dismiss = useCallback(() => {
    if (status?.latestVersion) {
      setDismissed(status.latestVersion);
      void dismissUpdate(status.latestVersion);
    }
  }, [status]);

  const value = useMemo<UpdatesValue>(
    () => ({
      status,
      checking,
      showBanner: !!status?.updateAvailable && status.latestVersion !== dismissed,
      check,
      dismiss,
    }),
    [status, checking, dismissed, check, dismiss],
  );
  return <UpdatesContext.Provider value={value}>{children}</UpdatesContext.Provider>;
}

export function useUpdates(): UpdatesValue {
  const v = useContext(UpdatesContext);
  if (!v) throw new Error("useUpdates outside UpdatesProvider");
  return v;
}
