# Facilio DSM Design Tokens

This document lists the CSS variables (design tokens) exposed by `@facilio/dsm-core`. Always reference these tokens — **never hardcode colors, spacing, or typography**.

The tokens have two forms:

1. **Raw CSS variables** — e.g. `var(--colors-background-container)` — use in inline `style`, className CSS, or external stylesheets.
2. **`styleProps` keys** — e.g. `backgroundColor: "backgroundContainer"` — use on `<FContainer>` and other DSM components with a `styleProps` prop. The key is the token name in camelCase (strip the `--colors-` / `--spacing-` prefix).

---

## Spacing Tokens

Use `padding`, `margin`, and `gap` with spacing tokens only.

### Container spacing (for UI chrome — padding/gap inside components)

| Token                           | styleProps value     |
| ------------------------------- | -------------------- |
| `--spacing-container-none`      | `containerNone`      |
| `--spacing-container-small`     | `containerSmall`     |
| `--spacing-container-medium`    | `containerMedium`    |
| `--spacing-container-large`     | `containerLarge`     |
| `--spacing-container-xlarge`    | `containerXlarge`    |
| `--spacing-container-xxlarge`   | `containerXxlarge`   |

### Section spacing (larger gaps, e.g. between groups of cards)

| Token                       | styleProps value |
| --------------------------- | ---------------- |
| `--spacing-section-small`   | `sectionSmall`   |

### Numerical scale (raw CSS uses only)

| Token                 | Purpose                         |
| --------------------- | ------------------------------- |
| `--numerical-nl-none` | 0                                |
| `--numerical-nl-half` | half of one                      |
| `--numerical-nl-01`   | step 1                           |
| `--numerical-nl-02`   | step 2                           |
| `--numerical-nl-03`   | step 3                           |
| `--numerical-nl-04`   | step 4                           |
| `--numerical-nl-06`   | step 6                           |
| `--numerical-nl-08`   | step 8                           |
| `--numerical-nl-10`   | step 10                          |

**Rule:** Prefer `--spacing-container-*` / `--spacing-section-*` tokens in component code; reserve `--numerical-nl-*` for scaffolding CSS where container semantics don't apply.

---

## Color Tokens

### Semantic backgrounds

| Token                                              | Usage                                  |
| -------------------------------------------------- | -------------------------------------- |
| `--colors-background-container`                    | Surface/card background                |
| `--colors-background-midground-subtle`             | Muted surface (hover states)           |
| `--colors-background-midground-medium`             | Medium emphasis fill                   |
| `--colors-background-midground-dark`               | Dark emphasis fill                     |
| `--colors-background-primary-default`              | Primary brand button fill              |
| `--colors-background-primary-hovered`              | Primary button hover                   |
| `--colors-background-primary-pressed`              | Primary button pressed                 |
| `--colors-background-selection`                    | Selected item fill (tabs, chips)       |
| `--colors-background-neutral-base-subtle`          | Subtle neutral fill                    |
| `--colors-background-neutral-base-light`           | Slightly lighter neutral fill          |
| `--colors-background-neutral-base-medium`          | Medium neutral fill                    |
| `--colors-background-neutral-grey02-subtler`       | Grey02 subtler                         |
| `--colors-background-neutral-grey02-subtle`        | Grey02 subtle                          |
| `--colors-background-neutral-grey02-light`         | Grey02 light                           |
| `--colors-background-semantic-red-subtle`          | Destructive subtle                     |
| `--colors-background-semantic-red-light`           | Destructive light                      |
| `--colors-background-semantic-red-medium`          | Destructive medium                     |
| `--colors-background-semantic-red-dark`            | Destructive dark                       |
| `--colors-background-semantic-green-subtle`        | Success subtle                         |
| `--colors-background-semantic-green-light`         | Success light                          |
| `--colors-background-semantic-green-medium`        | Success medium                         |
| `--colors-background-semantic-orange-subtle`       | Warning subtle                         |
| `--colors-background-semantic-orange-light`        | Warning light                          |
| `--colors-background-semantic-orange-medium`       | Warning medium                         |
| `--colors-background-accent-blue-subtle`           | Accent blue                            |
| `--colors-background-accent-blue-light`            | Accent blue light                      |
| `--colors-background-accent-blue-dark`             | Accent blue dark                       |
| `--colors-background-accent-yellow-subtle`         | Accent yellow                          |
| `--colors-background-accent-yellow-medium`         | Accent yellow medium                   |
| `--colors-background-accent-cyan-*`                | Accent cyan (subtle/light/medium)      |
| `--colors-background-accent-pink-*`                | Accent pink                            |
| `--colors-background-accent-purple-*`              | Accent purple                          |
| `--colors-background-accent-violet-*`              | Accent violet                          |

### Text colors

| Token                                   | Usage                          |
| --------------------------------------- | ------------------------------ |
| `--colors-text-main`                    | Primary body text              |
| `--colors-text-default`                 | Default text                   |
| `--colors-text-description`             | Secondary / description text   |
| `--colors-text-caption`                 | Caption / helper text          |
| `--colors-text-primary-default`         | Primary brand text (links)     |
| `--colors-text-primary-hovered`         | Link hovered                   |
| `--colors-text-primary-pressed`         | Link pressed                   |
| `--colors-text-inverse-default`         | Text on primary fill           |
| `--colors-text-semantic-red`            | Error text                     |

### Border colors

| Token                                        | Usage                        |
| -------------------------------------------- | ---------------------------- |
| `--colors-border-subtle`                     | Generic subtle divider       |
| `--colors-border-neutral-base`               | Neutral border               |
| `--colors-border-neutral-base-subtler`       | Neutral subtler border       |
| `--colors-border-neutral-base-subtle`        | Neutral subtle border        |
| `--colors-border-neutral-base-light`         | Neutral light border         |
| `--colors-border-neutral-base-medium`        | Neutral medium border        |
| `--colors-border-neutral-grey02-subtler`     | Grey02 subtler border        |
| `--colors-border-neutral-grey02-subtle`      | Grey02 subtle border         |
| `--colors-border-primary-default`            | Primary brand border         |
| `--colors-border-primary-focused`            | Focus ring                   |
| `--colors-border-semantic-red-subtle`        | Error border                 |
| `--colors-border-semantic-red-medium`        | Error border (emphasis)      |
| `--colors-border-semantic-green-light`       | Success border               |
| `--colors-border-semantic-orange-light`      | Warning border               |
| `--colors-border-accent-blue-light`          | Accent blue border           |
| `--colors-border-accent-yellow-light`        | Accent yellow border         |
| `--colors-border-accent-cyan-light`          | Accent cyan border           |
| `--colors-border-accent-pink-light`          | Accent pink border           |
| `--colors-border-accent-purple-light`        | Accent purple border         |
| `--colors-border-accent-violet-light`        | Accent violet border         |

### Icon colors

| Token                            | Usage                  |
| -------------------------------- | ---------------------- |
| `--colors-icon-neutral-main`     | Primary icon           |
| `--colors-icon-neutral-dark`     | Emphasized icon        |
| `--colors-icon-primary-pressed`  | Primary icon (pressed) |

### Widget colors (for specialized components)

- `--colors-widget-accent-blue-subtle`
- `--colors-widget-accent-blue-light`

### Raw palette (only when semantic tokens won't work)

Scales 05–90:
- `--color-blue-*`, `--color-cyan-*`, `--color-green-*`, `--color-orange-*`,
  `--color-pink-*`, `--color-purple-*`, `--color-red-*`, `--color-violet-*`,
  `--color-yellow-*`
- `--color-neutral-01-*` and `--color-neutral-02-*`

### Backdrops (glass/frost effects)

- `--color-backdrops-white`, `--color-backdrops-white-frost-low/high`
- `--color-backdrops-white-halftone`
- `--color-backdrops-grey-halftone`, `--color-backdrops-grey-halftone-1/2`
- `--color-backdrops-grey-frost-low/high`

---

## Typography Tokens

Use through the `FText` component's `appearance` prop, or via raw CSS `font` shorthand.

| CSS Token                     | `FText` appearance     | Semantic              |
| ----------------------------- | ---------------------- | --------------------- |
| `--text-heading-smb-41`       | —                      | Display heading       |
| `--text-heading-med-32`       | —                      | Large heading         |
| `--text-heading-smb-24`       | —                      | Page heading          |
| `--text-heading-smb-20`       | `headingMed20`         | Section heading       |
| `--text-heading-smb-18`       | —                      | Subsection heading    |
| `--text-heading-med-16`       | `headingMed16`         | Prominent body        |
| `--text-heading-med-14`       | `headingMed14`         | Label / emphasis      |
| `--text-body-reg-16`          | —                      | Regular body 16       |
| `--text-body-reg-14`          | `bodyReg14`            | Regular body 14       |
| `--text-body-reg-ul-14`       | `bodyRegUl14`          | Body 14 underline     |
| `--text-body-reg-st-14`       | `bodyRegSt14`          | Body 14 strikethrough |
| `--text-caption-med-l-12`     | —                      | Caption medium L 12   |
| `--text-caption-med-ll-12`    | `captionMed12`         | Caption medium LL 12  |
| `--text-caption-reg-12`       | `captionReg12`         | Caption regular 12    |
| `--text-caption-med-10`       | `captionMed10`         | Caption medium 10     |
| `--text-caption-reg-10`       | `captionReg10`         | Caption regular 10    |

The `font` shorthand (`font: var(--text-body-reg-14)`) sets family + size + weight + line-height in one go.

---

## Borders

| Token             | Radius |
| ----------------- | ------ |
| `--border-small`  | small  |
| `--border-medium` | medium |
| `--border-large`  | large  |

---

## Shadows / Elevation

| Token                     | Purpose             |
| ------------------------- | ------------------- |
| `--shadows-elevation1`    | Raised card shadow  |
| `--elevation-light-high`  | Light theme high    |
| `--elevation-dark-high`   | Dark theme high     |

---

## Authoring Rules

1. **Never hardcode color hex values.** If the semantic token doesn't exist, reuse an existing one rather than inventing a custom value.
2. **Never hardcode spacing as `px`.** Use the container/numerical scale.
3. **Typography must go through `FText`** or `font: var(--text-*)` — don't set `font-size` / `font-weight` independently.
4. **Use `styleProps` keys on `<FContainer>`** whenever possible; reserve raw `style` for CSS values not covered by DSM (e.g. `transition`, `position`).
5. **Tokens that end in `-subtler` / `-subtle` / `-light` / `-medium` / `-dark`** form a lightness scale. Prefer the subtlest variant that meets the contrast requirement.
6. **For theming (light/dark), tokens handle it automatically.** Do not branch on `theme` in component code for colors — use the semantic token and let the DSM switch the value.
