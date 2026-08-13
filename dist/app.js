(() => {
  // node_modules/@facilio/vibe-sdk/dist/index.mjs
  var VibeError = class extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
      this.name = "VibeError";
    }
  };
  var Vibe = class {
    constructor(cfg = {}) {
      const base = cfg.serverURL ?? (typeof window !== "undefined" ? window.location.origin : void 0);
      if (!base) {
        throw new VibeError("VibeConfig.serverURL is required outside the browser");
      }
      this.serverURL = base.replace(/\/+$/, "");
      this.service = cfg.service ?? "vibe";
    }
    login(redirectTo = currentURL()) {
      assignLocation(this.buildAuthURL("login", redirectTo));
    }
    logout(redirectTo = currentURL()) {
      assignLocation(this.buildAuthURL("logout", redirectTo));
    }
    async getCurrentUser() {
      const res = await fetch(`${this.serverURL}/api/runtime/getCurrentUser`, {
        credentials: "include",
        headers: { Accept: "application/json" }
      });
      if (res.status === 401) return null;
      if (!res.ok) {
        throw new VibeError(`getCurrentUser failed: ${res.status} ${res.statusText}`, res.status);
      }
      return await res.json();
    }
    async isAuthenticated() {
      return await this.getCurrentUser() !== null;
    }
    async fetch(path, init = {}) {
      const url = /^https?:\/\//.test(path) ? path : `${this.serverURL}${path.startsWith("/") ? "" : "/"}${path}`;
      const res = await fetch(url, { ...init, credentials: "include" });
      if (res.status === 401) {
        this.login();
        throw new VibeError("Not authenticated; redirecting to login", 401);
      }
      return res;
    }
    /**
     * Invoke a Connections SDK action through vibe-server.
     *
     * Routes to `POST /api/runtime/connections/{connectionSlug}/actions/{actionSlug}/execute`
     * on vibe-server, which builds a Connections SDK client for the current
     * identity and proxies the call via `ConnectionsClient.executeAction`.
     * `body` is sent as the action's JSON input (defaults to `{}`).
     */
    async executeAction(connectionSlug, actionSlug, body = {}) {
      if (!connectionSlug) throw new VibeError("connectionSlug is required");
      if (!actionSlug) throw new VibeError("actionSlug is required");
      const url = `${this.serverURL}/api/runtime/connections/${encodeURIComponent(connectionSlug)}/actions/${encodeURIComponent(actionSlug)}/execute`;
      const res = await this.fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        let detail = "";
        try {
          detail = await res.text();
        } catch {
        }
        throw new VibeError(
          `executeAction ${connectionSlug}/${actionSlug} failed: ${res.status} ${res.statusText}${detail ? ` \u2014 ${detail}` : ""}`,
          res.status
        );
      }
      if (res.status === 204) return void 0;
      return await res.json();
    }
    /**
     * Upload a file to the app's file store.
     *
     * Routes to `POST /api/runtime/files` as `multipart/form-data`. The app is
     * resolved from the host the browser was served on, so uploads are scoped to
     * this app without the caller passing anything.
     *
     * Returns the stored file, whose `fileId` is the handle every consumer takes —
     * `executeAgent(..., { fileIds })`, {@link downloadFile}, {@link deleteFile},
     * or a column in your own app table. Uploads are never overwritten: two
     * uploads of `photo.png` are two files with two ids.
     *
     * `name` overrides the filename recorded server-side, which matters for a
     * `Blob` (a canvas export, a pasted screenshot) since a Blob has no name of
     * its own.
     */
    async uploadFile(file, name) {
      if (!file) throw new VibeError("file is required");
      const fileName = name ?? (file instanceof File ? file.name : void 0);
      const form = new FormData();
      if (fileName) form.append("file", file, fileName);
      else form.append("file", file);
      const res = await this.fetch("/api/runtime/files", {
        method: "POST",
        headers: { Accept: "application/json" },
        body: form
      });
      if (!res.ok) {
        const detail = await detailOf(res);
        throw new VibeError(
          `uploadFile ${fileName ?? ""} failed: ${res.status} ${res.statusText}${detail ? ` \u2014 ${detail}` : ""}`,
          res.status
        );
      }
      return await res.json();
    }
    /** This app's files, newest first. */
    async listFiles() {
      const res = await this.fetch("/api/runtime/files", {
        headers: { Accept: "application/json" }
      });
      if (!res.ok) {
        throw new VibeError(`listFiles failed: ${res.status} ${res.statusText}`, res.status);
      }
      const payload = await res.json();
      return payload.files ?? [];
    }
    /**
     * Fetch a stored file's bytes as a `Blob`.
     *
     * For a file the user just picked, prefer `URL.createObjectURL(file)` — it
     * needs no round trip. This is for rendering or re-reading a file you only
     * have the id for.
     */
    async downloadFile(fileId) {
      if (!fileId) throw new VibeError("fileId is required");
      const res = await this.fetch(`/api/runtime/files/${encodeURIComponent(String(fileId))}`);
      if (!res.ok) {
        throw new VibeError(
          `downloadFile ${fileId} failed: ${res.status} ${res.statusText}`,
          res.status
        );
      }
      return await res.blob();
    }
    /**
     * Soft-delete a stored file. Reads stop serving it immediately.
     *
     * Worth calling when a user removes an attachment before sending it —
     * otherwise the upload is left unreferenced.
     */
    async deleteFile(fileId) {
      if (!fileId) throw new VibeError("fileId is required");
      const res = await this.fetch(`/api/runtime/files/${encodeURIComponent(String(fileId))}`, {
        method: "DELETE",
        headers: { Accept: "application/json" }
      });
      if (!res.ok) {
        throw new VibeError(
          `deleteFile ${fileId} failed: ${res.status} ${res.statusText}`,
          res.status
        );
      }
    }
    /**
     * Execute a Vibe agent through vibe-server.
     *
     * Routes to `POST /api/runtime/agents/{name}/run`. The server:
     *  - resolves the app from the request host (the subdomain the browser is on),
     *  - looks up the agent by (app, name) in `Vibe_Agents`,
     *  - and — if the agent was created with `stateful: true` — resolves or creates
     *    a persistent flow-ai thread scoped to the current user, so multi-turn
     *    conversations survive page reloads and device switches automatically.
     *
     * The browser sends `{ input }` plus any `fileIds` — `threadId` and
     * `outputSchema` are server-owned (thread is server-managed; outputSchema is a
     * create-time contract stored on the agent).
     *
     * Attach files by uploading them first with {@link uploadFile} and passing the
     * ids:
     *
     * ```ts
     * const photo = await vibe.uploadFile(file);
     * const res = await vibe.executeAgent('inspector', 'What is wrong here?', {
     *   fileIds: [photo.fileId],
     * });
     * ```
     *
     * The server splits them by stored content type — `image/*` goes to the
     * agent's vision input, everything else is extracted into its context — and
     * caps a single run at 10 files. Attachments belong to the run they are sent
     * with; for a stateful agent the thread already remembers them, so do not
     * re-send them on the next turn.
     *
     * Returns the flow-ai `RunResponse` verbatim: `{ runId, threadId, status,
     * response, errorMessage?, ... }`. Throws {@link VibeError} if the request
     * fails or the run errors.
     */
    async executeAgent(name, input, opts = {}) {
      if (!name) throw new VibeError("agent name is required");
      if (!input || !input.trim()) throw new VibeError("input is required");
      const url = `${this.serverURL}/api/runtime/agents/${encodeURIComponent(name)}/run`;
      const body = { input };
      if (opts.fileIds?.length) body.fileIds = opts.fileIds;
      const res = await this.fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        let detail = "";
        try {
          detail = await res.text();
        } catch {
        }
        throw new VibeError(
          `executeAgent ${name} failed: ${res.status} ${res.statusText}${detail ? ` \u2014 ${detail}` : ""}`,
          res.status
        );
      }
      const payload = await res.json();
      if (payload.errorMessage) {
        throw new VibeError(`agent ${name} errored: ${payload.errorMessage}`);
      }
      return payload;
    }
    /**
     * Execute a handler of a built Vibe function through vibe-server.
     *
     * Routes to `POST /api/runtime/functions/{name}/handlers/{handler}/run`, which
     * mints the backend secrets (the connections token) for the current identity
     * and invokes the function's Lambda directly. Only `args` travel from the
     * browser — secrets are never sent from the client.
     *
     * Returns the handler's output. Throws {@link VibeError} if the request fails
     * or the function itself errors.
     */
    async executeFunction(name, handler, args = {}) {
      if (!name) throw new VibeError("function name is required");
      if (!handler) throw new VibeError("handler is required");
      const url = `${this.serverURL}/api/runtime/functions/${encodeURIComponent(name)}/handlers/${encodeURIComponent(handler)}/run`;
      const res = await this.fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(args)
      });
      if (!res.ok) {
        let detail = "";
        try {
          detail = await res.text();
        } catch {
        }
        throw new VibeError(
          `executeFunction ${name}/${handler} failed: ${res.status} ${res.statusText}${detail ? ` \u2014 ${detail}` : ""}`,
          res.status
        );
      }
      const payload = await res.json();
      if (payload.ok === false) {
        throw new VibeError(
          `function ${name}/${handler} errored: ${payload.error ?? "unknown error"}`
        );
      }
      return payload.output;
    }
    /**
     * Start a function run in the background and return as soon as the server accepts
     * it, without waiting for the function to finish.
     *
     * Routes to `POST /api/runtime/functions/{name}/handlers/{handler}/runAsync`. The
     * run executes as the same identity and on the same deployment channel as
     * {@link executeFunction} would, so the only difference a handler can observe is
     * that nobody is waiting for it.
     *
     * Reach for this when the work outlives the wait a user will tolerate — a bulk
     * import, a long sync, a report build. For anything the UI needs an answer to
     * right now, {@link executeFunction} is still the right call.
     *
     * **The resolved promise means accepted, not succeeded.** There is nothing to poll
     * and the platform publishes nothing — reporting is your handler's job, over the
     * realtime topics it already publishes on. Wrap the handler body in a `try/catch`
     * and publish both outcomes, or a failure is visible only in server logs.
     *
     * ```ts
     * // in the browser — subscribe first, so a fast run can't finish before you listen
     * vibe.subscribe<{ runId: string; ok: boolean; error?: string }>('imports', (evt) => {
     *   if (evt.payload.runId === myRunId && !evt.payload.ok) showError(evt.payload.error);
     * });
     * const { runId } = await vibe.executeFunctionAsync('import', 'default', { fileId });
     *
     * // in the handler — publish the runId back so the browser can correlate
     * try   { await doWork(args); await publish('imports', { runId: args.runId, ok: true }); }
     * catch (e) { await publish('imports', { runId: args.runId, ok: false, error: e.message }); }
     * ```
     *
     * Pass your own correlation value in `args` if the handler needs it — the server's
     * `runId` is not visible inside the function.
     *
     * Throws {@link VibeError} with status 429 when the app is already at its
     * concurrent-run limit — backpressure, not a bug: wait for some to finish. A 400
     * means the function is not built; that check happens up front precisely because
     * after the 202 there is no channel left to report it on.
     *
     * Two failures your handler cannot report, because they kill it from outside: the
     * `timeoutSeconds` ceiling, and a deploy mid-run. Both look like a run still in
     * progress, so give long-running UI its own timeout. Work that must not be lost
     * belongs in a scheduled job, not here.
     *
     * `timeoutSeconds` bounds one run's wall-clock (1..900, default 900).
     */
    async executeFunctionAsync(name, handler, args = {}, opts = {}) {
      if (!name) throw new VibeError("function name is required");
      if (!handler) throw new VibeError("handler is required");
      const url = `${this.serverURL}/api/runtime/functions/${encodeURIComponent(name)}/handlers/${encodeURIComponent(handler)}/runAsync`;
      const body = { args };
      if (opts.timeoutSeconds !== void 0) body.timeoutSeconds = opts.timeoutSeconds;
      const res = await this.fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        let detail = "";
        try {
          detail = await res.text();
        } catch {
        }
        throw new VibeError(
          `executeFunctionAsync ${name}/${handler} failed: ${res.status} ${res.statusText}${detail ? ` \u2014 ${detail}` : ""}`,
          res.status
        );
      }
      return await res.json();
    }
    /**
     * Subscribe to a realtime topic. The handler fires every time anything
     * publishes to that topic for this app — a server function, a scheduled job,
     * an agent, or another user's browser action.
     *
     * ```ts
     * const sub = vibe.subscribe<{ post: Post }>('posts', (evt) => {
     *   if (evt.payload.type === 'post.created') prependCard(evt.payload.post);
     * });
     * sub.unsubscribe();
     * ```
     *
     * All topics share ONE socket per tab, opened lazily on the first subscribe.
     * The socket authenticates with the same identity cookie as every other call
     * (it is a same-origin upgrade), and the server decides which app's events the
     * connection may see — `topic` here is only a leaf within that app, so it can
     * never reach another app's data.
     *
     * Reconnects automatically with backoff and re-subscribes on reopen. Events
     * published while disconnected are missed: `eventId` is stable, so dedupe on
     * it, and treat a reconnect as a cue to refetch if the view must be exact.
     */
    subscribe(topic, handler) {
      if (!topic) throw new VibeError("topic is required");
      if (typeof handler !== "function") throw new VibeError("handler must be a function");
      return this.realtime().subscribe(topic, handler);
    }
    /** Current transport state of the realtime socket. */
    get realtimeState() {
      return this.realtimeClient ? this.realtimeClient.state : "idle";
    }
    /** Observe transport state — for a "live / reconnecting" indicator. Returns an
     *  unsubscribe function. */
    onRealtimeState(listener) {
      return this.realtime().onState(listener);
    }
    /** Close the socket and drop every subscription. */
    closeRealtime() {
      this.realtimeClient?.close();
      this.realtimeClient = void 0;
    }
    realtime() {
      if (!this.realtimeClient) {
        this.realtimeClient = new VibeRealtime(this.serverURL);
      }
      return this.realtimeClient;
    }
    buildAuthURL(action, redirectTo) {
      const params = new URLSearchParams({ service: this.service, redirect: redirectTo });
      return `${this.serverURL}/identity/${action}?${params.toString()}`;
    }
  };
  var RECONNECT_MIN_MS = 500;
  var RECONNECT_MAX_MS = 3e4;
  var DEFAULT_HEARTBEAT_S = 25;
  var MAX_INITIAL_ATTEMPTS = 6;
  var VibeRealtime = class {
    constructor(serverURL) {
      this.handlers = /* @__PURE__ */ new Map();
      this.stateListeners = /* @__PURE__ */ new Set();
      this._state = "idle";
      this.reconnectDelay = RECONNECT_MIN_MS;
      this.heartbeatSeconds = DEFAULT_HEARTBEAT_S;
      this.lastMessageAt = 0;
      this.everOpened = false;
      this.failedAttempts = 0;
      this.closed = false;
      this.url = `${serverURL.replace(/^http/, "ws")}/api/runtime/events`;
    }
    get state() {
      return this._state;
    }
    onState(listener) {
      this.stateListeners.add(listener);
      return () => this.stateListeners.delete(listener);
    }
    subscribe(topic, handler) {
      let set = this.handlers.get(topic);
      const isNewTopic = !set;
      if (!set) {
        set = /* @__PURE__ */ new Set();
        this.handlers.set(topic, set);
      }
      set.add(handler);
      this.closed = false;
      if (!this.socket) {
        this.failedAttempts = 0;
        this.reconnectDelay = RECONNECT_MIN_MS;
        this.clearOnlineListener();
        this.connect();
      } else if (isNewTopic && this.socket.readyState === WebSocket.OPEN) {
        this.send({ t: "sub", topics: [topic] });
      }
      let active = true;
      return {
        unsubscribe: () => {
          if (!active) return;
          active = false;
          const handlersForTopic = this.handlers.get(topic);
          if (!handlersForTopic) return;
          handlersForTopic.delete(handler);
          if (handlersForTopic.size > 0) return;
          this.handlers.delete(topic);
          if (this.socket?.readyState === WebSocket.OPEN) {
            this.send({ t: "unsub", topics: [topic] });
          }
        }
      };
    }
    close() {
      this.closed = true;
      this.handlers.clear();
      this.clearTimers();
      this.clearOnlineListener();
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = void 0;
      try {
        this.socket?.close();
      } catch {
      }
      this.socket = void 0;
      this.setState("closed");
    }
    connect() {
      if (typeof WebSocket === "undefined") {
        throw new VibeError("vibe.subscribe requires a browser environment (WebSocket is undefined)");
      }
      if (this.handlers.size === 0 || this.closed) return;
      this.setState(this._state === "idle" || this._state === "closed" ? "connecting" : "reconnecting");
      let socket;
      try {
        socket = new WebSocket(this.url);
      } catch {
        this.scheduleReconnect();
        return;
      }
      this.socket = socket;
      socket.onopen = () => {
        this.reconnectDelay = RECONNECT_MIN_MS;
        this.everOpened = true;
        this.failedAttempts = 0;
        this.setState("open");
        const topics = [...this.handlers.keys()];
        if (topics.length) this.send({ t: "sub", topics });
        this.startTimers();
      };
      socket.onmessage = (ev) => {
        this.lastMessageAt = Date.now();
        let frame;
        try {
          frame = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        switch (frame.t) {
          case "event": {
            const event = frame;
            const set = this.handlers.get(event.topic);
            if (!set) return;
            for (const handler of [...set]) {
              try {
                handler(event);
              } catch (err) {
                console.error("[vibe] realtime handler threw", err);
              }
            }
            return;
          }
          case "hello": {
            const hb = Number(frame.heartbeat);
            if (Number.isFinite(hb) && hb > 0) {
              this.heartbeatSeconds = hb;
              this.startTimers();
            }
            return;
          }
          case "error":
            console.warn(`[vibe] realtime error: ${frame.code} \u2014 ${frame.msg}`);
            return;
          default:
            return;
        }
      };
      socket.onclose = () => {
        this.clearTimers();
        if (this.socket === socket) this.socket = void 0;
        this.scheduleReconnect();
      };
      socket.onerror = () => {
      };
    }
    scheduleReconnect() {
      if (this.closed || this.handlers.size === 0) {
        this.setState("closed");
        return;
      }
      if (!this.everOpened && ++this.failedAttempts >= MAX_INITIAL_ATTEMPTS) {
        console.warn(
          `[vibe] realtime could not connect after ${MAX_INITIAL_ATTEMPTS} attempts; giving up. Realtime may be disabled for this app. Will retry if the browser reports it is back online.`
        );
        this.setState("closed");
        this.waitForOnline();
        return;
      }
      this.setState("reconnecting");
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      const delay = this.reconnectDelay * (0.5 + Math.random());
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = void 0;
        this.connect();
      }, delay);
    }
    /**
     * Park until the browser reports connectivity, then try once more. Without this, an
     * app opened while offline would give up and stay dead even after the network came
     * back.
     */
    waitForOnline() {
      if (this.onlineListener || typeof window === "undefined") return;
      this.onlineListener = () => {
        this.clearOnlineListener();
        if (this.closed || this.handlers.size === 0) return;
        this.failedAttempts = 0;
        this.reconnectDelay = RECONNECT_MIN_MS;
        this.connect();
      };
      window.addEventListener("online", this.onlineListener);
    }
    clearOnlineListener() {
      if (this.onlineListener && typeof window !== "undefined") {
        window.removeEventListener("online", this.onlineListener);
      }
      this.onlineListener = void 0;
    }
    startTimers() {
      this.clearTimers();
      const intervalMs = this.heartbeatSeconds * 1e3;
      this.lastMessageAt = Date.now();
      this.pingTimer = setInterval(() => this.send({ t: "ping" }), intervalMs);
      this.watchdogTimer = setInterval(() => {
        if (Date.now() - this.lastMessageAt > intervalMs * 2.5) {
          try {
            this.socket?.close();
          } catch {
          }
        }
      }, intervalMs);
    }
    clearTimers() {
      if (this.pingTimer) clearInterval(this.pingTimer);
      if (this.watchdogTimer) clearInterval(this.watchdogTimer);
      this.pingTimer = void 0;
      this.watchdogTimer = void 0;
    }
    send(frame) {
      if (this.socket?.readyState !== WebSocket.OPEN) return;
      try {
        this.socket.send(JSON.stringify(frame));
      } catch {
      }
    }
    setState(next) {
      if (this._state === next) return;
      this._state = next;
      for (const listener of [...this.stateListeners]) {
        try {
          listener(next);
        } catch {
        }
      }
    }
  };
  function currentURL() {
    if (typeof window === "undefined") {
      throw new VibeError("Vibe SDK requires a browser environment (window is undefined)");
    }
    return window.location.href;
  }
  function assignLocation(url) {
    if (typeof window === "undefined") {
      throw new VibeError("Vibe SDK requires a browser environment (window is undefined)");
    }
    window.location.assign(url);
  }
  async function detailOf(res) {
    try {
      return await res.text();
    } catch {
      return "";
    }
  }
  function createVibe(cfg = {}) {
    return new Vibe(cfg);
  }

  // src/web/main.js
  var vibe = createVibe();
  var $ = (id) => document.getElementById(id);
  var view = () => $("view");
  var state = {
    me: null,
    actor: "",
    leads: [],
    counts: {},
    tab: "open",
    selected: null,
    chat: null
    // { token, messages, extracted, complete, missing, leadRef }
  };
  var esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  var toastTimer;
  function toast(message, bad = false) {
    const el = $("toast");
    el.textContent = message;
    el.className = `toast on${bad ? " bad" : ""}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.className = "toast", 3200);
  }
  async function call(handler, args = {}) {
    try {
      const res = await vibe.executeFunction("lead", handler, args);
      if (res && res.ok === false) {
        toast(res.error ?? `${handler} was rejected`, true);
        return null;
      }
      return res?.data ?? res;
    } catch (err) {
      toast(err?.message ?? String(err), true);
      return null;
    }
  }
  var ago = (iso) => {
    if (!iso) return "";
    const mins = Math.round((Date.now() - Date.parse(iso)) / 6e4);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const h = Math.round(mins / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
  };
  var STATUS_TONE = {
    new: "brand",
    in_review: "",
    contacted: "",
    qualified: "good",
    nurture: "warm",
    converted: "good",
    closed: ""
  };
  var statusChip = (l) => `<span class="chip ${STATUS_TONE[l.status] ?? ""}"><span class="dot"></span>${esc(l.status.replace("_", " "))}</span>`;
  function slaChip(sla) {
    if (!sla) return "";
    if (sla.isOverdue) return `<span class="chip hot">${esc(sla.breached[0].replace("_", " "))} late</span>`;
    if (!sla.nextDue) return `<span class="chip good">on time</span>`;
    const m = sla.nextDue.minutesRemaining;
    const left = m >= 60 ? `${Math.round(m / 60)}h` : `${m}m`;
    return `<span class="chip">${left} left</span>`;
  }
  var scoreCell = (l) => l.score === null || l.score === void 0 ? `<div class="score" style="color: var(--ink-3)">\u2014<small>not scored</small></div>` : `<div class="score">${l.score}<small>${esc(l.band ?? "")}</small></div>`;
  async function loadLeads() {
    const data = await call("list", { limit: 100 });
    if (!data) return;
    state.leads = data.leads;
    const c = { open: 0, unclaimed: 0, overdue: 0, won: 0, closed: 0 };
    for (const l of state.leads) {
      const terminal = l.status === "converted" || l.status === "closed";
      if (!terminal) c.open++;
      if (!terminal && !l.ownerEmail) c.unclaimed++;
      if (l.sla?.isOverdue) c.overdue++;
      if (l.status === "converted") c.won++;
      if (l.status === "closed") c.closed++;
    }
    state.counts = c;
    $("ctInbox").textContent = c.open || "";
  }
  var filtered = () => {
    const l = state.leads;
    if (state.tab === "unclaimed") return l.filter((x) => !x.ownerEmail && x.status !== "converted" && x.status !== "closed");
    if (state.tab === "overdue") return l.filter((x) => x.sla?.isOverdue);
    if (state.tab === "won") return l.filter((x) => x.status === "converted");
    if (state.tab === "closed") return l.filter((x) => x.status === "closed");
    return l.filter((x) => x.status !== "converted" && x.status !== "closed");
  };
  function renderInbox() {
    $("title").textContent = "Inbox";
    $("subtitle").textContent = `${state.counts.open ?? 0} open \xB7 ${state.counts.overdue ?? 0} overdue`;
    const tab = (id, label, n) => `<button data-tab="${id}" class="${state.tab === id ? "on" : ""}">${label}<span class="n">${n ?? 0}</span></button>`;
    const rows = filtered().map(
      (l) => `
      <div class="lead-row ${state.selected === l.id ? "on" : ""}" data-id="${esc(l.id)}">
        <div>
          <div class="co">${esc(l.companyName)}</div>
          <div class="meta">
            <code>${esc(l.refNo)}</code> \xB7 ${esc(l.source)}${l.serviceType ? ` \xB7 ${esc(l.serviceType)}` : ""}
            ${l.siteCity ? ` \xB7 ${esc(l.siteCity)}` : ""}
            \xB7 ${l.ownerEmail ? esc(l.ownerEmail.split("@")[0]) : "<em>unclaimed</em>"}
          </div>
        </div>
        <div>${statusChip(l)}</div>
        <div>${scoreCell(l)}</div>
        <div>${slaChip(l.sla)}<div class="meta" style="font-size:11.5px;color:var(--ink-3)">${ago(l.createdAt)}</div></div>
      </div>`
    ).join("");
    view().innerHTML = `
    <div class="tabs">
      ${tab("open", "Open", state.counts.open)}
      ${tab("unclaimed", "Unclaimed", state.counts.unclaimed)}
      ${tab("overdue", "Overdue", state.counts.overdue)}
      ${tab("won", "Won", state.counts.won)}
      ${tab("closed", "Closed", state.counts.closed)}
    </div>
    <div class="card" style="margin-top:14px">
      ${rows || `<div class="empty">Nothing here yet.<br><a href="#chat" style="color:var(--brand)">Try the website chat</a> to bring a lead in.</div>`}
    </div>`;
    for (const b of view().querySelectorAll("[data-tab]")) {
      b.onclick = () => {
        state.tab = b.dataset.tab;
        renderInbox();
      };
    }
    for (const r of view().querySelectorAll("[data-id]")) {
      r.onclick = () => {
        location.hash = `#lead/${r.dataset.id}`;
      };
    }
  }
  async function renderLead(id) {
    state.selected = id;
    view().innerHTML = `<div class="empty">Loading\u2026</div>`;
    const d = await call("get", { leadId: id });
    if (!d) return;
    const l = d.lead;
    $("title").textContent = l.companyName;
    $("subtitle").innerHTML = `${esc(l.refNo)} \xB7 from ${esc(l.source)} \xB7 ${ago(l.createdAt)}`;
    const a = d.analysis;
    const reasons = a?.reasons ?? [];
    const rec = a?.recommendation ?? {};
    const und = a?.understanding ?? {};
    const stages = [
      ["Arrived", l.arrivedAt],
      ["In review", l.reviewedAt],
      ["Contacted", l.firstContactAt],
      ["Qualified", l.qualifiedAt],
      ["Converted", l.convertedAt]
    ];
    const lastReached = stages.reduce((acc, [, at], i) => at ? i : acc, -1);
    const when = (at) => new Date(at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    const stepper = `
    <div class="steps">
      ${stages.map(([label, at], i) => {
      const skipped = !at && i < lastReached;
      return `<div class="step ${at ? "done" : skipped ? "skip" : ""}">
               <i></i>
               <div><b>${label}</b><span>${at ? when(at) : skipped ? "skipped" : "\u2014"}</span></div>
             </div>`;
    }).join("")}
      ${l.status === "closed" ? `<div class="step closed"><i></i><div><b>Closed</b><span>${esc(l.dispositionReason ?? "")}</span></div></div>` : ""}
      ${l.status === "nurture" ? `<div class="step warm"><i></i><div><b>Nurturing</b><span>${l.nurtureUntil ? `until ${esc(l.nurtureUntil.slice(0, 10))}` : "no date set"}</span></div></div>` : ""}
    </div>`;
    const clocks = [
      ["First response", l.firstResponseDueAt, l.firstContactAt],
      ["Qualification", l.qualificationDueAt, l.qualifiedAt],
      ["Hand to sales", l.assignmentDueAt, l.assignedAt]
    ];
    const terminal = l.status === "converted" || l.status === "closed";
    const slaCard = `
    <table class="clocks">
      ${clocks.map(([label, due, met]) => {
      const late = !met && !terminal && due && Date.parse(due) < Date.now();
      const chip = met ? `<span class="chip good">met</span>` : terminal ? `<span class="chip">n/a</span>` : late ? `<span class="chip hot">late</span>` : `<span class="chip">pending</span>`;
      return `<tr><td>${label}</td><td class="due">${due ? new Date(due).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "\u2014"}</td><td style="text-align:right">${chip}</td></tr>`;
    }).join("")}
    </table>`;
    const aiCard = a ? `<div class="verdict">
         <div>
           <div class="big" style="color:${l.score >= 75 ? "var(--hot)" : l.score >= 50 ? "var(--warm)" : "var(--ink-2)"}">${l.score}</div>
           <div class="of">of 100 \xB7 ${esc(d.band)}</div>
         </div>
         <div>
           <span class="chip ${l.verdict === "relevant" ? "good" : "hot"}">${esc(String(l.verdict).replace("_", " "))}</span>
           <div class="of" style="margin-top:5px">assessed ${ago(l.analysedAt)}</div>
         </div>
       </div>
       ${rec.nextAction ? `<div class="sec-t">Recommended next step</div><div style="font-size:13.5px">${esc(rec.nextAction)}</div>` : ""}
       ${reasons.length ? `<div class="sec-t">Why</div><ul class="reasons">${reasons.slice(0, 6).map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
       ${Array.isArray(und.missingInfo) && und.missingInfo.length ? `<div class="sec-t">Ask before quoting</div><ul class="reasons">${und.missingInfo.slice(0, 5).map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}` : `<div class="empty" style="padding:26px">
         Not assessed yet.
         <div style="margin-top:10px"><button class="btn pri" id="doAnalyse">Assess with AI</button></div>
       </div>`;
    view().innerHTML = `
    <div class="bar" style="margin-bottom:14px">
      ${!l.ownerEmail ? `<button class="btn pri" id="aClaim">Claim</button>` : ""}
      <button class="btn" id="aCall">Log a call</button>
      ${a ? `<button class="btn" id="doAnalyse2">Re-assess</button>` : ""}
      ${["in_review", "contacted", "nurture"].includes(l.status) ? `<button class="btn" id="aQual">Qualify</button>` : ""}
      ${["in_review", "contacted"].includes(l.status) ? `<button class="btn" id="aNurture">Nurture</button>` : ""}
      ${!terminal ? `<button class="btn" id="aAssign">Assign\u2026</button>` : ""}
      ${l.status === "qualified" ? `<button class="btn pri" id="aConv">Convert to deal</button>` : ""}
      ${!["converted", "closed"].includes(l.status) ? `<button class="btn" id="aClose">Close</button>` : ""}
      <span style="flex:1"></span>
      ${statusChip(l)} ${slaChip(d.sla)}
    </div>

    <div class="card" style="margin-bottom:14px"><div class="in">${stepper}</div></div>

    <div class="split">
      <div class="stack">
        <div class="card">
          <header><h3>Enquiry</h3></header>
          <div class="in">
            <div style="font-size:13.5px;margin-bottom:14px">${esc(l.description ?? "No description captured.")}</div>
            <dl class="facts">
              <div><dt>Contact</dt><dd>${esc(l.contactName ?? "\u2014")}</dd></div>
              <div><dt>Service</dt><dd>${esc(l.serviceType ?? "\u2014")}</dd></div>
              <div><dt>Email</dt><dd>${l.contactEmail ? `<a href="mailto:${esc(l.contactEmail)}">${esc(l.contactEmail)}</a>` : "\u2014"}</dd></div>
              <div><dt>Phone</dt><dd>${l.contactPhone ? `<a href="tel:${esc(l.contactPhone)}">${esc(l.contactPhone)}</a>` : "\u2014"}</dd></div>
              <div><dt>Location</dt><dd>${esc(l.siteCity ?? "\u2014")}${l.siteAddress ? `, ${esc(l.siteAddress)}` : ""}</dd></div>
              <div><dt>Est. value</dt><dd>${l.estimatedValue ? `${esc(l.currency ?? "AED")} ${Number(l.estimatedValue).toLocaleString()}` : "\u2014"}</dd></div>
              <div><dt>Owner</dt><dd>${esc(l.ownerEmail ?? "unclaimed")}</dd></div>
              <div><dt>Deal</dt><dd>${l.dealId ? `<span class="chip good">created</span>` : "\u2014"}</dd></div>
            </dl>
            ${l.dispositionReason ? `<div style="margin-top:12px" class="chip hot">closed: ${esc(l.dispositionReason)}</div>` : ""}
            ${d.duplicates.length ? `<div style="margin-top:12px" class="chip warm">${d.duplicates.length} duplicate enquir${d.duplicates.length === 1 ? "y" : "ies"} merged in</div>` : ""}
          </div>
        </div>

        <div class="card">
          <header><h3>Activity</h3><span class="grow"></span><span class="of" style="color:var(--ink-3);font-size:11.5px">${d.timeline.length} events</span></header>
          <div class="in">
            <ul class="tl">
              ${d.timeline.map(
      (e) => `<li>
                    <span class="when">${esc((e.occurredAt ?? "").slice(11, 16))}</span>
                    <span class="what"><span class="kind">${esc(e.kind)}</span>${e.actor ? ` <span style="color:var(--ink-3);font-size:11.5px">${esc(e.actor.split("@")[0])}</span>` : ""}
                      <div class="body">${esc(e.body ?? "")}</div></span>
                  </li>`
    ).join("")}
            </ul>
          </div>
        </div>
      </div>

      <div class="stack">
        <div id="convo"></div>
        <div class="card">
          <header><h3>AI assessment</h3></header>
          <div class="in">${aiCard}</div>
        </div>
        <div class="card">
          <header><h3>Response clocks</h3></header>
          <div class="in">${slaCard}</div>
        </div>
        <div class="card">
          <header><h3>Ownership</h3></header>
          <div class="in">
            <ul class="tl">
              ${d.assignments.length ? d.assignments.map((x) => `<li><span class="when">${esc((x.createdAt ?? "").slice(5, 10))}</span><span class="what"><span class="kind">${esc(x.role)}</span><div class="body">${esc(x.toUser)}${x.reason ? ` \u2014 ${esc(x.reason)}` : ""}</div></span></li>`).join("") : `<li class="body" style="color:var(--ink-3)">Not assigned yet.</li>`}
            </ul>
          </div>
        </div>
      </div>
    </div>`;
    const token = l.data?.intakeSessionToken;
    if (token) {
      call("intake-transcript", { sessionToken: token }).then((t) => {
        const slot = document.getElementById("convo");
        if (!slot || !t) return;
        slot.innerHTML = `
        <div class="card">
          <header><h3>Website conversation</h3><span class="grow"></span>
            <span style="color:var(--ink-3);font-size:11.5px">${t.messages.length} messages</span></header>
          <div class="in">
            <div class="msgs" style="padding:0;gap:9px;max-height:340px;overflow-y:auto">
              ${t.messages.map(
          (m) => `<div class="msg ${m.role === "agent" ? "a" : "v"}" style="max-width:88%;font-size:13px">${esc(m.content)}</div>`
        ).join("")}
            </div>
          </div>
        </div>`;
      });
    }
    const reload = () => renderLead(id);
    const claim = $("aClaim");
    if (claim)
      claim.onclick = async () => {
        if (await call("claim", { leadId: id, actorEmail: state.actor })) {
          toast("Claimed \u2014 it's yours");
          await loadLeads();
          reload();
        }
      };
    $("aCall").onclick = async () => {
      const body = prompt("What happened on the call?");
      if (!body) return;
      if (await call("log-activity", { leadId: id, kind: "call", body, actorEmail: state.actor })) {
        toast("Call logged");
        await loadLeads();
        reload();
      }
    };
    const qual = $("aQual");
    if (qual)
      qual.onclick = async () => {
        if (await call("transition", { leadId: id, toStatus: "qualified", actorEmail: state.actor })) {
          toast("Qualified");
          await loadLeads();
          reload();
        }
      };
    const conv = $("aConv");
    if (conv)
      conv.onclick = async () => {
        const r = await call("convert", { leadId: id, actorEmail: state.actor });
        if (r) {
          toast(`${r.dealRefNo} created \xB7 ${r.queued.length} Facilio writes queued`);
          await loadLeads();
          reload();
        }
      };
    const nurture = $("aNurture");
    if (nurture)
      nurture.onclick = async () => {
        const until = prompt("Bring this back on which date? (YYYY-MM-DD)", new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10));
        if (!until) return;
        if (await call("transition", { leadId: id, toStatus: "nurture", note: `Nurturing until ${until}`, actorEmail: state.actor })) {
          await call("update", { leadId: id, nurtureUntil: until, actorEmail: state.actor });
          toast(`Parked until ${until}`);
          await loadLeads();
          reload();
        }
      };
    const assign = $("aAssign");
    if (assign)
      assign.onclick = async () => {
        const who = prompt("Assign to which email?", state.actor);
        if (!who) return;
        const role = confirm("OK = hand to SALES owner\nCancel = reassign the ACTIONER") ? "sales" : "actioner";
        if (await call("assign", { leadId: id, toUser: who, role, reason: "assigned from the lead view", actorEmail: state.actor })) {
          toast(`${role === "sales" ? "Sales owner" : "Actioner"} set to ${who}`);
          await loadLeads();
          reload();
        }
      };
    const close = $("aClose");
    if (close)
      close.onclick = async () => {
        const reason = prompt(
          "Why is this closing?\nspam \xB7 outside_region \xB7 wrong_service \xB7 not_interested \xB7 no_budget \xB7 no_response \xB7 lost_to_competitor",
          "not_interested"
        );
        if (!reason) return;
        if (await call("transition", { leadId: id, toStatus: "closed", dispositionReason: reason, actorEmail: state.actor })) {
          toast("Closed");
          await loadLeads();
          reload();
        }
      };
    for (const btn of [$("doAnalyse"), $("doAnalyse2")]) {
      if (btn) btn.onclick = () => assess(id, btn);
    }
  }
  async function assess(id, btn) {
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Assessing\u2026";
    try {
      const prep = await call("analyse-input", { leadId: id });
      if (!prep) return;
      const reply = await vibe.executeAgent(prep.agent, prep.input);
      const content = reply?.response?.content;
      if (!content) {
        toast("The assessor returned nothing", true);
        return;
      }
      const stored = await call("analyse", { leadId: id, replyJson: content });
      if (stored) {
        toast(`${stored.verdict.replace("_", " ")} \xB7 score ${stored.score}`);
        await loadLeads();
        await renderLead(id);
      }
    } catch (err) {
      toast(err?.message ?? String(err), true);
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }
  function renderChat() {
    $("title").textContent = "Website chat";
    $("subtitle").textContent = "What a visitor sees on the company site";
    const c = state.chat;
    const bubbles = (c?.messages ?? []).map(
      (m) => m.role === "system" ? `<div class="sys">${esc(m.content)}</div>` : `<div class="msg ${m.role === "agent" ? "a" : "v"}">${esc(m.content)}</div>`
    ).join("");
    view().innerHTML = `
    <div class="chat-shell">
      <div class="card chat">
        <div class="site">
          <span class="chip brand">albaytgrill.ae</span>
          <span>Chat with us \u2014 commercial kitchen extract cleaning</span>
        </div>
        <div class="msgs" id="msgs">
          ${bubbles || `<div class="empty">Starting\u2026</div>`}
          <div id="typingSlot"></div>
        </div>
        <div class="composer">
          <input id="say" placeholder="Type your message\u2026" autocomplete="off" ${c ? "" : "disabled"} />
          <button class="btn pri" id="send" ${c ? "" : "disabled"}>Send</button>
        </div>
      </div>
      <div class="chat-foot">
        <span>The assistant never quotes a price \u2014 a surveyor confirms that on site.</span>
        <button class="btn sm" id="restart">Start a new conversation</button>
      </div>
    </div>`;
    const msgs = $("msgs");
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
    const send = $("send");
    const input = $("say");
    if (send && input) {
      const go = () => {
        const text = input.value.trim();
        if (text) sendChat(text);
      };
      send.onclick = go;
      input.onkeydown = (e) => {
        if (e.key === "Enter") go();
      };
      input.focus();
    }
    $("restart").onclick = () => startChat(true);
    if (!c) startChat();
  }
  async function startChat(force = false) {
    if (state.chat && !force) return;
    state.chat = null;
    const s = await call("intake-start", { sourceUrl: location.href, userAgent: navigator.userAgent });
    if (!s) return;
    state.chat = {
      token: s.sessionToken,
      messages: [{ role: "agent", content: s.greeting }],
      extracted: {},
      missing: ["companyName"],
      complete: false,
      leadRef: null,
      submitting: false
    };
    renderChat();
  }
  async function sendChat(text) {
    const c = state.chat;
    if (!c) return;
    c.messages.push({ role: "visitor", content: text });
    renderChat();
    $("typingSlot").innerHTML = `<div class="typing"><i></i><i></i><i></i></div>`;
    const msgs = $("msgs");
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
    try {
      const history = c.messages.filter((m) => m.role !== "system").map((m) => `${m.role === "agent" ? "AGENT" : "VISITOR"}: ${m.content}`).join("\n");
      const reply = await vibe.executeAgent(
        "intake",
        `CONVERSATION SO FAR:
${history}

Reply to the visitor's last message.`
      );
      const content = reply?.response?.content;
      const turn = await call("intake-turn", {
        sessionToken: c.token,
        message: text,
        agentReply: content
      });
      if (!turn) return;
      c.messages.push({ role: "agent", content: turn.reply });
      c.extracted = turn.extracted;
      c.missing = turn.missing;
      c.complete = turn.complete;
      renderChat();
      if (!c.leadRef && !c.submitting && turn.missing.length === 0) {
        c.submitting = true;
        const r = await call("intake-submit", { sessionToken: c.token });
        c.submitting = false;
        if (r) {
          c.leadRef = r.refNo;
          c.messages.push({
            role: "system",
            content: `Your enquiry is with our team \u2014 reference ${r.refNo}.`
          });
          renderChat();
          await loadLeads();
        }
      }
    } catch (err) {
      toast(err?.message ?? String(err), true);
      renderChat();
    }
  }
  async function renderSettings() {
    $("title").textContent = "Settings";
    $("subtitle").textContent = "What we do, where, and how fast we respond";
    const s = await call("settings-get");
    if (!s) return;
    const lineById = Object.fromEntries(s.serviceLines.map((l) => [l.id, l]));
    const rows = s.areas.map((a) => {
      const served = s.coverage.filter((c) => c.areaId === a.id && c.active === "true").map((c) => lineById[c.serviceLineId]).filter(Boolean);
      return `<div class="lead-row" style="grid-template-columns:180px 1fr;cursor:default">
        <div><div class="co">${esc(a.name)}</div><div class="meta">${esc(a.country ?? "")}</div></div>
        <div>${served.length ? served.map((l) => `<span class="chip brand" style="margin:2px 4px 2px 0">${esc(l.code)} \xB7 ${esc(l.name)}</span>`).join("") : `<span class="meta">nothing enabled</span>`}</div>
      </div>`;
    }).join("");
    view().innerHTML = `
    <div class="split">
      <div class="card">
        <header><h3>Service coverage</h3></header>
        <div>${rows || `<div class="empty">No areas configured.</div>`}</div>
        <div class="in" style="border-top:1px solid var(--line-soft);font-size:12.5px;color:var(--ink-2)">
          This is what the AI checks a lead against. A service outside these areas is scored
          <span class="chip">outside region</span> automatically.
        </div>
      </div>
      <div class="card">
        <header><h3>Response targets</h3></header>
        <div class="in">
          <label class="f">First response (minutes)</label>
          <input type="number" id="sla1" value="${s.sla.firstResponseMins}" />
          <label class="f">Qualification (minutes)</label>
          <input type="number" id="sla2" value="${s.sla.qualificationMins}" />
          <label class="f">Hand to sales (minutes)</label>
          <input type="number" id="sla3" value="${s.sla.assignmentMins}" />
          <div class="bar" style="margin-top:13px">
            <button class="btn pri" id="slaSave">Save targets</button>
          </div>
          <div style="margin-top:11px;font-size:12.5px;color:var(--ink-2)">
            Overdue is worked out when the list loads, so a change here shows immediately \u2014
            set the first target to 1 minute to watch the inbox turn red.
          </div>
        </div>
      </div>
    </div>`;
    $("slaSave").onclick = async () => {
      const r = await call("settings-put", {
        firstResponseMins: Number($("sla1").value),
        qualificationMins: Number($("sla2").value),
        assignmentMins: Number($("sla3").value)
      });
      if (r) {
        toast("Targets saved");
        await loadLeads();
      }
    };
  }
  async function route() {
    const hash = location.hash || "#inbox";
    const [, page, arg] = hash.match(/^#([^/]+)\/?(.*)$/) ?? [];
    for (const a of document.querySelectorAll("nav a")) {
      a.classList.toggle("on", a.dataset.v === (page === "lead" ? "inbox" : page));
    }
    if (page === "lead" && arg) return renderLead(arg);
    if (page === "chat") return renderChat();
    if (page === "settings") return renderSettings();
    return renderInbox();
  }
  window.addEventListener("hashchange", route);
  $("reload").onclick = async () => {
    await loadLeads();
    await route();
  };
  $("out").onclick = (e) => {
    e.preventDefault();
    vibe.logout();
  };
  (async function boot() {
    const me = await vibe.getCurrentUser();
    if (!me) {
      view().innerHTML = `<div class="empty">You need to sign in.<div style="margin-top:12px"><button class="btn pri" id="login">Sign in</button></div></div>`;
      $("login").onclick = () => vibe.login();
      return;
    }
    state.me = me;
    state.actor = me.user?.email ?? "";
    $("me").innerHTML = `<b>${esc(me.user?.name ?? state.actor)}</b><br>org ${esc(String(me.org?.orgId ?? ""))}`;
    await loadLeads();
    await route();
  })();
})();
