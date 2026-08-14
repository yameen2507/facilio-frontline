/**
 * The transient confirmation strip.
 *
 * A provider plus a `useToast()` hook rather than a module-level function: an
 * action deep in a feature module needs to report without being handed a callback
 * through four layers of props.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const HOLD_MS = 3200;

type ToastFn = (message: string, bad?: boolean) => void;

const ToastContext = createContext<ToastFn>(() => {
  // No provider mounted. Silently dropping a toast is right — a missing
  // confirmation must never break the action that succeeded.
});

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  // Visibility is split from the message on purpose. Clearing the text to hide it
  // would empty the strip at the instant the fade-out begins, so the user watches
  // a blank box slide away instead of reading what happened.
  const [message, setMessage] = useState<{ text: string; bad: boolean }>({ text: "", bad: false });
  const [visible, setVisible] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback<ToastFn>((text, bad = false) => {
    setMessage({ text, bad });
    setVisible(true);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setVisible(false), HOLD_MS);
  }, []);

  // A pending timer firing after unmount would set state on a dead component.
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        className={cn(
          // The offset clears the phone tab bar (--bottom-nav is 0 above `md`,
          // where there isn't one) and, on a home-screen install, the home
          // indicator under it. Both are viewport-fixed, so without this the
          // strip reports from underneath the navigation.
          "pointer-events-none fixed bottom-[calc(var(--bottom-nav)+env(safe-area-inset-bottom,0px)+--spacing(6))] left-1/2 z-20 -translate-x-1/2 rounded-md px-4 py-2.5 text-sm shadow-md transition-opacity duration-200",
          message.bad ? "bg-destructive text-white" : "bg-foreground text-background",
          visible ? "opacity-100" : "opacity-0",
        )}
        role="status"
        aria-live="polite"
      >
        {message.text}
      </div>
    </ToastContext.Provider>
  );
}
