import React, { useEffect, useState } from 'react'
import { useTheme } from '../theme/ThemeProvider'
import MainContent from './MainContent'
import Sidebar from './sidebar/Sidebar'
import TopBar from './topbar/TopBar'

interface LayoutProps {
  children: React.ReactNode
}

const SIDEBAR_STORAGE_KEY = 'frontline:sidebarCollapsed'

/**
 * The app shell: top bar, collapsible rail, and the routed page.
 *
 * Ported from the helpdesk console. Two things were removed rather than adapted:
 * the ⌘K command palette (deferred), and the settings-route tracking, which
 * existed so a settings sub-nav could return you to where you were — Frontline's
 * settings is a single page with nothing to return from.
 */
const Layout: React.FC<LayoutProps> = ({ children }) => {
  // Mount the theme context so its attribute stays in sync with this view.
  useTheme()

  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true'
    } catch {
      return false
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, sidebarCollapsed ? 'true' : 'false')
    } catch {
      // ignore storage errors (private mode, quota, etc.)
    }
  }, [sidebarCollapsed])

  // Drive the shell height from JS instead of relying on `100vh`/`100dvh`.
  // Chromium (including Arc) caches stale viewport-unit values after
  // sidebar/chrome animations and doesn't recompute until reload. Read
  // window.innerHeight — the *layout viewport* — which is what page
  // content actually flows into and stays consistent across browser zoom.
  // (visualViewport.height shrinks during pinch/browser zoom, which would
  // make the desktop shell shorter than the layout viewport.) We still
  // subscribe to visualViewport.resize as a safety net for events that
  // don't fire window.resize.
  useEffect(() => {
    const setAppHeight = () => {
      document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`)
    }
    setAppHeight()
    window.addEventListener('resize', setAppHeight)
    window.visualViewport?.addEventListener('resize', setAppHeight)
    return () => {
      window.removeEventListener('resize', setAppHeight)
      window.visualViewport?.removeEventListener('resize', setAppHeight)
    }
  }, [])

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        // --app-height is the JS-measured viewport height (see the effect above).
        // Clamped against 100dvh: if browser chrome appears without firing a
        // resize, the JS value goes stale-too-tall and the shell's bottom edge
        // slides below the screen. Whichever source is correct is the smaller
        // one, so min() keeps the shell on-screen.
        height: 'min(var(--app-height), 100dvh)',
        width: '100%',
        overflow: 'hidden',
      }}
    >
      <TopBar
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
      />

      <div
        style={{
          display: 'flex',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* The sidebar is always absolutely positioned (so its collapsed
            hover-expand can overlay the content), so this spacer is what
            actually reserves width in the flex row. Animating its width — in
            sync with the sidebar's own width transition — lets the body grow
            and shrink smoothly instead of snapping when the sidebar toggles. */}
        <div
          aria-hidden
          style={{
            width: sidebarCollapsed ? '48px' : '240px',
            flexShrink: 0,
            transition: 'width 0.28s cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        />
        <Sidebar collapsed={sidebarCollapsed} />

        <MainContent>{children}</MainContent>
      </div>
    </div>
  )
}

export default Layout
