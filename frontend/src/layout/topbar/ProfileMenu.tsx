/**
 * The top-right avatar and its menu.
 *
 * This replaces printing `name · org 2944` as raw text in the bar with a
 * three-segment theme toggle beside it. Every console this was compared against —
 * Framer, Uxcel, Remote, Midday, Magnific — puts identity in a top-right avatar
 * with a menu behind it, and none of them expose a theme control directly in the
 * bar. Midday specifically keeps Theme as a row inside this menu, which is where
 * it has gone.
 *
 * No design-system Popover: the DSM component barrel costs 1.2MB gzipped (see
 * layout/primitives.tsx), and this is a single anchored panel. Closing on outside
 * click and on Escape is the whole behaviour.
 */

import { useEffect, useRef, useState } from 'react'
import { useUser } from '../../app/auth'
import { vibe } from '../../lib/vibe'
import { ThemeSwitcher } from '../../theme/ThemeSwitcher'
import { Icon } from '../../ui/Icon'
import { HorizontalDivider } from '../primitives'

/** "Mohamed Yameen" → "MY"; falls back to the email's first letter. */
function initials(name: string | undefined, email: string | undefined): string {
  const source = (name ?? '').trim()
  if (source) {
    const parts = source.split(/\s+/)
    return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase()
  }
  return (email?.[0] ?? '?').toUpperCase()
}

export default function ProfileMenu() {
  const me = useUser()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return

    const onPointerDown = (e: PointerEvent) => {
      // `composedPath` rather than `contains`: the theme control inside the panel
      // is a real child, but this keeps working if any part of the menu is ever
      // moved into a portal.
      if (!wrapRef.current) return
      if (!e.composedPath().includes(wrapRef.current)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const name = me.user?.name
  const email = me.user?.email

  return (
    <div ref={wrapRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        className="avatar-btn"
        onClick={() => setOpen((v) => !v)}
        title={name ?? email ?? 'Account'}
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {initials(name, email)}
      </button>

      {open ? (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + var(--spacing-container-small))',
            right: 0,
            width: '248px',
            zIndex: 60,
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--spacing-container-medium)',
            padding: 'var(--spacing-container-large)',
            borderRadius: 'var(--border-medium)',
            backgroundColor: 'var(--colors-background-container)',
            boxShadow: 'var(--elevation-light-high)',
            // Inset ring, not a border: the panel is positioned to the pixel and a
            // border would shift its contents by one.
            outline: '1px solid var(--colors-border-neutral-base-subtle)',
            outlineOffset: '-1px',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span
              style={{
                font: 'var(--text-heading-med-14)',
                color: 'var(--colors-text-main)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {name ?? email ?? '…'}
            </span>
            {email && name ? (
              <span
                style={{
                  font: 'var(--text-caption-reg-12)',
                  color: 'var(--colors-text-caption)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {email}
              </span>
            ) : null}
            {me.org?.orgId ? (
              <span style={{ font: 'var(--text-caption-reg-12)', color: 'var(--colors-text-caption)' }}>
                Org {String(me.org.orgId)}
              </span>
            ) : null}
          </div>

          <HorizontalDivider />

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--spacing-container-medium)' }}>
            <span style={{ font: 'var(--text-body-reg-14)', color: 'var(--colors-text-description)' }}>Theme</span>
            <ThemeSwitcher />
          </div>

          <HorizontalDivider />

          <button type="button" className="menu-row" role="menuitem" onClick={() => vibe.logout()}>
            <Icon name="logOut" size={15} />
            <span>Sign out</span>
          </button>
        </div>
      ) : null}
    </div>
  )
}
