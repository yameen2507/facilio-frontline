/**
 * The top-right avatar and its menu.
 *
 * Identity lives in a top-right avatar with the account menu behind it, and the
 * theme control is a row inside that menu rather than a bar control — the
 * arrangement every console this was compared against (Framer, Uxcel, Remote,
 * Midday, Magnific) settled on.
 *
 * The hand-rolled anchored panel (outside-click and Escape handling included)
 * became shadcn's DropdownMenu, which also brings the keyboard model the old
 * panel never had.
 */

import { LogOut } from 'lucide-react'
import { useUser } from '@/app/auth'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { vibe } from '@/lib/vibe'
import { ThemeSwitcher } from '@/theme/ThemeSwitcher'

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
  const name = me.user?.name
  const email = me.user?.email

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="size-8 rounded-full p-0"
          title={name ?? email ?? 'Account'}
          aria-label="Account menu"
        >
          <Avatar className="size-8">
            <AvatarFallback className="text-xs font-medium">{initials(name, email)}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <div className="grid min-w-0 leading-snug">
            <span className="truncate text-sm font-medium">{name ?? email ?? '…'}</span>
            {email && name ? (
              <span className="text-muted-foreground truncate text-xs">{email}</span>
            ) : null}
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
  )
}
