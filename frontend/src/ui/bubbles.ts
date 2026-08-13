/**
 * The chat bubble classes, shared by the Chat page, the transcript card on
 * lead detail, and their skeletons. One module because the skeleton rule is
 * that a placeholder reuses the real element's classes — identical geometry by
 * construction, so nothing shifts when the conversation lands.
 */

/** The scrolling message column. */
export const MSGS = "flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4";

/** What either side's bubble shares: cap width, bubble shape, body type. */
const MSG = "max-w-[78%] rounded-xl px-4 py-2.5 text-sm";

/** The agent's bubble — muted surface, anchored left, flat lower-left corner. */
export const MSG_AGENT = `${MSG} bg-muted self-start rounded-bl-sm border`;

/** The visitor's bubble — brand fill, anchored right, flat lower-right corner. */
export const MSG_VISITOR = `${MSG} bg-primary text-primary-foreground self-end rounded-br-sm`;
