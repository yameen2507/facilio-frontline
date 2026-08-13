/**
 * The topbar inside the SidebarInset — the shadcn dashboard arrangement, where
 * the sidebar runs full height and carries the brand, so the bar holds only the
 * rail trigger and identity.
 *
 * The height is load-bearing: Layout derives `--height-custom` from
 * TOPBAR_HEIGHT, so a change here must keep `h-14` and this constant in step.
 */

import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'
import ProfileMenu from './ProfileMenu'

export const TOPBAR_HEIGHT = 56

export default function TopBar() {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="data-[orientation=vertical]:h-4" />
      <span className="text-sm font-medium">Frontline</span>
      <span className="flex-1" />
      <ProfileMenu />
    </header>
  )
}
