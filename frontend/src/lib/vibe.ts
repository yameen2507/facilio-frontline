/**
 * The platform client.
 *
 * Created at module scope, not inside a provider effect: it must exist before the
 * first component renders, and a client constructed in an effect is briefly
 * undefined for anything that reads it during the first pass.
 *
 * The SDK is generic over its response types (`executeFunction<T>`), so the shapes
 * this app expects are declared here and in each feature's `types/` — the SDK
 * asserts nothing about them.
 */

import { createVibe } from "@facilio/vibe-sdk";

export const vibe = createVibe();

/** What `getCurrentUser()` returns for this org. */
export type Me = {
  user?: { name?: string; email?: string };
  org?: { orgId?: number | string };
};

/**
 * Every handler in this app lives in the one `lead` function. Named here so a
 * rename is a single edit rather than a search across four feature modules.
 */
export const FUNCTION = "lead";
