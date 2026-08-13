import React, { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useCounts } from '../../app/counts'
import { HorizontalDivider } from '../primitives'
import NavPanel from './NavPanel'
import { AccordionNavItem, NavItem, SectionLabel } from './NavItem'
import { NAV_TOP, SETTINGS_NAV } from './nav-config'

// Accordion to expand by default so its children (Calls, Chats, Emails) are
// visible on first paint — surfaces the inbox channels without a click.
// Frontline has no accordion entries yet, so nothing is open by default.
const DEFAULT_OPEN_ACCORDION: string | null = null

// Persist the open/closed accordion intent the same way the rail's collapse
// state is persisted (localStorage in Layout), so a deliberate close survives
// reloads and new tabs. Unset → fall back to the default-open; empty string →
// user intentionally closed everything.
const OPEN_ACCORDION_STORAGE_KEY = 'frontline:navOpenAccordion'

const readStoredOpenAccordion = (): string | null => {
  try {
    const stored = localStorage.getItem(OPEN_ACCORDION_STORAGE_KEY)
    if (stored === null) return DEFAULT_OPEN_ACCORDION
    return stored === '' ? null : stored
  } catch {
    return DEFAULT_OPEN_ACCORDION
  }
}

const writeStoredOpenAccordion = (key: string | null) => {
  try {
    localStorage.setItem(OPEN_ACCORDION_STORAGE_KEY, key ?? '')
  } catch {
    // ignore storage errors (private mode, quota, etc.)
  }
}

const SETTINGS_PINNED_STYLE: React.CSSProperties = {
  marginTop: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--spacing-container-medium)',
  paddingTop: 'var(--spacing-container-large)',
}

interface MainNavPanelProps {
  collapsed: boolean
}

const MainNavPanel: React.FC<MainNavPanelProps> = ({ collapsed }) => {
  const location = useLocation()
  const { openLeads } = useCounts()
  const at = useCallback(
    (path: string) => location.pathname.startsWith(path),
    [location.pathname],
  )

  // Drop entries flagged `hidden` in the config (temporarily parked modules).
  const navEntries = NAV_TOP.filter(
    (entry) =>
      !((entry.type === 'item' || entry.type === 'accordion') && entry.hidden),
  )

  const accordionStates = navEntries.flatMap((entry) => {
    if (entry.type !== 'accordion') return []
    const activeChild = entry.children.find((c) => at(c.to)) ?? null
    return [{ key: entry.key, activeChild, childActive: activeChild !== null }]
  })
  const activeAccordionKey =
    accordionStates.find((s) => s.childActive)?.key ?? null

  // Open/closed intent lives in localStorage (single source of truth): it
  // survives reloads, and while the rail is collapsed everything renders shut
  // (openAccordion → null) without overwriting the stored intent, so
  // re-expanding restores exactly what the user last had — including a
  // deliberately-closed accordion.
  const [openAccordion, setOpenAccordion] = useState<string | null>(
    () => activeAccordionKey ?? readStoredOpenAccordion(),
  )
  const toggleAccordion = (key: string) =>
    setOpenAccordion((prev) => {
      const next = prev === key ? null : key
      writeStoredOpenAccordion(next)
      return next
    })

  useEffect(() => {
    if (collapsed) {
      setOpenAccordion(null)
    } else {
      // A live child route always wins (and is remembered); otherwise restore
      // whatever the user last had open or closed.
      const next = activeAccordionKey ?? readStoredOpenAccordion()
      writeStoredOpenAccordion(next)
      setOpenAccordion(next)
    }
  }, [collapsed, activeAccordionKey])

  const syncKey = `main|${location.pathname}|${openAccordion ?? ''}|${collapsed}`

  return (
    <NavPanel syncKey={syncKey}>
      {navEntries.map((entry, i) => {
        if (entry.type === 'divider') {
          return (
            <div
              key={`div-${i}`}
              style={{ padding: 'var(--spacing-container-large) 0' }}
            >
              <HorizontalDivider />
            </div>
          )
        }
        if (entry.type === 'section') {
          return (
            <SectionLabel
              key={`section-${i}`}
              label={entry.label}
              collapsed={collapsed}
            />
          )
        }
        if (entry.type === 'item') {
          return (
            <NavItem
              key={entry.to}
              to={entry.to}
              icon={entry.icon}
              group={entry.group}
              label={entry.label}
              active={at(entry.to)}
              collapsed={collapsed}
              // Nothing until the count is known — a zero would claim an empty
              // inbox before anything has been fetched.
              trailing={
                entry.badge && openLeads ? <span className="nav-count">{openLeads}</span> : undefined
              }
            />
          )
        }
        const state = accordionStates.find((s) => s.key === entry.key)
        const activeChild = state?.activeChild ?? null
        return (
          <AccordionNavItem
            key={entry.key}
            icon={collapsed && activeChild ? activeChild.icon : entry.icon}
            group={collapsed && activeChild ? activeChild.group : entry.group}
            label={entry.label}
            isOpen={openAccordion === entry.key}
            onToggle={() => toggleAccordion(entry.key)}
            childActive={state?.childActive ?? false}
            collapsed={collapsed}
          >
            {entry.children.map((c) => (
              <NavItem
                key={c.to}
                to={c.to}
                icon={c.icon}
                group={c.group}
                label={c.label}
                active={at(c.to)}
              />
            ))}
          </AccordionNavItem>
        )
      })}

      <div style={SETTINGS_PINNED_STYLE}>
        <NavItem
          to={SETTINGS_NAV.to}
          icon={SETTINGS_NAV.icon}
          group={SETTINGS_NAV.group}
          label={SETTINGS_NAV.label}
          active={at(SETTINGS_NAV.to)}
          collapsed={collapsed}
        />
      </div>
    </NavPanel>
  )
}

export default MainNavPanel
