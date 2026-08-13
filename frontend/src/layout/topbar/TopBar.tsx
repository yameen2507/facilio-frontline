/**
 * The 56px top bar.
 *
 * Written for Frontline rather than ported. The helpdesk's TopBar carried a
 * project switcher, an app-portfolio switcher, a trial-status chip and a
 * project-setup wizard — about 2,000 lines for concepts this product does not
 * have. Shipping them would have put controls on screen for projects and trials
 * that do not exist.
 *
 * What is left is what Frontline actually has: the rail toggle, who you are, the
 * org you are in, the theme control and sign-out.
 *
 * The height is load-bearing: MainContent derives `--height-custom` from
 * `calc(... - 56px)`, so a change here needs the same change there.
 */

import { Icon } from '../../ui/Icon'
import ProfileMenu from './ProfileMenu'

export const TOPBAR_HEIGHT = 56

export default function TopBar({
  sidebarCollapsed,
  onToggleSidebar,
}: {
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
}) {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--spacing-container-large)',
        height: `${TOPBAR_HEIGHT}px`,
        flexShrink: 0,
        padding: '0 var(--spacing-container-large)',
        backgroundColor: 'var(--colors-background-container)',
        // A painted line rather than a border: a border would add to the 56px box
        // and put MainContent's height calc out by a pixel.
        boxShadow: 'inset 0 -1px 0 0 var(--colors-border-neutral-base-subtle)',
        boxSizing: 'border-box',
      }}
    >
      <button
        type="button"
        className="icon-btn"
        onClick={onToggleSidebar}
        title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-expanded={!sidebarCollapsed}
      >
        <Icon name="panelLeft" size={16} />
      </button>

      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--spacing-container-medium)',
          flexShrink: 0,
        }}
      >
        <span className="mark" aria-hidden="true">
          F
        </span>
        <b style={{ font: 'var(--text-heading-med-14)', color: 'var(--colors-text-main)' }}>Frontline</b>
      </span>

      <span style={{ flex: 1 }} />

      <ProfileMenu />
    </header>
  )
}
