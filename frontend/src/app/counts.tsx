/**
 * The sidebar badges — open leads and surveys pending review.
 *
 * This exists so the shell never imports from a feature. The sidebar owns the
 * badge and reads it here; each feature owns its number and pushes it up.
 * `app/` sits above `features/`, so a feature importing this is fine while
 * the reverse would make the shell undeletable from any feature it referenced.
 *
 * `null` means "not known yet", which is why a badge renders nothing rather
 * than a zero until its page has loaded once. The vanilla console fetched the
 * lead list during boot no matter which page you opened, so it could show the
 * count immediately; here a cold load straight to Settings shows no badge until
 * you visit the inbox. That is a deliberate trade — the alternative is fetching a
 * hundred records on every page load to render one integer.
 */

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

/** Which number a nav item's badge shows — the key nav-config points at. */
export type BadgeKey = "openLeads" | "pendingSurveys";

type CountsApi = {
  openLeads: number | null;
  setOpenLeads: (n: number | null) => void;
  /** Surveys sitting in pending_review — the lead's queue. */
  pendingSurveys: number | null;
  setPendingSurveys: (n: number | null) => void;
};

const CountsContext = createContext<CountsApi>({
  openLeads: null,
  setOpenLeads: () => {},
  pendingSurveys: null,
  setPendingSurveys: () => {},
});

export const useCounts = () => useContext(CountsContext);

export function CountsProvider({ children }: { children: ReactNode }) {
  const [openLeads, setOpenLeads] = useState<number | null>(null);
  const [pendingSurveys, setPendingSurveys] = useState<number | null>(null);

  // Memoised so every consumer of this context does not re-render whenever an
  // unrelated ancestor does.
  const value = useMemo(
    () => ({ openLeads, setOpenLeads, pendingSurveys, setPendingSurveys }),
    [openLeads, pendingSurveys]
  );

  return <CountsContext.Provider value={value}>{children}</CountsContext.Provider>;
}
