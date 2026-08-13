import React, { useEffect } from 'react'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { useTheme } from '../theme/ThemeProvider'
import AppSidebar from './AppSidebar'
import TopBar, { TOPBAR_HEIGHT } from './topbar/TopBar'

interface LayoutProps {
  children: React.ReactNode
}

/**
 * The app shell: shadcn Sidebar on the left, a topbar and the routed page in
 * the SidebarInset. The provider owns the collapse state — persisted in its
 * `sidebar_state` cookie, which is read back here because this is a SPA and
 * there is no server render to read it for us.
 */
const Layout: React.FC<LayoutProps> = ({ children }) => {
  // Mount the theme context so its attribute stays in sync with this view.
  useTheme()

  // Drive the shell height from JS instead of relying on `100vh`/`100dvh`.
  // Chromium (including Arc) caches stale viewport-unit values after
  // sidebar/chrome animations and doesn't recompute until reload. Read
  // window.innerHeight — the *layout viewport* — which is what page
  // content actually flows into and stays consistent across browser zoom.
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
    <SidebarProvider
      defaultOpen={!document.cookie.includes('sidebar_state=false')}
      // The provider defaults to `min-h-svh` on an unclamped page; this shell is
      // fixed-height with exactly one scroll region per page, so the height is
      // pinned and min-h-svh is merged away. min() against 100dvh because if
      // browser chrome appears without firing a resize, the JS-measured value
      // goes stale-too-tall and the shell's bottom edge slides off-screen.
      className="h-[min(var(--app-height),100dvh)] min-h-0 overflow-hidden"
    >
      <AppSidebar />
      <SidebarInset className="min-w-0 overflow-hidden">
        <TopBar />
        <div
          className="min-h-0 flex-1 overflow-hidden"
          style={{
            // Pages sized with --height-custom must never exceed the shell's
            // real height, or their bottom-anchored UI ends up below the
            // viewport — hence the same min() clamp, less the topbar.
            ['--height-custom' as string]: `calc(min(var(--app-height), 100dvh) - ${TOPBAR_HEIGHT}px)`,
          }}
        >
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

export default Layout
