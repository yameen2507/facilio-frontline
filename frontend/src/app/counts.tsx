/**
 * The open-lead badge in the sidebar.
 *
 * This exists so the shell never imports from a feature. The sidebar owns the
 * badge and reads it here; the leads feature owns the data and pushes the number
 * up. `app/` sits above `features/`, so a feature importing this is fine while
 * the reverse would make the shell undeletable from any feature it referenced.
 *
 * `null` means "not known yet", which is why the badge renders nothing rather
 * than a zero until the inbox has loaded once. The vanilla console fetched the
 * lead list during boot no matter which page you opened, so it could show the
 * count immediately; here a cold load straight to Settings shows no badge until
 * you visit the inbox. That is a deliberate trade — the alternative is fetching a
 * hundred leads on every page load to render one integer.
 */

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type CountsApi = {
  openLeads: number | null;
  setOpenLeads: (n: number | null) => void;
};

const CountsContext = createContext<CountsApi>({ openLeads: null, setOpenLeads: () => {} });

export const useCounts = () => useContext(CountsContext);

export function CountsProvider({ children }: { children: ReactNode }) {
  const [openLeads, setOpenLeads] = useState<number | null>(null);

  // Memoised so every consumer of this context does not re-render whenever an
  // unrelated ancestor does.
  const value = useMemo(() => ({ openLeads, setOpenLeads }), [openLeads]);

  return <CountsContext.Provider value={value}>{children}</CountsContext.Provider>;
}
