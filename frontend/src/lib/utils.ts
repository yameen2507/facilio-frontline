import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* Whether a dialog may put the cursor in its first field on open. On a phone
   that gesture throws the soft keyboard over the form before the reader has
   seen the title, so we hand back false and let them tap the field they want.
   Two terms: the width one is what a narrowed desktop window matches (and it
   tracks the 768px breakpoint the rest of the app uses), the pointer one
   catches a tablet that is wider than that but still typing on glass.
   Read at render, never through a hook — React honours autoFocus only at
   mount, so a value that arrives in an effect arrives after the keyboard. */
export function autoFocusField() {
  if (typeof window === "undefined") return false;
  return !(
    window.matchMedia("(max-width: 767px)").matches ||
    window.matchMedia("(pointer: coarse)").matches
  );
}
