import React, { useCallback, useEffect, useRef, useState } from 'react'
import MainNavPanel from './MainNavPanel'

interface SidebarProps {
  collapsed: boolean
}

/**
 * The nav rail: 240px expanded, 48px collapsed, hover-expanding when collapsed.
 *
 * The helpdesk original slid between two panels — a main nav and a settings nav —
 * because its settings surface has a nav of its own. Frontline's settings is one
 * page, so there is a single panel and no slide. If a second panel is ever
 * needed, the original technique was two absolutely-positioned children in a
 * clipping stage, each translated ±100% and transitioned.
 */
const Sidebar: React.FC<SidebarProps> = ({ collapsed }) => {
  // Hover-expand behavior when collapsed
  const [hovered, setHovered] = useState(false)
  const hoverTimerRef = useRef<number | null>(null)
  const visuallyCollapsed = collapsed && !hovered

  const handleSidebarEnter = useCallback(() => {
    if (!collapsed) return
    if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current)
    // A short delay so brushing past the rail on the way to the content doesn't
    // flick it open.
    hoverTimerRef.current = window.setTimeout(() => setHovered(true), 120)
  }, [collapsed])

  const handleSidebarLeave = useCallback(() => {
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    setHovered(false)
  }, [])

  useEffect(() => {
    if (!collapsed) setHovered(false)
  }, [collapsed])

  useEffect(
    () => () => {
      if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current)
    },
    [],
  )

  return (
    <nav
      onMouseEnter={handleSidebarEnter}
      onMouseLeave={handleSidebarLeave}
      style={{
        // Always absolute — the animated gutter spacer in Layout reserves the
        // flow width, so the body can transition in lock-step with this width
        // instead of snapping when `collapsed` toggles. Absolute also lets the
        // collapsed hover-expand float over the content.
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: 0,
        width: visuallyCollapsed ? '48px' : '240px',
        height: '100%',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--colors-background-neutral-base-subtle)',
        boxSizing: 'border-box',
        padding: 'var(--spacing-container-large)',
        overflow: 'hidden',
        // Nav labels are chrome, not content — dragging across them should
        // never leave a text selection. Inherited, so it covers every item.
        userSelect: 'none',
        zIndex: collapsed && hovered ? 50 : 'auto',
        // Right divider drawn as an inset box-shadow rather than a 0.5px
        // border: a sub-pixel border + border-box stole 0.5px from the
        // content width, making collapsed nav items 31.5px instead of a
        // clean 32px. A painted shadow doesn't affect layout. When the
        // collapsed rail is hover-expanded it floats with an elevation
        // shadow instead, so the divider isn't needed.
        boxShadow:
          collapsed && hovered
            ? 'var(--elevation-light-high)'
            : 'inset -1px 0 0 0 var(--colors-border-neutral-base-subtle)',
        transition: 'width 0.28s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.2s ease',
        willChange: 'width',
      }}
    >
      <div
        style={{
          position: 'relative',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        <MainNavPanel collapsed={visuallyCollapsed} />
      </div>
    </nav>
  )
}

export default Sidebar
