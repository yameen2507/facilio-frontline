import React from 'react'
import { Icon } from '../ui/Icon'

/**
 * Small shared pieces for the layout.
 *
 * WHY THESE ARE NOT DSM COMPONENTS. This file originally used `FDivider`,
 * `FButton` and `FIcon` from `@facilio/dsm-react-wrapper`. Importing anything from
 * that package's barrel registers EVERY DSM web component — Stencil's
 * `defineCustomElement` calls are side effects, so nothing tree-shakes — and the
 * bundle went from 90kB to 1.2MB gzipped for these three. A 13× cost for a
 * divider and a chevron is not a trade worth making.
 *
 * The real value of DSM here is its TOKENS, and those are kept: `dsm-core.css` is
 * imported in main.tsx, which is what themes this whole app and drives
 * `:root[data-theme='dark']`. Only the components are replaced — a divider is a
 * 1px div, and the chevron comes from the same Facilio icon CDN that DSM's FIcon
 * reads from.
 *
 * `HeaderIconButton`, `KbdChip` and `OrgSwitcher` were dropped along with the
 * helpdesk topbar and command palette that used them.
 */

/** A hairline rule. A background-coloured div, not a border, so it never adds to
    a parent's box and can't knock a fixed-height row off by a pixel. */
export const HorizontalDivider: React.FC = () => (
  <div
    aria-hidden
    style={{
      width: '100%',
      height: '1px',
      flexShrink: 0,
      backgroundColor: 'var(--colors-border-neutral-base-subtle)',
    }}
  />
)

export const VerticalDivider: React.FC = () => (
  <div
    aria-hidden
    style={{
      width: '1px',
      height: '20px',
      flexShrink: 0,
      backgroundColor: 'var(--colors-border-neutral-base-subtle)',
    }}
  />
)

export const ChevronDown: React.FC<{ open: boolean }> = ({ open }) => (
  <div
    style={{
      display: 'flex',
      flexShrink: 0,
      transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
      transition: 'transform 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
      color: 'var(--colors-icon-neutral-light)',
    }}
  >
    <Icon name="chevronDown" size={16} />
  </div>
)
