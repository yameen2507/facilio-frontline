/**
 * The sidebar, as data.
 *
 * Rewritten for Frontline — the version that came with this layout listed the
 * helpdesk's routes (`/tickets`, `/inbox/call-logs`, `/dispatch/policies`), none
 * of which exist here.
 *
 * Icon `name`/`group` pairs are resolved by DSM's FIcon against the same registry
 * as icons.facilio.com, and every pair below was verified to return 200 from that
 * CDN. A wrong pair renders nothing at all rather than erroring, so do not guess
 * one — probe it first:
 *   curl -sI https://icons.facilio.com/icons/svg/<group>/<name>.svg
 *
 * The `accordion` variant is kept in the type because MainNavPanel implements it,
 * but Frontline has no nested surfaces yet, so nothing uses it.
 */

export type NavChild = {
  to: string
  icon: string
  group: string
  label: string
}

export type NavEntry =
  // `hidden` parks an item without deleting its config — deleting loses the work,
  // the flag records that the surface exists but is not shipping.
  | { type: 'item'; to: string; icon: string; group: string; label: string; badge?: boolean; hidden?: boolean }
  | {
      type: 'accordion'
      key: string
      label: string
      icon: string
      group: string
      children: NavChild[]
      hidden?: boolean
    }
  | { type: 'divider' }
  | { type: 'section'; label: string }

/** Where "/" sends you. */
export const DEFAULT_ROUTE = '/leads'

export const NAV_TOP: NavEntry[] = [
  // `badge` shows the open-lead count, fed up from the leads feature through the
  // app-level counts context — so the sidebar still needs no feature import.
  { type: 'item', to: '/leads', icon: 'workorder', group: 'default', label: 'Lead inbox', badge: true },
  { type: 'item', to: '/accounts', icon: 'building', group: 'default', label: 'Accounts' },
  { type: 'divider' },
  { type: 'section', label: 'Customer view' },
  { type: 'item', to: '/chat', icon: 'comment', group: 'default', label: 'Website chat' },
]

/** Pinned to the bottom of the rail by MainNavPanel, away from the modules. */
export const SETTINGS_NAV = {
  to: '/settings',
  icon: 'settings',
  group: 'action',
  label: 'Scope & SLA',
} as const
