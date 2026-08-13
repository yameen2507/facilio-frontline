import React, { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown } from '../primitives'

// ─── Smooth accordion ─────────────────────────────────────────────────────────

const Accordion: React.FC<{
  isOpen: boolean
  children: React.ReactNode
  instant?: boolean
}> = ({ isOpen, children, instant }) => {
  const innerRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)

  useEffect(() => {
    if (innerRef.current) {
      setHeight(innerRef.current.scrollHeight)
    }
  }, [isOpen, children])

  return (
    <div
      style={{
        height: isOpen ? `${height}px` : '0px',
        overflow: 'hidden',
        transition: instant ? 'none' : 'height 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
      }}
    >
      <div ref={innerRef}>{children}</div>
    </div>
  )
}

// ─── Nav item ─────────────────────────────────────────────────────────────────

export interface NavItemProps {
  to?: string
  icon?: string
  group?: string
  label: string
  active?: boolean
  disabled?: boolean
  trailing?: React.ReactNode
  onClick?: () => void
  collapsed?: boolean
}

export const NavItem: React.FC<NavItemProps> = ({
  to,
  icon,
  group,
  label,
  active,
  disabled,
  trailing,
  onClick,
  collapsed,
}) => {
  const containerStyle: React.CSSProperties = {
    position: 'relative',
    zIndex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: collapsed ? 0 : 'var(--spacing-container-large)',
    height: '32px',
    padding: '0 var(--spacing-container-large)',
    borderRadius: 'var(--border-medium)',
    width: '100%',
    boxSizing: 'border-box',
    cursor: disabled ? 'default' : 'pointer',
    textDecoration: 'none',
    border: 'none',
    outline: 'none',
    opacity: disabled ? 0.4 : 1,
    backgroundColor: 'transparent',
  }

  const labelStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    opacity: collapsed ? 0 : 1,
    overflow: 'hidden',
    textOverflow: 'clip',
    whiteSpace: 'nowrap',
    willChange: 'opacity',
    font: active ? 'var(--text-heading-med-14)' : 'var(--text-body-reg-14)',
    color: 'var(--colors-text-description)',
    transition: 'opacity 0.4s cubic-bezier(0.22, 1, 0.36, 1)',
  }

  const inner = (
    <>
      {icon && group && (
        <fc-icon
          name={icon}
          group={group}
          size="16"
          color={active ? 'var(--colors-icon-neutral-main)' : 'var(--colors-icon-neutral-medium)'}
          style={{ width: 16, height: 16 }}
          aria-hidden="true"
        />
      )}
      <span className="nav-item-label" style={labelStyle}>{label}</span>
      {!collapsed && trailing}
    </>
  )

  if (to && !disabled && !onClick) {
    return (
      <Link
        to={to}
        data-nav-active={active ? 'true' : undefined}
        data-nav-hoverable={disabled ? undefined : 'true'}
        style={containerStyle}
        onMouseDown={(e) => e.preventDefault()}
      >
        {inner}
      </Link>
    )
  }

  return (
    <div
      role={disabled ? undefined : 'button'}
      tabIndex={disabled ? undefined : 0}
      data-nav-active={active ? 'true' : undefined}
      data-nav-hoverable={disabled ? undefined : 'true'}
      style={containerStyle}
      onMouseDown={disabled ? undefined : (e) => e.preventDefault()}
      onClick={disabled ? undefined : onClick}
      onKeyDown={disabled ? undefined : (e) => e.key === 'Enter' && onClick?.()}
    >
      {inner}
    </div>
  )
}

// ─── Section label ─────────────────────────────────────────────────────────────

// Sub-header that groups a set of nav items (e.g. "Agent Configuration" in the
// main panel, "Telephony"/"Channels" in settings). Collapses to zero height and
// fades out when the rail is collapsed so it doesn't dangle over the icon-only
// rail. Shared by both nav panels so the grouping looks identical everywhere.
export const SectionLabel: React.FC<{ label: string; collapsed: boolean }> = ({
  label,
  collapsed,
}) => (
  <div
    aria-hidden={collapsed}
    style={{
      // Same stacking as NavItem so the sliding hover/active pill (zIndex 0 in
      // NavPanel) passes behind the header instead of covering it.
      position: 'relative',
      zIndex: 1,
      padding: '0 var(--spacing-container-large)',
      maxHeight: collapsed ? '0px' : '40px',
      paddingBottom: collapsed ? '0px' : 'var(--spacing-container-small)',
      opacity: collapsed ? 0 : 1,
      transition:
        'max-height 0.28s cubic-bezier(0.22, 1, 0.36, 1), padding-bottom 0.28s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.22s cubic-bezier(0.22, 1, 0.36, 1)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
    }}
  >
    <span
      style={{
        font: 'var(--text-caption-reg-12)',
        color: 'var(--colors-text-caption)',
      }}
    >
      {label}
    </span>
  </div>
)

// ─── Accordion nav item ───────────────────────────────────────────────────────

export interface AccordionNavItemProps {
  icon: string
  group: string
  label: string
  isOpen: boolean
  onToggle: () => void
  children: React.ReactNode
  childActive?: boolean
  collapsed?: boolean
}

export const AccordionNavItem: React.FC<AccordionNavItemProps> = ({
  icon,
  group,
  label,
  isOpen,
  onToggle,
  children,
  childActive,
  collapsed,
}) => {
  return (
    <div style={{ width: '100%' }}>
      <div
        role="button"
        tabIndex={0}
        data-nav-active={childActive && (collapsed || !isOpen) ? 'true' : undefined}
        data-nav-hoverable="true"
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: collapsed ? 0 : 'var(--spacing-container-large)',
          height: '32px',
          padding: '0 var(--spacing-container-large)',
          borderRadius: 'var(--border-medium)',
          width: '100%',
          boxSizing: 'border-box',
          cursor: 'pointer',
          border: 'none',
          outline: 'none',
          backgroundColor: 'transparent',
        }}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onToggle}
        onKeyDown={(e) => e.key === 'Enter' && onToggle()}
      >
        <fc-icon
          name={icon}
          group={group}
          size="16"
          color={childActive ? 'var(--colors-icon-neutral-main)' : 'var(--colors-icon-neutral-medium)'}
          style={{ width: 16, height: 16 }}
          aria-hidden="true"
        />
        <span
          className="nav-item-label"
          style={{
            flex: 1,
            minWidth: 0,
            opacity: collapsed ? 0 : 1,
            overflow: 'hidden',
            textOverflow: 'clip',
            whiteSpace: 'nowrap',
            font: 'var(--text-body-reg-14)',
            color: 'var(--colors-text-description)',
            transition: 'opacity 0.4s cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        >
          {label}
        </span>
        <div style={{ display: collapsed ? 'none' : 'flex' }}>
          <ChevronDown open={isOpen} />
        </div>
      </div>

      <Accordion isOpen={isOpen && !collapsed} instant={collapsed}>
        <div
          style={{
            marginTop: 'var(--spacing-container-small)',
            marginLeft: 'var(--spacing-container-xxlarge)',
            paddingLeft: 'calc(var(--spacing-container-large) - 1px)',
            paddingTop: 'var(--spacing-container-medium)',
            paddingBottom: 'var(--spacing-container-medium)',
            borderLeft: '1px solid var(--colors-background-neutral-base-medium)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--spacing-container-small)',
          }}
        >
          {children}
        </div>
      </Accordion>
    </div>
  )
}
