import React, { useEffect } from 'react'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { useTheme } from '../theme/ThemeProvider'
import AppSidebar from './AppSidebar'
import MobileTabBar from './MobileTabBar'

/**
 * How the rail starts when the user has never touched it.
 *
 * A tablet in portrait is 768–1024px wide: wide enough that shadcn renders the
 * rail rather than the phone bar, narrow enough that 256px of it is a third of
 * the screen. So the first run there is the ICON rail, and desktop keeps the
 * full one. The cookie always wins once it exists — this only decides run one.
 */
function railStartsOpen(): boolean {
  const chosen = document.cookie.match(/(?:^|;\s*)sidebar_state=(true|false)/)
  if (chosen) return chosen[1] === 'true'
  return window.innerWidth >= 1024
}

interface LayoutProps {
  children: React.ReactNode
}

/**
 * The app shell: shadcn Sidebar on the left, the routed page in the
 * SidebarInset. There is NO topbar — the sidebar's brand row carries the
 * collapse control and its footer carries identity, so a bar above the page
 * would only repeat both (which is exactly what it did before it was removed).
 * Page titles come from each page's own PageShell header.
 *
 * The provider owns the collapse state — persisted in its `sidebar_state`
 * cookie, which is read back here because this is a SPA and there is no server
 * render to read it for us.
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
      defaultOpen={railStartsOpen()}
      // The provider defaults to `min-h-svh` on an unclamped page; this shell is
      // fixed-height with exactly one scroll region per page, so the height is
      // pinned and min-h-svh is merged away. min() against 100dvh because if
      // browser chrome appears without firing a resize, the JS-measured value
      // goes stale-too-tall and the shell's bottom edge slides off-screen.
      className="h-[min(var(--app-height),100dvh)] min-h-0 overflow-hidden"
    >
      <AppSidebar />

      {/* Installed to a home screen the app draws edge-to-edge (viewport-fit=cover
          + black-translucent), so the inset — not the browser — must keep clear of
          the status bar and the landscape notch. env() is 0px everywhere else. */}
      <SidebarInset className="min-w-0 overflow-hidden pt-[env(safe-area-inset-top,0px)] pr-[env(safe-area-inset-right,0px)] pl-[env(safe-area-inset-left,0px)]">
        <div
          className="min-h-0 flex-1 overflow-hidden"
          style={{
            // Pages sized with --height-custom must never exceed the shell's
            // real height, or their bottom-anchored UI ends up below the
            // viewport. With the topbar gone this is the full shell height.
            ['--height-custom' as string]: 'min(var(--app-height), 100dvh)',
          }}
        >
          {children}
        </div>

        {/* The phone's navigation, IN FLOW below the page's scroll region
            rather than fixed over it — so no page has to reserve room for it
            and none can scroll its last row underneath. Renders itself away
            from `md` up, where the rail takes over. */}
        <MobileTabBar />
      </SidebarInset>
    </SidebarProvider>
  )
}

export default Layout
