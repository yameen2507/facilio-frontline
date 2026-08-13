/**
 * The auth gate.
 *
 * GATE BEFORE YOU MOUNT. The authenticated route tree does not exist until the
 * session check has passed — the app does not render the real chrome behind a
 * sign-in prompt and hope nobody opens devtools.
 *
 * `getCurrentUser()` is the single source of truth for "signed in?". A null result
 * drives the prompt; a 401 from some later data call never does.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { vibe, type Me } from "../lib/vibe";
import { Button } from "../ui/Button";
import { Empty } from "../ui/States";

const UserContext = createContext<Me>({});

export const useUser = () => useContext(UserContext);

/** The signed-in user's email — the actor every mutation is attributed to. */
export const useActor = (): string => useUser().user?.email ?? "";

export function AuthGate({ children }: { children: ReactNode }) {
  // Three states, and they are not the same: `undefined` is "still asking",
  // `null` is "asked, not signed in". Collapsing them shows the sign-in prompt
  // for a second to someone who is already signed in.
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    vibe
      .getCurrentUser<Me>()
      .then((result) => {
        if (live) setMe(result);
      })
      .catch(() => {
        // An unreachable identity service is indistinguishable from being signed
        // out, and both are recovered the same way.
        if (live) setMe(null);
      });
    return () => {
      live = false;
    };
  }, []);

  if (me === undefined) {
    return (
      <div className="grid h-svh place-items-center">
        <span className="text-muted-foreground text-xs">Checking your session…</span>
      </div>
    );
  }

  if (me === null) {
    return (
      <div className="grid h-svh place-items-center">
        <Empty
          title="You need to sign in"
          body="Frontline uses your Facilio account."
          action={
            <Button variant="primary" onClick={() => vibe.login()}>
              Sign in
            </Button>
          }
        />
      </div>
    );
  }

  return <UserContext.Provider value={me}>{children}</UserContext.Provider>;
}
