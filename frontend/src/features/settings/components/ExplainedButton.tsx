/**
 * shadcn's Button, with the house disabled-title fix (ui/Button.tsx does the
 * same for the app wrapper): shadcn's disabled state sets pointer-events-none,
 * which also swallows the title tooltip — the one explanation a disabled
 * control can give. The inert span takes over hover duty only in that state.
 */

import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";

export function ExplainedButton({ title, disabled, ...props }: ComponentProps<typeof Button>) {
  const button = <Button disabled={disabled} title={disabled ? undefined : title} {...props} />;
  return disabled && title ? <span title={title}>{button}</span> : button;
}
