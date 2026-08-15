# demo-site — the customer website the widget sits on

A second Vibe app (`sterling`, https://preview-sterling.vibe.facilio.com/) holding one
static page: the marketing site of a fictional soft-services company, with the **real**
Frontline intake widget in the bottom-right corner.

It exists so the widget can be demonstrated where it will actually live rather than
inside our own console, which is the one thing a customer never sees.

## How it is wired

The page is plain HTML — no SDK, no build step. The corner panel is an `<iframe>` at
`https://preview-frontline.vibe.facilio.com/#/embed`, which is frontline's own widget
route (`frontend/src/features/chat/pages/Embed.tsx`). The framed document *is* frontline,
so the `intake` agent, the intake handlers and the `fl_lead` write are all live: a
conversation held on this page produces a real lead in the console.

**Why a frame and not the widget itself.** Agents and functions are app-scoped — a widget
served from the `sterling` app would resolve `intake` against `sterling` and 404 — and
pointing the SDK back at frontline cross-origin is refused: the preflight to
`frontline.vibe.facilio.com` answers `204` with no `Access-Control-Allow-Origin`. The app
databases are separate schemas too, so a lead captured here would never reach `fl_lead`.
A frame has none of those problems.

## What it cannot show

Both apps are auth-gated, so **the viewer must already be signed in to Facilio**. An
anonymous request 302s to `id.facilio.com`, which sends `X-Frame-Options: SAMEORIGIN`, and
the panel comes up blank. Cookies ride between the two hosts because both are
`*.facilio.com` — same-site — which is exactly what would *not* be true on a customer's own
domain. Putting this widget on a real company's website needs **public app access**, a
platform-UI setting that is currently off.

## Deploying

```bash
cd demo-site && facilio vibe deploy -m "…"
```

`vibe.json` here targets `sterling`; the repo root's targets `frontline`. Run the CLI from
the right directory — `facilio vibe app create` patches whichever `vibe.json` it finds.
