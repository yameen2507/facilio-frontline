/**
 * The transient confirmation strip.
 *
 * A provider plus a `useToast()` hook rather than a module-level function: an
 * action deep in a feature module needs to report without being handed a callback
 * through four layers of props.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

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
        className={`toast${visible ? " on" : ""}${message.bad ? " bad" : ""}`}
        role="status"
        aria-live="polite"
      >
        {message.text}
      </div>
    </ToastContext.Provider>
  );
}
