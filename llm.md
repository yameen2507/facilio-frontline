# Vibe â€” Agent Build & Deploy Guide

> Vibe is Facilio's app platform. AI agents (Claude, GPT, anything) can author a static web app in **any language or framework**, integrate Facilio APIs via the `@facilio/vibe-sdk`, and ship it to a live URL with the `@facilio/cli` â€” the unified Facilio CLI (binary: `facilio`). The CLI has exactly **two products**: `facilio vibe â€¦` (build + deploy apps) and `facilio connections â€¦` (discover + run actions across 1000+ integrated apps). Auth (`login` / `logout` / `whoami`) is top-level and shared across both. There is no separate MCP server, no external catalog service, no other endpoint to point at â€” the CLI is the entire surface. This file tells you everything you need to do that end-to-end. Read it once before you start; whenever you need a connection slug, action slug, or payload shape, run `facilio connections search` / `facilio connections schemas <slug> --with-output` (see Â§6).
>
> **Migrated from `@facilio/vibe-cli`?** Uninstall the old package (`npm uninstall -g @facilio/vibe-cli`) and install `@facilio/cli`. The `vibe.json` config file is unchanged; existing credentials are picked up automatically on first `facilio login` (they migrate from keychain service `facilio-vibe-cli` / `~/.vibe/â€¦` to `facilio-cli` / `~/.facilio/â€¦`).

---

## 0. What you are building

A **Vibe app** = a folder of static files (HTML/CSS/JS, possibly bundled from React/Vue/Svelte/Solid/Preact/vanilla â€” your choice) hosted on a Facilio-managed subdomain like `https://<linkName>.vibe.facilio.com`.

Hard constraints â€” non-negotiable:

1. **The build output folder must contain an `index.html` at its root.** This is a constraint on the *output* of your build step, NOT a constraint on how you write your source code. Author your app in any framework, any folder structure, any number of files (TS, TSX, Vue SFCs, Svelte, Solid, plain JS, whatever) â€” then run your normal build command (`npm run build`, `yarn build`, `pnpm build`, `vite build`, `next export`, `astro build`, â€¦). Whatever folder that build writes to (e.g. `dist/`, `build/`, `out/`, `public/`) is what gets uploaded, and *that* folder is the one that must have `index.html` at its root. JS/CSS/asset files alongside it are fine and expected â€” they get loaded by `<script src=...>` / `<link rel=...>` tags inside `index.html` as your bundler emits them. No `index.html` in the output dir â†’ the deploy URL serves nothing.
2. **The site is static.** No server-side rendering, no Node runtime on the server. Anything dynamic happens client-side via the SDK calling Facilio APIs.
3. **Auth is browser-cookie based**, gated by `@facilio/vibe-sdk`. Don't roll your own login.
4. **All Facilio data access goes through `vibe.executeAction(connectionSlug, actionSlug, payload)`** â€” never call random `/api/...` URLs you guessed. Discover the right slugs and payload shapes with `facilio connections search` / `schemas` / `execute` (see Â§6).

You are free to pick the language/framework. React + Vite is shown in the reference app at `vibe-react-test/` because it's a sane default, not because it's required. A hand-written `dist/index.html` + `dist/app.js` with no bundler at all is equally valid.

---

## 1. The four-step workflow

```
1. facilio login                          # once per machine
2. facilio vibe app create  (first time only)  # writes vibe.json with the app linkName
3. <your build command>                # e.g. npm run build, vite build, etc.
4. facilio vibe deploy                         # zips build.publish, uploads, publishes
```

Repeat steps 3â€“4 to ship new versions. Every `facilio vibe deploy` produces an incrementing `versionNumber` and a stable live URL plus an immutable `versionedUrl`.

### Preview vs. production â€” how deploys are promoted

**Everything the CLI ships goes to a PREVIEW URL first, never straight to production.** This is a safety property, not an option you can override. Whatever the agent does â€” code changes, function changes, new versions, hotfixes â€” lands on the app's preview URL only. The user must **manually promote to production from the Facilio platform UI**; only after that click does the change reflect on the production URL. There is no `vibe promote` / `vibe push-to-prod` CLI command by design.

What this means for the agent:

- When you finish a `facilio vibe deploy`, tell the user plainly: *"This is live on the preview URL. Open the platform and click 'Publish to production' when you've verified it."* Do NOT tell them the change is live in prod â€” it isn't yet.
- The `--prod` flag on `facilio vibe deploy` (see below) marks the deployment's intent, but the actual production cutover still happens from the platform.
- Iteration loop is: edit â†’ `npm run build` â†’ `facilio vibe deploy` â†’ user checks preview URL â†’ user promotes in platform. Every cycle.

**Critical: preview and production share the SAME database.** Both the preview URL and the production URL point at the same Postgres schema, the same tables, the same rows. There is no per-environment DB. That has one very load-bearing consequence â€” read Â§11 before making any schema change.

### The ONE step that requires the user

`facilio login` (step 1) opens a browser and shows a code. **The user must click "Approve" in the browser once.** That's the only human-required action in the whole flow â€” it's how the OAuth device grant proves there's a real person at the keyboard. The agent's job here is:

1. Run `facilio login`.
2. Tell the user, in plain language: *"A browser tab just opened. Please click Approve to finish signing in â€” that's the only thing I need from you."*
3. Wait. The CLI polls until approval lands, then prints `Logged in as <email>.`

If the browser didn't auto-open (e.g. headless machine, SSH), the CLI prints a URL and a code â€” the agent should relay both to the user verbatim and tell them to open the URL on any device.

Everything before this (Node install, npm install) and everything after it (scaffold, build, app create, deploy, iterate) is fully automatic. The user only ever clicks once.

### Agent autonomy: from absolute zero to live URL

The complete recipe an agent runs on a fresh machine for a non-technical user (e.g. user says "build me a dashboard that lists my assets"):

```bash
# 0. Bootstrap Node if missing â€” see Â§3.0. Do NOT ask the user.
command -v node >/dev/null 2>&1 || {
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  export NVM_DIR="$HOME/.nvm"; \. "$NVM_DIR/nvm.sh"
  nvm install --lts && nvm use --lts
}

# 1. Pick a sane project location. Default: ~/vibe-apps/<slug>.
mkdir -p ~/vibe-apps && cd ~/vibe-apps
npm create vite@latest my-dashboard -- --template react   # or any template
cd my-dashboard
npm install
npm install @facilio/vibe-sdk

# 2. Install the CLI. Prefer global, but fall back to npx if it fails.
npm install -g @facilio/cli 2>/dev/null || echo "Falling back to npx"
# (use `npx @facilio/cli <cmd>` in place of `facilio <cmd>` if global failed)

# 3. Authenticate. <-- ONLY step where the user clicks once.
facilio login

# 4. Create the app. The CLI prompts for the name â€” enter what the user asked for
#    (e.g. "My Dashboard"). Description / logo prompts can be skipped with Enter.
facilio vibe app create

# 5. Edit src/ to use createVibe(), executeAction(), etc. (agent writes the code)

# 6. Build and deploy.
npm run build
facilio vibe deploy
# CLI prints: Live: https://my-dashboard.vibe.facilio.com
```

For iteration ("change the button color", "add a new section"): agent edits source, runs `npm run build && facilio vibe deploy`, reports the new URL. No further `login` or `app create` needed.

---

## 2. Project layout the CLI expects

At the project root:

```
my-app/
â”œâ”€â”€ vibe.json          â† CLI config (see Â§4)
â”œâ”€â”€ package.json       â† if you're using npm; otherwise whatever your toolchain wants
â”œâ”€â”€ src/               â† your source (any structure)
â””â”€â”€ dist/              â† build output â€” MUST contain index.html at root
```

The folder named in `vibe.json` `build.publish` (default `dist`) is what gets zipped and uploaded. Anything outside it is ignored.

---

## 3. Installing the toolchain

### 3.0. Prerequisite: Node.js + npm â€” agent installs them, never asks the user

The CLI and SDK both need Node.js (â‰¥20) and npm. If the user's machine doesn't have them, **install them yourself via curl â€” do not ask the user to install Node manually, do not link them to nodejs.org, do not stop and wait.** The point of having an agent is that the agent handles environment setup.

First, detect what's already there:

```bash
command -v node && node -v
command -v npm && npm -v
```

If either is missing (or `node -v` reports older than v20), bootstrap with `nvm` (works on macOS and Linux, no sudo, installs into the user's home dir):

```bash
# 1. Install nvm via curl
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash

# 2. Load nvm into THIS shell (the install script only edits future shells' rc files)
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# 3. Install + activate Node LTS (ships with npm)
nvm install --lts
nvm use --lts

# 4. Verify
node -v && npm -v
```

After this runs in the current shell, `node`, `npm`, and `npx` are on PATH and you can proceed to the steps below. Subsequent terminals will pick up nvm automatically via the rc file the install script edited (`~/.bashrc` / `~/.zshrc`).

Platform notes:
- **Windows (PowerShell)**: nvm-sh doesn't work. Use `winget install OpenJS.NodeJS.LTS` or `iwr https://get.scoop.sh -useb | iex; scoop install nodejs-lts`. Still no manual GUI installer prompts â€” pick whichever package manager is already present, or install scoop via the one-liner above.
- **Locked-down corporate Linux** where `curl | bash` is blocked: fall back to `fnm` via its release tarball, or extract a Node binary directly from `https://nodejs.org/dist/v20.x.x/node-v20.x.x-linux-x64.tar.xz`. Still no user intervention required.
- **Already inside a Docker / dev container**: use the distro package manager (`apt-get install -y nodejs npm`, `apk add nodejs npm`) since nvm in a container is wasteful.

Only escalate to the user if **all** automated paths fail (no internet, no shell write access, etc.). In that case tell them the exact one-liner they need to run, not "go install Node."

### 3.1. Install the Facilio CLI and Vibe SDK

```bash
# CLI â€” install globally so `facilio` is on PATH
npm install -g @facilio/cli

# SDK â€” install per-project
npm install @facilio/vibe-sdk
```

**Always check for the latest version of the CLI and SDK, and keep them up to date.** Older versions may be missing commands (e.g. `facilio vibe db`, `facilio vibe function`) or SDK methods. **Clear the npm cache before checking** so the version lookup isn't served stale from cache:

```bash
npm cache clean --force                 # clear cache so version checks aren't stale
npm view @facilio/cli version           # latest published CLI version
npm view @facilio/vibe-sdk version      # latest published SDK version

# compare with what's installed, and upgrade if behind:
facilio --version                       # your installed CLI version
npm install -g @facilio/cli@latest      # update the CLI
npm install @facilio/vibe-sdk@latest    # update the SDK in the project
```

**If `npm install -g` fails with a permissions error** (common when Node was installed via a system package manager and `/usr/local/lib/node_modules` isn't user-writable), do NOT run `sudo npm install -g` and do NOT ask the user. Use one of these instead â€” pick the first that works:

```bash
# Option A â€” reconfigure npm to install globals into the user's home dir
mkdir -p ~/.npm-global
npm config set prefix ~/.npm-global
export PATH="$HOME/.npm-global/bin:$PATH"
npm install -g @facilio/cli

# Option B â€” skip global install entirely, run via npx every time
#   (works without any privilege escalation; just slower on first call)
npx @facilio/cli login
npx @facilio/cli vibe app create
npx @facilio/cli vibe deploy
```

If you bootstrapped Node via nvm (Â§3.0), `npm install -g` already works without sudo â€” nvm puts node and its global dir in `$HOME`. That's why Â§3.0 recommends nvm.

For plain HTML without a bundler, load the SDK from CDN (no `npm install` needed):

```html
<script src="https://unpkg.com/@facilio/vibe-sdk"></script>
<script>const vibe = VibeSDK.createVibe();</script>
```

---

## 4. `vibe.json` â€” project config

Place at the project root. The CLI reads/writes this file.

```json
{
  "name": "my-app",
  "app": "my-app",
  "build": {
    "publish": "dist"
  }
}
```

| Field           | Required | Notes                                                                                          |
|-----------------|----------|------------------------------------------------------------------------------------------------|
| `name`          | optional | Human-readable name. Shown in `facilio vibe app list`.                                                 |
| `app`           | yes (after first deploy) | The `linkName` of the app on the server. Written automatically by `facilio vibe app create`. |
| `build.publish` | yes      | Folder containing built static files. Must contain `index.html`. Default: `dist`.              |

`facilio vibe app create` will scaffold or patch this file for you â€” you don't have to write it by hand.

---

## 5. CLI commands in detail

### `facilio login`

Run once per machine. Uses OAuth2 device flow â€” works on laptops, over SSH, and inside containers. The token lands in the OS keychain (macOS Keychain, Linux Secret Service, or Windows DPAPI); on systems without one it falls back to `~/.facilio/credentials.json` (chmod 600). One login covers Vibe, Connections, and every other Facilio product.

For CI / non-interactive: `facilio login --api-key -` (read the key from stdin).

### `facilio vibe app create`

```bash
facilio vibe app create
```

The command prompts for the name and (optionally) description, logo, and output directory. Enter the name the user asked for; the server derives the `linkName` (subdomain) from it. Press Enter to skip anything optional. Output directory defaults to `dist` â€” if your build emits elsewhere, edit `vibe.json` `build.publish` after the create call.

All fields can also be pre-filled via flags if you want to skip prompts entirely: `--name`, `--description`, `--logo` (path to png/jpg/svg/webp/gif/ico, â‰¤750 KB).

**Reserved prefix â€” do NOT create apps whose name/linkName starts with `preview-`.** That prefix is reserved by the platform: every app automatically gets a `preview-<linkName>` counterpart used as its preview environment (see the preview-vs-prod model above). If you name a user-facing app `preview-something`, you collide with that reserved slot and the deploy will either be rejected or shadow the preview URL of another app. Pick a name that does not begin with `preview-`. If the user asks for one that does (e.g. "call it preview-dashboard"), push back and suggest a rename before running `facilio vibe app create`.

After success, `vibe.json` is created (or patched) with `app: <linkName>` so subsequent `facilio vibe deploy` calls don't need any flags. The app's live URL is printed.

You only run this **once per app**. If you're shipping a new version of an existing app, skip this step.

### `facilio vibe app list`

Prints all apps in the org (linkName, name, URL, status, last-published timestamp).

### `facilio vibe app thumbnail <file>` / `facilio vibe app logo <file>`

Upload branding images for the current app (accepts `png`/`jpg`/`jpeg`/`webp`/`gif`/`svg`, max 2 MB, content-type inferred from extension). Both accept `--app <linkName>` to override `vibe.json`.

- `thumbnail` â€” **persists** the returned URL onto the app row's `logoUrl` (what the app listing renders as the tile).
- `logo` â€” **uploads only**, prints the public URL, does not touch any DB column. Use when you want the URL to embed in generated content or hand to another API.

```bash
facilio vibe app thumbnail ./assets/thumbnail.png
facilio vibe app logo      ./assets/logo.svg
```

### `facilio vibe deploy`

In the project root:
1. Reads `vibe.json` â†’ finds the `build.publish` directory.
2. Zips its contents (level-9 deflate).
3. POSTs to vibe-server, uploads the zip, triggers publish, polls until `DEPLOYED` or `FAILED`.
4. Prints the live URL and the immutable versioned URL.

Flags:
- `--prod` â€” mark this deployment as intended for production. **This flag does NOT bypass the preview step.** The deploy still lands on the preview URL first; the flag only records the deployer's intent so the platform's promote-to-prod UI can highlight this version. The actual cutover to the production URL always happens by user action in the platform, not from the CLI.
- `--app <linkName>` â€” override the `app` value from `vibe.json` (e.g. shipping the same build to a different app).

**You are responsible for running your build first.** The CLI does not invoke `npm run build` / `vite build` / etc. Build, then deploy:

```bash
npm run build && facilio vibe deploy
```

### `facilio whoami`

Prints the email and server of the active session. Use this in scripts to sanity-check login state.

### `facilio logout`

Removes the stored token.

### `facilio connections â€¦` â€” discover and run integration actions

The same CLI that ships Vibe also ships the **Connections** surface â€” the discovery-and-execution counterpart to `vibe.executeAction(...)`. Every action you'd call from your Vibe app is also runnable directly from the terminal, using the same `facilio login` session. Use this to figure out which slugs and payload shapes to hand to `vibe.executeAction` at build time â€” see Â§6 for the full loop.

**Before doing anything else, run `--help` to get the current command surface straight from the binary** â€” flag names, argument shapes, and defaults evolve, and `--help` is always authoritative:

```bash
facilio --help                              # top-level: login/logout/whoami + product namespaces
facilio connections --help                  # full list of connections subcommands + global flags
facilio connections execute --help          # per-command flags for one subcommand (repeat for any command)
facilio connections search --help
facilio vibe --help                         # same idea for the Vibe surface
```

Prefer `--help` over guessing or over anything documented here â€” if the doc and `--help` disagree, `--help` wins.

Common shape:

```bash
facilio connections search <query...>              # find actions by natural language
facilio connections schemas <slug> [--with-output] # read the input (and optionally output) schema
facilio connections list <connections...>          # your connected accounts for those apps
facilio connections link <connection> [--wait]     # OAuth-authorize an app (opens browser)
facilio connections unlink <connection>            # remove authorization
facilio connections wait <connections...>          # poll until connection(s) become ACTIVE
facilio connections execute <slug> --params '<json>' [--account <slug>] [--dry-run]
facilio connections execute --file batch.json      # batch: [{action_slug, arguments, account_slug?}, â€¦]
```

Global flags for every `facilio connections` subcommand:

- `--json` â€” print raw JSON payloads (use in scripts / agents).
- `--app <slug>` â€” scope to one connection (faster than searching all 1000+ apps).

Action slugs are of the form `<connection>.<action>` (e.g. `xero.create_invoice`). Split on the dot to get the `connectionSlug` + `actionSlug` pair that `vibe.executeAction` expects.

---

## 6. Integrating Facilio APIs via the SDK

### Setup (modern bundler â€” Vite / webpack / Next.js / esbuild / etc.)

```ts
import { createVibe } from '@facilio/vibe-sdk';

const vibe = createVibe();   // serverURL defaults to window.location.origin
```

Because every deployed Vibe app is served from `https://<linkName>.vibe.facilio.com`, the SDK talks to the same origin â€” no config needed. Cookies flow automatically.

### Auth

```ts
// Trigger login (redirects the browser to identity-service):
vibe.login();

// Trigger logout:
vibe.logout();

// Read the current user (null if not signed in):
const me = await vibe.getCurrentUser();

// Boolean check:
const ok = await vibe.isAuthenticated();
```

**Shape of `getCurrentUser()` response** (when signed in):

```json
{
  "user": {
    "uid": 1,
    "email": "xyz@facilio.com",
    "name": "xxxxx",
    "username": "xyz"
  },
  "org": {
    "orgId": 1
  }
}
```

Returns `null` when not signed in. Access fields as `me.user.email`, `me.user.name`, `me.user.uid`, `me.user.username`, `me.org.orgId` â€” note the nesting under `user` / `org`. Don't read `me.email` directly; it doesn't exist at the top level.

### Redirect to login when `getCurrentUser()` says unauthorized

Use `getCurrentUser()` as the single source of truth for "is the user signed in?" â€” and **only** that call drives the login redirect. If it returns `null` (the SDK's way of saying the underlying `/api/runtime/getCurrentUser` returned 401), send the user to the login screen with `vibe.login()`.

Recommended bootstrap pattern (run on app mount):

```ts
const me = await vibe.getCurrentUser();
if (!me) {
  vibe.login();   // browser navigates away to identity-service; nothing below runs
  return;
}
// ...render authenticated UI using me.user.email, me.org.orgId, etc.
```

Or â€” if you want the user to see a "Log in" button instead of an automatic redirect â€” render the button when `me === null` and wire its `onClick` to `vibe.login()`. Either pattern is fine; just never leave a `null` user case unhandled.

**Do not** wire `vibe.login()` into the catch block of every action call. A 401 from `executeAction` or any other endpoint is just an error â€” surface it via `err.message`. The login redirect belongs only on the `getCurrentUser()` path.

```ts
try {
  const result = await vibe.executeAction('facilio-cmms', 'list-assets');
  // ...use result
} catch (err) {
  showError(err.message);   // do NOT call vibe.login() here
}
```

See `vibe-react-test/src/App.jsx` for a working pattern.

### Calling Facilio data â€” `executeAction`

This is the **only** way you should access Facilio data:

```ts
const result = await vibe.executeAction(connectionSlug, actionSlug, payload);
```

- `connectionSlug` â€” identifies which Facilio product/connector to talk to (e.g. `facilio-cmms`).
- `actionSlug` â€” identifies the specific operation (e.g. `list-assets`, `create-workorder`).
- `payload` â€” JSON object with the action's inputs. Defaults to `{}` if the action takes none.

Returns the parsed JSON response. The shape is **action-specific**; the SDK does not normalize it. A typical action returns `{ response: { data: [...] } }` â€” see the smoke-test example below â€” but always confirm by inspecting the action's schema via `facilio connections schemas <slug> --with-output`.

**Where do the slugs and payload shapes come from?** Not from your imagination â€” discover them from the CLI. The unified `@facilio/cli` you already installed for `facilio login` / `facilio vibe deploy` also ships the full **Connections** command surface. The same session that authenticates deploys authenticates action discovery â€” no separate token, no separate config, no separate service to point at. Everything you need â€” search, schemas, dry-run, execute â€” is a single subcommand away.

If you're unsure of the exact flag name or argument shape at any point, run `facilio connections --help` (or `facilio connections <subcommand> --help`) â€” that's the authoritative reference and always matches the installed version.

```bash
# 0. When in doubt, list the surface.
facilio connections --help
facilio connections execute --help

# 1. Find candidate actions by natural-language description.
facilio connections search list open workorders
facilio connections search create xero invoice

# 2. Read the input schema so you know what payload to build.
facilio connections schemas facilio-cmms.list-assets --with-output

# 3. Run the action end-to-end from the CLI to confirm it works and inspect the real response.
facilio connections execute facilio-cmms.list-assets --params '{}'

# Or validate without executing:
facilio connections execute facilio-cmms.list-assets --params '{"limit":5}' --dry-run

# Or just print the schema and exit (equivalent to `schemas`):
facilio connections execute facilio-cmms.list-assets --get-schema
```

The CLI returns action slugs of the form `<connection>.<action>` (e.g. `xero.create_invoice`). Split that on the dot: **`connection`** is your `connectionSlug`, **`action`** is your `actionSlug`. Same slugs, same payload shapes â€” whatever ran in `facilio connections execute` will run identically inside your Vibe app via `vibe.executeAction(connectionSlug, actionSlug, payload)`.

The recommended agent loop:

1. `facilio connections search <query>` â†’ find the right `<connection>.<action>` slug.
2. `facilio connections schemas <slug> --with-output` â†’ read input + output schema.
3. `facilio connections execute <slug> --params '<json>'` â†’ verify it actually works with the real payload, inspect the real response shape.
4. Copy that call into your Vibe source: `vibe.executeAction(connectionSlug, actionSlug, payload)`.

This flow is decisive because you're **executing the same code path the browser SDK executes** â€” if the CLI call succeeds, the SDK call will too. There's no separate catalog service to consult; the CLI is the catalog.

Add `--json` to any `connections` subcommand for machine-parseable output, and `--app <slug>` to scope search/schemas/execute to one connection (faster when you already know which app you're targeting).

Do NOT hardcode action lists from this file â€” they evolve. Rediscover with `facilio connections search` each time the user asks for new functionality.

### Reference call (taken verbatim from the test app)

```js
const result = await vibe.executeAction('facilio-cmms', 'list-assets');
const { response } = result;
const assets = response?.data ?? [];
```

### Raw HTTP (escape hatch)

If you genuinely need an endpoint that's not exposed as an action, `vibe.fetch(path, init)` is a thin wrapper around `fetch()` that auto-attaches `credentials: 'include'` and redirects to `login()` on 401:

```ts
const res = await vibe.fetch('/api/runtime/...');
```

Prefer `executeAction` whenever possible â€” it's the supported, schema-discoverable surface.

### Error handling

All SDK methods throw `VibeError` (has `.message`, `.status?`). Wrap UI calls in try/catch and surface `err.message`:

```ts
try {
  const data = await vibe.executeAction('facilio-cmms', 'list-assets');
} catch (err) {
  // err.message is human-readable; err.status is the HTTP status if available
}
```

### Realtime

`vibe.subscribe(topic, handler)` receives live events pushed by the app's own server functions, plus `realtimeState` / `onRealtimeState` / `closeRealtime`. See **Â§11e** for the full rules â€” including that the browser can subscribe but never publish.

---

## 7. End-to-end example (React + Vite)

The folder `vibe-react-test/` is a working reference. Skim:

- `vibe-react-test/index.html` â€” the mandatory entry point, just a `<div id="root">`.
- `vibe-react-test/src/main.jsx` â€” mounts React.
- `vibe-react-test/src/App.jsx` â€” uses `createVibe()`, `vibe.getCurrentUser()`, `vibe.login()`, `vibe.logout()`, and `vibe.executeAction('facilio-cmms', 'list-assets')`.
- `vibe-react-test/vibe.json` â€” `{"name":"newcheck","app":"newcheck","build":{"publish":"dist"}}`.
- `vibe-react-test/package.json` â€” vite build command.

From scratch, that whole app ships in:

```bash
npm create vite@latest my-app -- --template react
cd my-app
npm install
npm install @facilio/vibe-sdk
# edit src/App.jsx to use vibe.login() etc.
facilio login                       # one-time
facilio vibe app create             # one-time; prompts for a name, writes vibe.json
npm run build
facilio vibe deploy
```

After the first deploy the CLI prints something like:

```
âœ” Deployed v1
  Live:    https://my-app.vibe.facilio.com
  Archive: https://my-app.vibe.facilio.com/v/1
```

Subsequent `facilio vibe deploy` calls bump the version and keep the live URL stable.

---

## 8. Minimal non-React example (vanilla HTML)

If the user just wants a one-page tool, you don't need a build step at all. Make a folder:

```
dist/
â”œâ”€â”€ index.html
â””â”€â”€ app.js
```

`dist/index.html`:

```html
<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Asset list</title></head>
  <body>
    <button id="load">Load assets</button>
    <ul id="list"></ul>
    <script src="https://unpkg.com/@facilio/vibe-sdk"></script>
    <script src="./app.js"></script>
  </body>
</html>
```

`dist/app.js`:

```js
const vibe = VibeSDK.createVibe();
document.getElementById('load').onclick = async () => {
  const user = await vibe.getCurrentUser();
  if (!user) return vibe.login();
  const { response } = await vibe.executeAction('facilio-cmms', 'list-assets');
  document.getElementById('list').innerHTML =
    (response?.data ?? []).map(a => `<li>${a.name} #${a.id}</li>`).join('');
};
```

`vibe.json`:

```json
{ "name": "asset-list", "app": "asset-list", "build": { "publish": "dist" } }
```

Then `facilio login â†’ facilio vibe app create â†’ facilio vibe deploy`. Done â€” no bundler, no transpile.

---

## 9. Checklist before you call `facilio vibe deploy`

- [ ] `facilio login` succeeded (`facilio whoami` prints your email).
- [ ] `facilio vibe app create` has been run at least once; `vibe.json` contains `"app": "<linkName>"`.
- [ ] The folder named in `vibe.json` `build.publish` exists and contains **`index.html`** at its root.
- [ ] Any Facilio data access in the code uses `vibe.executeAction(...)` with slugs discovered from `facilio connections search` and validated with `facilio connections execute` â€” not invented.
- [ ] Login flow is wired: `getCurrentUser()` checked on load, `login()` / `logout()` available to the user.
- [ ] If the app uses **agents** (Â§11c): `--stateful` matches the intended UX (it can't be changed later), any output schema was verified with `facilio vibe agent get <name>`, the client `JSON.parse`s `response.content`, and the reply is validated before it drives a write.
- [ ] If the app uses **file uploads** (Â§11d): type/size validated client-side, every `fileId` persisted somewhere durable, `deleteFile` called when the user removes an attachment, and object URLs revoked on unmount.

---

## 10. Pitfalls to avoid

- **Don't confuse "`index.html` must exist in the output dir" with "write everything in `index.html`."** Your source can be hundreds of files across `src/`. After `npm run build` (or whatever your tool uses), the bundler emits an `index.html` plus chunked JS/CSS/asset files into the publish folder â€” that emitted `index.html` is what satisfies the constraint.
- **Don't** ship a publish folder without `index.html` at its root â€” the deploy will technically succeed but the URL serves nothing useful. If your bundler emits to `build/` or `out/` instead of `dist/`, set `build.publish` to that folder.
- **Don't** invent connection or action slugs. If you don't know the slug, discover it with `facilio connections search <query>` â€” same session as your CLI login, and `facilio connections execute` can actually run the action for verification before you wire it into app code.
- **Don't** call `fetch('/api/runtime/connections/.../execute', ...)` directly â€” use `vibe.executeAction`, which handles URL encoding, auth redirects, and error shapes for you.
- **Don't** put the OAuth client secret in your app. The SDK and CLI never need it; identity flows happen out-of-band.
- **Don't** run `facilio vibe app create` more than once for the same app. If you need to ship to an existing app, just `facilio vibe deploy` (the `app` field in `vibe.json` is enough).
- **Don't** assume the live URL pattern. Read it from the deploy output (`Live: ...`) â€” the CLI prints it.
- **Don't** name an app with a `preview-` prefix â€” that prefix is reserved for the auto-generated preview environment of every app. See Â§5 `facilio vibe app create`.
- **Don't** tell the user a change is live in production after `facilio vibe deploy`. Every deploy from the CLI lands on the preview URL only; production requires the user to click Publish in the platform. See Â§1 "Preview vs. production."
- **Don't** ship a schema change that isn't backward-compatible. Preview and production share the same database, so old production code must keep working against the new schema until the user promotes. See Â§11 "Schema changes MUST be backward-compatible."
- **Don't** reach for an agent when a function would do. LLM agents (Â§11c) are for model work â€” chat, classification, extraction, reading an image or a document. Arithmetic, lookups, SQL, and multi-step workflows belong in a function (Â§11): exact, reproducible, and free.
- **Don't** forget `JSON.parse(res.response.content)` for a structured-output agent â€” it comes back as a JSON *string*, not a nested object. This is the single most common agent bug.
- **Don't** try to toggle `--stateful` on an existing agent â€” it's fixed at creation. Delete and recreate; the logical name can be reused so `vibe.executeAgent('<name>', â€¦)` in the UI keeps working.
- **Don't** look for a `facilio vibe files` command â€” the file store (Â§11d) is **runtime-only**, reachable solely through `vibe.uploadFile` / `listFiles` / `downloadFile` / `deleteFile`. And don't hand-roll a `fetch` to `/api/runtime/files`: if you set `Content-Type` yourself the multipart boundary is wrong and the server can't parse the upload.
- **Don't** treat a `fileId` as an authorization. The store enforces app scope, not your app's row-level rules â€” check record ownership yourself before serving a file to another user.

---

## 11. App database, tables & functions

Beyond a static UI + `executeAction`, an app can own a **database** and server-side **functions**. Both are managed through the CLI and are **app-scoped** â€” resolved from `vibe.json` (or `--app <linkName>`). Use these when the app needs to persist its own data or run logic that shouldn't live in the browser (SQL over the app's tables, multi-step work against Facilio connections).

### Database & tables

```bash
facilio vibe db create                                            # provision this app's Postgres schema+role+user (idempotent)
facilio vibe db import --file workorders.csv --table workorders   # create a table from a CSV; --table is the TABLE NAME (columns inferred)
facilio vibe db tables                                            # list the app's tables (NAME / TYPE / ROWS)
facilio vibe db describe workorders                               # a table's columns (name/type/nullable) + row count
```

`facilio vibe db create` must run before importing tables. Each app gets an **isolated schema** named after the app â€” other apps can't see it. `facilio vibe db import` is not atomic (CREATE TABLE + chunked INSERTs), so a mid-way failure can leave a partial table.

### Schema changes MUST be backward-compatible â€” always

The preview URL and the production URL of an app **share the same Postgres schema** (see the preview-vs-prod section under Â§1). There is no separate preview DB. That means at any given moment two versions of the app code can be reading and writing the same tables:

- the **preview** version â€” whatever the agent just deployed with `facilio vibe deploy`, and
- the **production** version â€” whatever the user has previously promoted via the platform.

The user may sit on that split for minutes, hours, or days before promoting the new version (or may never promote it). During that window every schema change you ship has to keep the *old* production code working while the *new* preview code also works.

**Rules â€” apply on every DB change, no exceptions:**

1. **Additive only.** Adding a new table or a new nullable column is safe. Do that instead of altering existing shape whenever possible.
2. **Never drop or rename a column or table that current production code reads or writes.** If you need to remove `foo`, first ship a version that stops reading `foo` and get it promoted; only then, in a later deploy, drop the column.
3. **Never change a column's type or constraints in a way that breaks existing rows or queries.** Widening (e.g. `int â†’ bigint`, `varchar(50) â†’ text`) is usually fine; narrowing, tightening `NOT NULL`, or changing semantics is not.
4. **New columns must be nullable, or have a default.** Old production code doing `INSERT INTO t (a, b) VALUES (...)` won't supply your new column â€” the DB must fill it.
5. **Renames = add-new + dual-write + backfill + retire-old, across at least two deploys.** Never a single deploy.
6. **`facilio vibe db import` on an existing table replaces the shape.** Treat re-importing a live table as a destructive operation and don't do it against a table production is using â€” build a new table instead and migrate the app code over.

Bottom line: think of every schema change as N-1 compatible. If old code + new schema doesn't work, or new code + old schema doesn't work, the change is not safe to ship yet â€” split it into a compatible step you can ship now and a cleanup step for later.

### Functions

App-scoped server-side handlers, compiled to WASM, that can run SQL against the app's database and call Facilio connections. The logical name you pick is unique **within the app**; the backend stores it under an app-unique physical name so functions in different apps never collide or see each other.

**Before writing a function, fetch the authoritative authoring guide** â€” it comes straight from ai-studio (via vibe-server), so it never drifts from a copied template:

```bash
facilio vibe function instructions          # prints the current guide; org-level, no --app
```

Author a function with `@facilio/studio-functions` â€” register named handlers, then `server.execute()`:

```js
import StudioFunctions, { secret } from "@facilio/studio-functions";

const server = new StudioFunctions({ name: "workorderlist", version: "1.0.0" });

server.addHandler({
  name: "list",
  description: "List open work orders",
  parameters: { limit: { description: "Max rows", type: "number" } },
  execute: async (args) => {
    const schema = secret("SCHEMA");   // this app's DB schema (after `facilio vibe db create`)
    const dbUser = secret("DB_USER");  // its DB login user
    return { rows: [] };               // return any JSON-serializable value
  },
});

server.execute();
```

**Backend-injected secrets** (read via `secret("KEY")`, never passed by the caller): `CONNECTIONS_TOKEN`, `AGENTS_TOKEN`, `SCHEMA`, `DB_USER`.

**Running DB queries inside a function.** For any database operation, the user and schema come from the secrets â€” you do NOT discover, hardcode, or ask for them:

- `secret("SCHEMA")` â€” the schema the query runs against (the app's own provisioned schema).
- `secret("DB_USER")` â€” the DB login user.

You already know your table names up front â€” a table's name is exactly the `--table <name>` you passed to `facilio vibe db import`. So you just write a plain SQL query against that table â€” e.g. for a table imported as `--table workorders`, the query is `select * from workorders;`. That's it: the table name is known, and which schema to hit is supplied by the `SCHEMA` secret. (vibe-server injects both via `FunctionRunUtil.buildSecrets`.)

CLI lifecycle â€” **create â†’ build â†’ run**:

```bash
facilio vibe function create workorderlist --code ./workorderlist.js --description "List open work orders"
facilio vibe function build  workorderlist                             # compile to WASM (required before run)
facilio vibe function run    workorderlist list --args '{"limit":20}'  # execute a handler; prints its return value
facilio vibe function list                                             # NAME / BUILT / DESCRIPTION for this app
facilio vibe function get    workorderlist                             # build state + source (--code-only for raw code)
facilio vibe function update workorderlist --code ./workorderlist.js   # re-upload; rebuild afterward
facilio vibe function delete workorderlist
```

All `facilio vibe function` commands accept `--app <linkName>` (default: the `app` in `vibe.json`). Aliases: `fn`, `ls` (list), `show` (get), `rm` (delete), `exec` (run).

### Running a function from the deployed app (SDK)

At runtime, invoke a built function from the browser with the SDK:

```ts
const orders = await vibe.executeFunction('workorderlist', 'list', { limit: 20 });
```

The backend resolves the app from the subdomain, injects the secrets, and runs only that app's function. Returns the handler's output; throws `VibeError` on failure. Secrets are never sent from the browser â€” only `args`.

### Scheduled jobs

An app can also **schedule one of its built functions to run on a recurring schedule** (cron or fixed-interval) without any browser being open. Each fire executes as the app's dedicated public user â€” same identity, same tokens, same DB access it would have inside `vibe.executeFunction`. The whole feature is app-scoped and driven from the CLI.

**When to reach for this** (vs. calling a function from the browser):

- Recurring server-side work â€” daily reports, hourly polls, nightly cleanup, cache refresh, sync jobs.
- Anything the browser can't be relied on to trigger (user closes the tab, no user is signed in, etc.).
- **Not** for reacting to a user click â€” that's still `vibe.executeFunction` from the browser.

**Two hard product bounds â€” enforced on every create and update:**

1. **Minimum interval between fires: 15 minutes.** `intervalSeconds >= 900`. For cron, the CLI parses your expression and rejects it if two consecutive slots are under 15 min apart.
2. **Maximum timeout per fire: 15 minutes (900 s).** A fire that runs longer is cancelled and recorded as failed. Also the default.

**Prerequisites** â€” a job can only be created when:

1. The app exists (`facilio vibe app create`).
2. The function is built (`facilio vibe function build <name>`).
3. **The app has been promoted to production.** Scheduled jobs always target the **prod** physical function name (`<name>_<uuid>`); preview functions are dev-loop artifacts and are deliberately not schedulable. Attempting to schedule a job on an app that only exists on preview will land the row but every fire will fail with "function not found".

**CLI lifecycle â€” create â†’ observe â†’ (pause/resume) â†’ delete:**

```bash
# Cron â€” every day at 9 AM (org timezone; falls back to UTC)
facilio vibe jobs create daily-report \
  --function sendDailyReport \
  --handler default \
  --cron '0 0 9 * * *' \
  --payload '{"recipients":["ops@example.com"]}' \
  --timeout 300

# Interval â€” every 30 min, minimum viable flags
facilio vibe jobs create healthcheck --function pingUpstream --interval 1800

# Observe
facilio vibe jobs list                              # NAME / FUNCTION / SCHEDULE / STATUS / LASTRUN
facilio vibe jobs get  daily-report                 # full detail incl. last-run outcome + error

# Modify (partial PATCH â€” pass only what changes)
facilio vibe jobs update daily-report --cron '0 30 9 * * *'
facilio vibe jobs update daily-report --payload '{"recipients":["ops@example.com","cto@example.com"]}'

# Hold / resume without losing config
facilio vibe jobs pause  daily-report               # stops firing; scheduler row cancelled, DB row kept
facilio vibe jobs resume daily-report               # re-schedules; first fire at "now + interval"

# Remove
facilio vibe jobs delete daily-report
```

Aliases: `job` (jobs), `ls` (list), `show` (get), `rm` (delete). Every command accepts `--app <linkName>` (default: `vibe.json`'s `app`).

**Payload â†’ function args mapping.** Whatever JSON object you pass as `--payload` is forwarded verbatim as the function handler's `args` at every fire. The function reads it exactly as it would from a browser-driven `vibe.executeFunction(fn, handler, args)` call. Use this to distinguish scheduled fires from manual ones â€” e.g. send `{"source":"scheduled"}` from cron, and have the browser call pass `{"source":"manual"}`.

**Cron vs interval â€” which to pick:**

- **Cron** when timing matters to the outside world â€” "9 AM daily", "1st of the month", "Monday 8 AM". Fires align to wall-clock ticks.
- **Interval** when the exact moment doesn't matter â€” "roughly every N minutes". Fires spaced by *interval* after the previous one *completes*.

**Failure model â€” deliberately simple.** A failed fire (function threw, timed out, DB down, etc.) is recorded as `LAST_RUN_STATUS=FAILED` with `LAST_RUN_ERROR=<msg>`, and the job **keeps firing on schedule**. No backoff, no max-retries pause. If a job is broken, pause it manually (`facilio vibe jobs pause <name>`), fix the function or payload, then resume. `facilio vibe jobs get <name>` is the fastest way to see the last-run outcome â€” always check that before adding logs.

**Multi-server safety.** Behind the scenes each job maps to a row in the platform's `scheduled_tasks` table; multiple vibe-server pods coordinate via `SELECT ... FOR UPDATE SKIP LOCKED` so exactly one pod fires each due row. Nothing for the agent to configure â€” but useful to know that scaling out is automatic and duplicate fires cannot happen for a healthy pod.

---

## 11b. Exposing your app as a Facilio Connection â€” `facilio vibe connection` (alias `conn`)

An app doesn't just **consume** Facilio Connections (Â§6) â€” it can also **be one**. `facilio vibe connection` turns the current Vibe app into a first-class connection in the Facilio Connections catalog, with each function handler registered as an **action** callable via `facilio connections execute`, from other apps, and from AI agents.

**When to reach for this** (vs. plain `vibe.executeFunction` from the browser):

- You want another Facilio app / agent / integration to invoke this app's logic â€” not just this app's own frontend.
- You want the handler to show up in `facilio connections search` and inherit the standard input/output schema surface.
- Not for browser-only workflows â€” those stay on `vibe.executeFunction`.

**Lifecycle:** enable the provider â†’ register actions from built handlers â†’ update / toggle â†’ publish from the platform.

```bash
# One-time: turn the current app into a connection on connections-server (idempotent).
facilio vibe connection enable

# Metadata â€” pass only the fields you want to change.
facilio vibe connection update --display-name "My Dashboard" --description "Ops dashboard connection"
facilio vibe connection update --active false

# Actions â€” map function-handler pairs into the connection.
facilio vibe connection actions list                                        # SLUG / NAME / TYPE / ACTIVE / DRAFT
facilio vibe connection actions list --draft --q workorder                  # filter by draft + substring
facilio vibe connection actions get list_workorders                         # full detail (schemas, template)
facilio vibe connection actions get list_workorders --draft                 # read the draft copy

facilio vibe connection actions create "List work orders" \
  --function workorderlist --handler list --type read \
  --description "Return open work orders (optionally capped by limit)" \
  --input-schema  '{"type":"object","properties":{"limit":{"type":"number"}}}' \
  --output-schema '{"type":"object","properties":{"rows":{"type":"array"}}}'

facilio vibe connection actions update list_workorders --description "Return open work orders for this tenant"
facilio vibe connection actions update list_workorders --function workorderlist --handler listOpen   # re-target: --function + --handler MUST pass together
facilio vibe connection actions update list_workorders --active false
```

Every command accepts `--app <linkName>` (default: `vibe.json`'s `app`). Aliases: `conn` (connection), `action` (actions), `ls` (actions list), `show` (actions get).

**Key rules:**

- `--function` and `--handler` MUST be passed together on `actions update` â€” they rewrite the derived `request_template`. Passing one without the other is rejected.
- Actions are written as **draft** â€” publish the connection from the platform UI to promote them live.
- `update` (both connection- and action-level) with no updatable flags is rejected.
- The function referenced by an action must already be **built** (`facilio vibe function build <name>`); otherwise the action will exist but fail at call time.

---

## 11c. AI agents in an app â€” `facilio vibe agent` (alias `agents`)

An app can also register **LLM agents** â€” model-backed handlers that take a plain-text input and return a reply, optionally shaped by a JSON output schema. Each agent has a **logical name** you pick (`hello-agent`, `sentiment-agent`), a model provider + model, optional `role` / `instructions`, an optional `output-schema`, and an optional `--stateful` flag that carries the conversation across calls for the signed-in user. Every agent is app-scoped and resolved from `vibe.json` (or `--app`).

**When to reach for this** (vs. `vibe.executeFunction` or `vibe.executeAction`):

- The workload is a **model call** â€” chat, classification, extraction, structured summarization â€” not deterministic business logic.
- You want the browser to invoke an LLM without a server round-trip you wrote yourself.
- **Not** for CRUD, integrations, or scheduled work â€” those stay on functions / connections / jobs.

**Lifecycle â€” create â†’ sanity-check from the CLI â†’ call from the browser:**

```bash
# 1) Simple chat agent
facilio vibe agent create hello-agent \
  --model-provider openai --model-name gpt-4o-mini \
  --role "You are a warm greeter." \
  --instructions "Greet the user. One short sentence."

# 2) Stateful â€” remembers the signed-in user across calls, reloads, and devices
facilio vibe agent create hello-agent-stateful \
  --model-provider openai --model-name gpt-4o-mini \
  --instructions "If the user shared their name earlier, use it." \
  --stateful

# 3) Structured output â€” reply is enforced against a JSON schema
facilio vibe agent create sentiment-agent \
  --model-provider openai --model-name gpt-4o-mini \
  --instructions "Classify the input's sentiment. Reply as JSON matching the schema." \
  --output-schema-file agent-schemas/sentiment.json

# Observe / inspect / retire
facilio vibe agent list                   # NAME / AGENTID / STATEFUL / LINKNAME
facilio vibe agent get sentiment-agent    # provider, model, role, instructions, output_schema (verbatim)
facilio vibe agent run hello-agent --input "Say hi to Vishnu"
facilio vibe agent run hello-agent-stateful --input "What's my name?" --thread-id 31541   # continue a prior CLI conversation
facilio vibe agent update hello-agent --model-name gpt-4o                # everything except --stateful is mutable
facilio vibe agent delete hello-agent
```

Every command accepts `--app <linkName>` (default: `vibe.json`'s `app`). Aliases: `agents` (agent), `ls` (list), `show` (get), `exec` (run), `rm` (delete).

**Calling an agent from the browser â€” `vibe.executeAgent(name, input, opts?)`** (SDK v0.2.0+; `opts.fileIds` needs v0.2.1+):

```ts
// Free-form reply
const res = await vibe.executeAgent('hello-agent', 'Say hi to Vishnu');
console.log(res.response.content);          // "Hello, Vishnu!"

// Structured output â€” response.content is a JSON *string*; parse it
const r2 = await vibe.executeAgent('sentiment-agent', reviewText);
const parsed = JSON.parse(r2.response.content);
// parsed â†’ { sentiment, confidence, keywords, summary }

// With attachments â€” upload first (Â§11d), then pass the ids
const photo = await vibe.uploadFile(file);
const r3 = await vibe.executeAgent('inspector', 'What is wrong here?', {
  fileIds: [photo.fileId],
});
```

**The browser never sends a thread id and never sends an app id.** The server resolves the app from the request host (the subdomain the page is served on), looks the agent up by `(app, name)`, and â€” for `--stateful` agents â€” resolves or creates a persistent thread scoped to the signed-in user. A second call from the same user continues the first; memory survives reloads and device switches. Stateless agents get a fresh conversation on every call.

**Attachments â€” images and documents (runtime only):**

- Upload with `vibe.uploadFile(file)` (Â§11d), then pass `{ fileIds: [id, â€¦] }`. There is **no CLI attachment path** â€” `facilio vibe agent run` is text-only.
- The server splits them by stored content type: **`image/*` â†’ the agent's vision input**, everything else is **extracted into its context** as text.
- **Max 10 files per run.**
- Attachments belong to the run they're sent with. For a **stateful** agent the thread already remembers them â€” **do not re-send the same `fileIds` on the next turn**.
- `fileIds` must belong to the same app's file store. Omitting the option sends a request byte-identical to a no-attachment call.
- Anything attached is sent to the configured model provider â€” tell the user so in the UI.

**Output schema requirements:**

- **`title` is mandatory** and must match `[A-Za-z0-9_-]{1,64}` â€” missing â†’ `400 output schema title is mandatory`.
- `type`, `enum`, `items`, `properties`, `required`, `description`, and `additionalProperties` are preserved as-is.
- Numeric bounds (`minimum` / `maximum`) are **not preserved** on the server round-trip â€” if you need a hard range, restate it in the instructions ("confidence between 0 and 1"). The model honors that reliably.

**Key rules:**

- `--stateful` is **fixed at creation** and cannot be toggled with `update` â€” delete and recreate to switch modes. The logical name can be reused, so `vibe.executeAgent('<name>', input)` in the UI keeps working.
- `facilio vibe agent run` is a CLI dev harness; each invocation opens a fresh conversation unless you pass `--thread-id`. The runtime path (`vibe.executeAgent`) is what carries per-user memory for stateful agents.
- For structured-output agents, always `JSON.parse(response.content)` on the client â€” it comes back as a string, not a nested object.
- Confirm the schema round-tripped exactly as you wrote it via `facilio vibe agent get <name>` before wiring UI to specific fields.
- **Agents are for model calls only** â€” chat, classification, extraction, summarization, reading an image or a document. Arithmetic, lookups, SQL, and multi-step workflows belong in a **function** (Â§11); Facilio/external data belongs in an **action** (Â§6). A good shape is: a function gathers the data, the agent interprets it, and your code validates the structured reply before acting on it.
- **Treat agent output as untrusted input.** A schema constrains *shape*, not truthfulness. Validate before it drives a DB write, a connection action, or raw HTML. Likewise, never put secrets or privileged ids in `--instructions` â€” instructions are not a security boundary.
- Prefer the org's configured provider credentials over `--api-key`. If you must pass a key, read it from the environment; never hard-code it or echo it back.

**Common rejections:**

| Message | Cause |
|---|---|
| `output schema title is mandatory and must match [A-Za-z0-9_-]{1,64}` (400) | Schema missing `title`, or `title` has disallowed characters. |
| `link_name cannot be updated. It is immutable after creation.` (403) | Tried to change `--stateful` on an existing agent. Delete + recreate. |
| `Agent "<name>" already exists in "<app>"` | `create` on an existing name â€” use `update`. |
| `Agent "<name>" not found in "<app>"` | `update`/`get`/`run`/`delete` before `create`, or wrong app target. |
| `No app target. Run inside a vibe app directory (vibe.json) or pass --app <linkName>.` | Ran outside the project dir with no `--app`. |
| `Pass at most one of --output-schema or --output-schema-file.` | Both supplied. |
| `outputSchema must be valid JSON.` / `must be a JSON object` | Malformed schema, or a root that isn't an object. |
| `--thread-id must be an integer.` | Non-integer thread id â€” use the `thread_id` from a previous run. |
| `executeAgent <name> failed: 404` (browser) | The agent doesn't exist for **this** app, or the logical name is misspelled. |

---

## 11d. The app file store â€” runtime uploads (SDK only)

Every app has a **private file store**, reachable **only from the browser** via `@facilio/vibe-sdk` **v0.2.1+**. There is **no `facilio vibe files` CLI command** and no author-time upload path â€” do not invent one, and do not `fetch` a guessed URL.

The unit of currency is the **`fileId`**: a number returned on upload that is the durable handle for everything downstream. The storage path is never exposed to the browser.

```ts
const stored = await vibe.uploadFile(file);          // File from an <input>
const stored = await vibe.uploadFile(blob, 'signature.png');   // a Blob has no name â€” pass one

const files  = await vibe.listFiles();               // this app's files, newest first
const blob   = await vibe.downloadFile(4821);        // bytes as a Blob
await vibe.deleteFile(4821);                         // soft delete; reads stop immediately
```

`uploadFile` / `listFiles` return `VibeFile`:

```ts
interface VibeFile {
  fileId: number;               // the durable handle â€” this is what you keep
  fileName: string;
  contentType: string | null;
  size: number | null;          // bytes
  uploadedTime: number | null;  // epoch ms
  uploadedBy: number | null;    // user id
}
```

**Three properties that explain every rule below:**

1. **App scope comes from the request host** (`POST /api/runtime/files`) â€” you never pass an app id, and one app cannot read another's files.
2. **`fileId` is the only handle.** Lose it and, as far as your app is concerned, the file is gone.
3. **Uploads are append-only.** Two uploads of `photo.png` are two files with two ids â€” no overwrite, no dedup.

**Key rules:**

- **Never set a `Content-Type` header yourself.** The SDK posts `multipart/form-data` and lets the browser set the header, because only the browser knows the multipart boundary it generated. Hand-setting it produces a request the server can't parse.
- **A `Blob` needs an explicit name** â€” `uploadFile(blob, 'shot.png')`. A canvas export, pasted screenshot, or generated PDF has none of its own; omit it and the filename is recorded as `undefined`.
- **Preview from the local `File`, not a round trip** â€” `URL.createObjectURL(file)` for a file the user just picked. `downloadFile(fileId)` is for rendering something you only hold an id for (after a reload, another device, another user). Always `URL.revokeObjectURL` on unmount.
- **Persist the id where the record lives** â€” an app-DB column (Â§11), a function payload, or a connection action (Â§6). `listFiles()` has no notion of which inspection or work order a file belongs to; that link is yours to keep.
- **Delete on cancel.** If the user removes an attachment before submitting, `deleteFile(fileId)` â€” otherwise the upload is orphaned.
- **Validate type and size client-side before uploading**, and reject early with a clear message.
- **A `fileId` is a handle, not an authorization.** The store enforces app scope, not your app's row-level rules â€” if a file belongs to one tenant's record, check that yourself before serving it to another user.
- **Never render downloaded bytes or extracted text as HTML.** Treat both as untrusted input.

**Reference pattern:**

```ts
const MAX_BYTES = 10 * 1024 * 1024;   // a limit your app chooses, not a platform cap

async function onPick(e) {
  const file = e.target.files?.[0];
  e.target.value = '';                          // let the same file be re-picked
  if (!file) return;
  if (!file.type.startsWith('image/')) return showError('Images only.');
  if (file.size > MAX_BYTES)           return showError('Max 10 MB.');

  const stored = await vibe.uploadFile(file);
  setPreview(URL.createObjectURL(file));        // local preview â€” no round trip
  // Persist the id somewhere durable, not just component state:
  await vibe.executeFunction('inspections', 'addPhoto', {
    inspectionId, fileId: stored.fileId, fileName: stored.fileName,
  });
}
```

To let an agent read the file, pass its id to `executeAgent` â€” see the attachments rules in Â§11c.

**Common errors:**

| Symptom | Cause |
|---|---|
| `vibe.uploadFile is not a function` | `@facilio/vibe-sdk` older than 0.2.1 â€” upgrade; don't hand-roll a `fetch`. |
| Server can't parse the upload | A `Content-Type` header was set manually. |
| Filename recorded as `undefined` | A `Blob` uploaded with no `name` argument. |
| `file is required` | Called with `undefined` â€” guard on `e.target.files?.[0]`. |
| `uploadFile â€¦ failed: 401` | Session expired. Drive login from `getCurrentUser()` returning `null`, not from this catch block. |
| `downloadFile <id> failed: 404` | Id doesn't belong to this app, or the file was deleted. Ids are app-scoped. |
| Duplicate files piling up | Every upload mints a new id â€” `deleteFile` the old one when replacing an attachment. |

---

## 11e. Realtime updates over WebSocket â€” `vibe.subscribe` + `VibeEvents`

An app can receive **live updates over a WebSocket** instead of polling. Two halves:

- **Browser subscribes** â€” `@facilio/vibe-sdk` **v0.3.0+**.
- **Server function publishes** â€” `VibeEvents` from `@facilio/studio-functions` (rebuild the function after adding it: `facilio vibe function build <name>`).

```
server function: await events.publish('posts', {...})   â†’   browser: vibe.subscribe('posts', cb)
```

Nothing to declare in `vibe.json`; there is **no `facilio vibe realtime` command** and no per-app enable step. Subscribing connects.

### Client â€” the entire surface

```ts
const sub = vibe.subscribe('posts', (evt) => {
  // evt = { topic, eventId, ts, payload }
  if (evt.payload.type === 'post.created') prependCard(evt.payload.post);
});
sub.unsubscribe();

vibe.realtimeState;                      // 'idle'|'connecting'|'open'|'reconnecting'|'closed'
const stop = vibe.onRealtimeState((s) => setLive(s === 'open'));   // returns a remove-listener fn
vibe.closeRealtime();                    // close and drop every subscription
```

| Method | Purpose |
|---|---|
| `subscribe(topic, handler)` | Receive events on `topic`. Returns `{ unsubscribe() }`. |
| `realtimeState` | Current connection state. |
| `onRealtimeState(listener)` | Notified on state change â€” for a "Live" indicator. |
| `closeRealtime()` | Close the connection, drop all subscriptions. |

- **The browser cannot publish.** There is no `vibe.publish`. Browser â†’ server is `vibe.executeFunction`.
- **No `since` / sequence / replay / presence / typing / SSE.** Do not write against any of these â€” they do not exist.
- Reconnection and re-subscription are automatic. **Never hand-roll a reconnect loop.**
- In React, subscribe inside an effect and **always return the unsubscribe**, or re-renders stack duplicate handlers.

### Server â€” publishing from a function

```js
import StudioFunctions, { VibeEvents } from '@facilio/studio-functions';

const server = new StudioFunctions();
const events = new VibeEvents();                     // takes NO arguments

server.addHandler({
  name: 'createPost',
  execute: async (args) => {
    const post = await insertPost(args);                             // do the work first
    await events.publish('posts', { type: 'post.created', post });   // then notify
    return { ok: true, post };
  },
});
```

`await events.publish(topic, payload)` â†’ `{ ok, topic, receivers, error? }`

- **`await` it** â€” unlike `db.query()` it is async, and it costs ~50 ms of handler time. One publish per mutation, **never inside a row loop**.
- **Publish AFTER the work succeeded**, never before.
- **It never throws.** Delivery failure returns `{ ok:false, error }` and the handler carries on â€” a lost notification must not fail a committed write. Check `.ok` to log it.
- **`receivers: 0` is normal** â€” it counts servers with listeners attached, not browsers, so `0` just means nobody has the app open.
- Publishes work from a function called by the browser, by a **scheduled job** (Â§11, always the PROD channel), or by `facilio vibe function run`. **LLM agents cannot publish** today â€” publish from a function instead.

### Topic names

Up to 64 characters of letters, numbers, `.`, `_`, `-`. Dots for hierarchy.

âœ… `posts` Â· `post.42` Â· `job-progress` Â· `asset.183.readings`
âŒ `post/42` Â· `my topic` Â· `posts*` (slashes, spaces and `*` are rejected)

Pick the granularity a screen needs to redraw: one shared topic for a feed everyone watches, a per-record topic when only the people on that record care.

### Rules that change how you write the app

- **Preview and production are separate channels.** The same topic name in a preview app and a live app are two different topics â€” a preview tab never sees a live job's events. This is the #1 cause of "published, but nothing arrived".
- **Topics are app-wide, not per-user.** Everyone subscribed gets everything published on that topic, so **never put one user's private data on a topic** â€” especially in a PUBLIC app, where all anonymous visitors share one identity. Fetch sensitive data with `executeFunction`.
- **Events are not stored.** A closed or offline tab misses whatever was published meanwhile. Reload on connect and let events keep things fresh after that:
  ```ts
  vibe.onRealtimeState((s) => { if (s === 'open') loadFeed(); });   // fires on first connect AND every reconnect
  ```
- **The app DB stays the source of truth**; realtime is a hint. An event can even arrive *before* the `executeFunction` that caused it returns, so make the client's apply idempotent (dedupe on `eventId`).
- **Keep payloads under 32 KB** and **at most 20 topics per tab**. Send ids, not blobs.
- **The publish leg cannot be tested against a local dev server** â€” the function runtime's outbound fetch is HTTPS/public-host only, so it can never reach `localhost`. Subscribing works locally; exercise the full loop on a deployed preview or live app, and say so rather than debugging a phantom.

### Common errors

| Symptom | Cause |
|---|---|
| `vibe.subscribe is not a function` | `@facilio/vibe-sdk` older than 0.3.0 â€” upgrade; don't hand-roll a WebSocket. |
| `realtimeState` stuck, then `closed` after ~30 s | The connection never opened â€” realtime disabled for the environment, or a proxy stripped the upgrade headers. |
| `publish` â†’ `ok:false, "realtime publishing is not enabled for this run"` | The run got no publish credentials â€” realtime is off for that environment. |
| `publish` â†’ `ok:true, receivers:0` and nothing arrives | Nothing subscribed anywhere. Usually a preview-vs-production channel mismatch. |
| Events arrive, callback never fires | The published topic string doesn't exactly match the one passed to `subscribe` (case-sensitive). |
| Updates stop but the UI looks connected | A handler threw â€” it is caught and logged as `[vibe] realtime handler threw` rather than killing the socket. |
| `bad_topic` error | The topic broke the charset rule â€” use dots, not slashes (`post.42`, not `post/42`). |

**When polling is still right:** realtime needs a function to publish. If the change happens *outside* the app (a record edited in the Facilio product, an external system's data), nothing publishes â€” poll a function with a cursor, or have a scheduled job detect the change and publish.

---

## 12. Reference index

| File                                           | Purpose                                                                 |
|------------------------------------------------|-------------------------------------------------------------------------|
| `facilio-cli/README.md`                        | Unified CLI command reference, env vars, login flow internals.          |
| `facilio-cli/src/commands/`                    | Source for top-level `login`, `logout`, `whoami` commands.              |
| `facilio-cli/src/products/vibe/`               | Source for the `facilio vibe â€¦` product namespace: `deploy`, `app` (+ `thumbnail` / `logo`), `db`, `function`, `jobs`, `agent`, `connection`. |
| `vibe-sdk/README.md`                           | SDK API surface, install, plain-HTML usage.                             |
| `vibe-sdk/src/index.ts`                        | The full SDK â€” `createVibe`, `login`, `logout`, `getCurrentUser`, `executeAction`, `executeFunction`, `executeAgent`, `uploadFile` / `listFiles` / `downloadFile` / `deleteFile`, `subscribe` / `realtimeState` / `onRealtimeState` / `closeRealtime`, `fetch`. |
| `vibe-sdk/examples/smoke-test/`                | Minimal vanilla-HTML SDK smoke test.                                    |
| `vibe-react-test/`                             | Working React + Vite + SDK reference app, already deployed once.        |
| `facilio connections search` / `schemas` / `execute` | **Authoritative catalog** of `connectionSlug`, `actionSlug`, payload schemas. Runs on the same `facilio login` session â€” search, read schemas, dry-run, execute. Use whenever you need to call data. |