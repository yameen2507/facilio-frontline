import React from 'react'

interface MainContentProps {
  children: React.ReactNode
}

const MainContent: React.FC<MainContentProps> = ({ children }) => (
  <div
    style={{
      flex: '1 1 auto',
      // min-width: 0 / min-height: 0 are the standard flex-overflow guard:
      // without them a flex child's intrinsic min content size can push
      // the shell wider/taller than the viewport.
      minWidth: 0,
      minHeight: 0,
      height: '100%',
      // overflow: hidden because the actual scroll region lives one layer
      // deeper (OverlayScrollbar inside each page). Keeping this hidden
      // prevents a second page-level scroll area from appearing.
      overflow: 'hidden',
      backgroundColor: 'var(--colors-background-container)',
      // Same min() clamp as the Layout shell — pages sized with
      // --height-custom must never exceed the shell's real height, or their
      // bottom-anchored UI ends up below the viewport.
      ['--height-custom' as string]:
        'calc(min(var(--app-height), 100dvh) - 56px)',
    }}
  >
    {children}
  </div>
)

export default MainContent
