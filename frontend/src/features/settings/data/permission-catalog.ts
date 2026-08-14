/**
 * The permission catalog — every module and action the matrix can grant.
 *
 * This file is the single source of the vocabulary (spec §9): the Permissions
 * page renders its rows from it, and any `can(module, action)` call site names
 * ids from it. The backend deliberately does NOT hold a copy — it stores a
 * role's matrix opaquely and validates only its shape, because enforcement is
 * client-side (the functions runtime carries no caller identity) and a second
 * copy of this list would only drift.
 *
 * An action listed here does not have to have a consumer yet — the matrix is
 * configurable ahead of the buttons (spec §9 requires exactly that):
 *
 *   - leads `send_email`, `delete`, `export` have no buttons in the leads UI;
 *     when one ships it takes its check from PERMISSION_OF in
 *     features/leads/actions.ts.
 *   - the `settings` actions gate nothing today: this pass's gating reference
 *     is the LEADS feature only, by decision — the Settings surfaces
 *     themselves (these tabs included) are ungated until a later pass wires
 *     `can("settings", …)` through them.
 */

export type PermModule =
  | "leads"
  | "accounts"
  | "surveys"
  | "templates"
  | "proposals"
  | "rate_cards"
  | "settings";

export type PermAction = { id: string; label: string };

export const PERMISSION_CATALOG: { module: PermModule; label: string; actions: PermAction[] }[] = [
  {
    module: "leads",
    label: "Leads",
    // Spec §9's action list, verbatim.
    actions: [
      { id: "view", label: "View" },
      { id: "create", label: "Create" },
      { id: "edit", label: "Edit" },
      { id: "delete", label: "Delete" },
      { id: "assign", label: "Assign" },
      { id: "qualify", label: "Qualify" },
      { id: "disqualify", label: "Disqualify" },
      { id: "convert", label: "Convert" },
      { id: "send_email", label: "Send email" },
      { id: "add_note", label: "Add note" },
      { id: "export", label: "Export" },
    ],
  },
  {
    module: "accounts",
    label: "Accounts",
    actions: [
      { id: "view", label: "View" },
      { id: "create", label: "Create" },
      { id: "edit", label: "Edit" },
      { id: "export", label: "Export" },
    ],
  },
  {
    module: "surveys",
    label: "Surveys",
    actions: [
      { id: "view", label: "View" },
      { id: "create", label: "Create" },
      { id: "edit", label: "Edit" },
      { id: "assign", label: "Assign surveyors" },
      { id: "schedule", label: "Schedule visits" },
      { id: "submit", label: "Submit" },
      { id: "cancel", label: "Cancel" },
    ],
  },
  {
    module: "templates",
    label: "Templates",
    actions: [
      { id: "view", label: "View" },
      { id: "create", label: "Create" },
      { id: "edit", label: "Edit" },
      { id: "publish", label: "Publish" },
      { id: "archive", label: "Archive" },
    ],
  },
  {
    module: "proposals",
    label: "Proposals",
    // The lifecycle, one action per move — because these are genuinely
    // different authorities and a single "edit" would collapse them. Approving
    // a deviation, sending a frozen price to a client and recording what the
    // client answered are three jobs that three different people do.
    actions: [
      { id: "view", label: "View" },
      { id: "create", label: "Create" },
      { id: "edit", label: "Edit lines and terms" },
      { id: "submit", label: "Submit for approval" },
      // Approving a DEVIATION from the rate card. The card's own approval is
      // the `rate_cards` module below, and conflating the two is how a
      // salesperson ends up able to sign off their own discount.
      { id: "approve", label: "Approve deviations" },
      { id: "return", label: "Return to draft" },
      { id: "send", label: "Send to client" },
      { id: "withdraw", label: "Withdraw" },
      { id: "respond", label: "Record client response" },
      { id: "revise", label: "Raise a revision" },
      { id: "export", label: "Export" },
    ],
  },
  {
    module: "rate_cards",
    label: "Rate cards",
    // Its own module rather than an action on proposals: a rate card is the
    // PRICE LIST every proposal draws from, so who may change one is a much
    // larger question than who may price a job.
    actions: [
      { id: "view", label: "View" },
      { id: "create", label: "Create" },
      { id: "edit", label: "Edit rows" },
      { id: "activate", label: "Activate" },
      { id: "archive", label: "Archive" },
      { id: "import", label: "Import" },
    ],
  },
  {
    module: "settings",
    label: "Settings",
    actions: [
      { id: "view", label: "View" },
      { id: "edit", label: "Edit" },
      { id: "manage_users", label: "Manage users" },
      { id: "manage_roles", label: "Manage roles" },
      { id: "manage_permissions", label: "Manage permissions" },
    ],
  },
];
