/**
 * Identity, at the bottom of the sidebar — the shadcn nav-user arrangement.
 *
 * This replaced the topbar avatar when the topbar itself went: with the brand,
 * the collapse control and navigation all living in the rail, a 56px bar whose
 * only content was a second copy of "Frontline" and this menu was pure
 * redundancy. The menu keeps the same three sections it always had: who you
 * are, the theme control (a row, not an item — choosing a theme must not close
 * the menu), and sign out.
 */

import { ChevronsUpDown, LogOut } from 'lucide-react'
import { useUser } from '@/app/auth'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { vibe } from '@/lib/vibe'
import { ThemeSwitcher } from '@/theme/ThemeSwitcher'

/** "Mohamed Yameen" → "MY"; falls back to the email's first letter. Exported
    for the phone's More sheet, which carries the same identity block without
    the sidebar chrome this one is wrapped in. */
export function initials(name: string | undefined, email: string | undefined): string {
  const source = (name ?? '').trim()
  if (source) {
    const parts = source.split(/\s+/)
    return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase()
  }
  return (email?.[0] ?? '?').toUpperCase()
}

export function NavUser() {
  const me = useUser()
  const { isMobile } = useSidebar()
  const name = me.user?.name
  const email = me.user?.email

  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton
            size="lg"
            className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            aria-label="Account menu"
          >
            <Avatar className="size-8 rounded-lg">
              <AvatarFallback className="rounded-lg text-xs font-medium">
                {initials(name, email)}
              </AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left leading-tight">
              <span className="truncate text-sm font-medium">{name ?? email ?? '…'}</span>
              {email ? <span className="text-muted-foreground truncate text-xs">{email}</span> : null}
            </div>
            <ChevronsUpDown className="ml-auto size-4" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>

        {/* Beside the rail on desktop; a bottom sheet-style drop on mobile,
            where "beside" would be off-screen. */}
        <DropdownMenuContent
          side={isMobile ? 'bottom' : 'right'}
          align="end"
          sideOffset={4}
          className="w-60"
        >
          <DropdownMenuLabel className="font-normal">
            <div className="grid min-w-0 leading-snug">
              <span className="truncate text-sm font-medium">{name ?? email ?? '…'}</span>
              {email && name ? <span className="text-muted-foreground truncate text-xs">{email}</span> : null}
              {me.org?.orgId ? (
                <span className="text-muted-foreground text-xs">Org {String(me.org.orgId)}</span>
              ) : null}
            </div>
          </DropdownMenuLabel>

          <DropdownMenuSeparator />

          {/* A control row, not a menu item: choosing a theme must not close the
              menu, so it stays a plain div outside the item system. */}
          <div className="flex items-center justify-between gap-2 px-2 py-1.5">
            <span className="text-sm">Theme</span>
            <ThemeSwitcher />
          </div>

          <DropdownMenuSeparator />

          <DropdownMenuItem onSelect={() => vibe.logout()}>
            <LogOut />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  )
}
