/**
 * Frontline — the product UI.
 *
 * Two audiences in one app:
 *   Inbox / lead detail  — what the sales team sees
 *   Website chat         — what a customer sees, driven by the intake agent
 *
 * Both agent calls happen HERE rather than server-side, because a function
 * aborts at the ~10s fetch timeout and a model call is slower than that. The
 * browser calls `vibe.executeAgent` and posts the reply to a handler that parses,
 * validates and stores it. That constraint is why this UI is not optional.
 */

import { createVibe } from "@facilio/vibe-sdk";

const vibe = createVibe();
const $ = (id) => document.getElementById(id);
const view = () => $("view");

const state = {
  me: null,
  actor: "",
  leads: [],
  counts: {},
  tab: "open",
  selected: null,
  chat: null, // { token, messages, extracted, complete, missing, leadRef }
};

// --- helpers ----------------------------------------------------------------

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let toastTimer;
function toast(message, bad = false) {
  const el = $("toast");
  el.textContent = message;
  el.className = `toast on${bad ? " bad" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = "toast"), 3200);
}

/** Handlers return `{ ok, data, error }`, so a rejection is a normal response. */
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

const ago = (iso) => {
  if (!iso) return "";
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};

const STATUS_TONE = {
  new: "brand",
  in_review: "",
  contacted: "",
  qualified: "good",
  nurture: "warm",
  converted: "good",
  closed: "",
};

const statusChip = (l) =>
  `<span class="chip ${STATUS_TONE[l.status] ?? ""}"><span class="dot"></span>${esc(l.status.replace("_", " "))}</span>`;

function slaChip(sla) {
  if (!sla) return "";
  if (sla.isOverdue) return `<span class="chip hot">${esc(sla.breached[0].replace("_", " "))} late</span>`;
  if (!sla.nextDue) return `<span class="chip good">on time</span>`;
  const m = sla.nextDue.minutesRemaining;
  const left = m >= 60 ? `${Math.round(m / 60)}h` : `${m}m`;
  return `<span class="chip">${left} left</span>`;
}

const scoreCell = (l) =>
  l.score === null || l.score === undefined
    ? `<div class="score" style="color: var(--ink-3)">—<small>not scored</small></div>`
    : `<div class="score">${l.score}<small>${esc(l.band ?? "")}</small></div>`;

// --- data -------------------------------------------------------------------

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

const filtered = () => {
  const l = state.leads;
  if (state.tab === "unclaimed") return l.filter((x) => !x.ownerEmail && x.status !== "converted" && x.status !== "closed");
  if (state.tab === "overdue") return l.filter((x) => x.sla?.isOverdue);
  if (state.tab === "won") return l.filter((x) => x.status === "converted");
  if (state.tab === "closed") return l.filter((x) => x.status === "closed");
  return l.filter((x) => x.status !== "converted" && x.status !== "closed");
};

// --- inbox ------------------------------------------------------------------

function renderInbox() {
  $("title").textContent = "Inbox";
  $("subtitle").textContent = `${state.counts.open ?? 0} open · ${state.counts.overdue ?? 0} overdue`;

  const tab = (id, label, n) =>
    `<button data-tab="${id}" class="${state.tab === id ? "on" : ""}">${label}<span class="n">${n ?? 0}</span></button>`;

  const rows = filtered()
    .map(
      (l) => `
      <div class="lead-row ${state.selected === l.id ? "on" : ""}" data-id="${esc(l.id)}">
        <div>
          <div class="co">${esc(l.companyName)}</div>
          <div class="meta">
            <code>${esc(l.refNo)}</code> · ${esc(l.source)}${l.serviceType ? ` · ${esc(l.serviceType)}` : ""}
            ${l.siteCity ? ` · ${esc(l.siteCity)}` : ""}
            · ${l.ownerEmail ? esc(l.ownerEmail.split("@")[0]) : "<em>unclaimed</em>"}
          </div>
        </div>
        <div>${statusChip(l)}</div>
        <div>${scoreCell(l)}</div>
        <div>${slaChip(l.sla)}<div class="meta" style="font-size:11.5px;color:var(--ink-3)">${ago(l.createdAt)}</div></div>
      </div>`
    )
    .join("");

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

// --- lead detail ------------------------------------------------------------

async function renderLead(id) {
  state.selected = id;
  view().innerHTML = `<div class="empty">Loading…</div>`;

  const d = await call("get", { leadId: id });
  if (!d) return;
  const l = d.lead;

  $("title").textContent = l.companyName;
  $("subtitle").innerHTML = `${esc(l.refNo)} · from ${esc(l.source)} · ${ago(l.createdAt)}`;

  const a = d.analysis;
  const reasons = a?.reasons ?? [];
  const rec = a?.recommendation ?? {};
  const und = a?.understanding ?? {};

  // The lifecycle made visible: which stages this lead has actually passed,
  // taken from the timestamps the transition handler stamps.
  const stages = [
    ["Arrived", l.arrivedAt],
    ["In review", l.reviewedAt],
    ["Contacted", l.firstContactAt],
    ["Qualified", l.qualifiedAt],
    ["Converted", l.convertedAt],
  ];
  // A stage with no timestamp is only "pending" if nothing after it happened.
  // If a later stage did, this one was deliberately jumped — which is legal
  // (in_review -> qualified is allowed) and worth showing as a decision rather
  // than leaving it to look identical to a stage not yet reached.
  const lastReached = stages.reduce((acc, [, at], i) => (at ? i : acc), -1);
  const when = (at) =>
    new Date(at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  const stepper = `
    <div class="steps">
      ${stages
        .map(([label, at], i) => {
          const skipped = !at && i < lastReached;
          return `<div class="step ${at ? "done" : skipped ? "skip" : ""}">
               <i></i>
               <div><b>${label}</b><span>${at ? when(at) : skipped ? "skipped" : "—"}</span></div>
             </div>`;
        })
        .join("")}
      ${l.status === "closed" ? `<div class="step closed"><i></i><div><b>Closed</b><span>${esc(l.dispositionReason ?? "")}</span></div></div>` : ""}
      ${l.status === "nurture" ? `<div class="step warm"><i></i><div><b>Nurturing</b><span>${l.nurtureUntil ? `until ${esc(l.nurtureUntil.slice(0, 10))}` : "no date set"}</span></div></div>` : ""}
    </div>`;

  // Three clocks, all running from arrival. Each is met, late, or still ticking.
  const clocks = [
    ["First response", l.firstResponseDueAt, l.firstContactAt],
    ["Qualification", l.qualificationDueAt, l.qualifiedAt],
    ["Hand to sales", l.assignmentDueAt, l.assignedAt],
  ];
  const terminal = l.status === "converted" || l.status === "closed";
  const slaCard = `
    <table class="clocks">
      ${clocks
        .map(([label, due, met]) => {
          const late = !met && !terminal && due && Date.parse(due) < Date.now();
          const chip = met
            ? `<span class="chip good">met</span>`
            : terminal
              ? `<span class="chip">n/a</span>`
              : late
                ? `<span class="chip hot">late</span>`
                : `<span class="chip">pending</span>`;
          return `<tr><td>${label}</td><td class="due">${due ? new Date(due).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</td><td style="text-align:right">${chip}</td></tr>`;
        })
        .join("")}
    </table>`;

  const aiCard = a
    ? `<div class="verdict">
         <div>
           <div class="big" style="color:${l.score >= 75 ? "var(--hot)" : l.score >= 50 ? "var(--warm)" : "var(--ink-2)"}">${l.score}</div>
           <div class="of">of 100 · ${esc(d.band)}</div>
         </div>
         <div>
           <span class="chip ${l.verdict === "relevant" ? "good" : "hot"}">${esc(String(l.verdict).replace("_", " "))}</span>
           <div class="of" style="margin-top:5px">assessed ${ago(l.analysedAt)}</div>
         </div>
       </div>
       ${rec.nextAction ? `<div class="sec-t">Recommended next step</div><div style="font-size:13.5px">${esc(rec.nextAction)}</div>` : ""}
       ${reasons.length ? `<div class="sec-t">Why</div><ul class="reasons">${reasons.slice(0, 6).map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
       ${Array.isArray(und.missingInfo) && und.missingInfo.length ? `<div class="sec-t">Ask before quoting</div><ul class="reasons">${und.missingInfo.slice(0, 5).map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}`
    : `<div class="empty" style="padding:26px">
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
      ${!terminal ? `<button class="btn" id="aAssign">Assign…</button>` : ""}
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
              <div><dt>Contact</dt><dd>${esc(l.contactName ?? "—")}</dd></div>
              <div><dt>Service</dt><dd>${esc(l.serviceType ?? "—")}</dd></div>
              <div><dt>Email</dt><dd>${l.contactEmail ? `<a href="mailto:${esc(l.contactEmail)}">${esc(l.contactEmail)}</a>` : "—"}</dd></div>
              <div><dt>Phone</dt><dd>${l.contactPhone ? `<a href="tel:${esc(l.contactPhone)}">${esc(l.contactPhone)}</a>` : "—"}</dd></div>
              <div><dt>Location</dt><dd>${esc(l.siteCity ?? "—")}${l.siteAddress ? `, ${esc(l.siteAddress)}` : ""}</dd></div>
              <div><dt>Est. value</dt><dd>${l.estimatedValue ? `${esc(l.currency ?? "AED")} ${Number(l.estimatedValue).toLocaleString()}` : "—"}</dd></div>
              <div><dt>Owner</dt><dd>${esc(l.ownerEmail ?? "unclaimed")}</dd></div>
              <div><dt>Deal</dt><dd>${l.dealId ? `<span class="chip good">created</span>` : "—"}</dd></div>
            </dl>
            ${l.dispositionReason ? `<div style="margin-top:12px" class="chip hot">closed: ${esc(l.dispositionReason)}</div>` : ""}
            ${d.duplicates.length ? `<div style="margin-top:12px" class="chip warm">${d.duplicates.length} duplicate enquir${d.duplicates.length === 1 ? "y" : "ies"} merged in</div>` : ""}
          </div>
        </div>

        <div class="card">
          <header><h3>Activity</h3><span class="grow"></span><span class="of" style="color:var(--ink-3);font-size:11.5px">${d.timeline.length} events</span></header>
          <div class="in">
            <ul class="tl">
              ${d.timeline
                .map(
                  (e) => `<li>
                    <span class="when">${esc((e.occurredAt ?? "").slice(11, 16))}</span>
                    <span class="what"><span class="kind">${esc(e.kind)}</span>${e.actor ? ` <span style="color:var(--ink-3);font-size:11.5px">${esc(e.actor.split("@")[0])}</span>` : ""}
                      <div class="body">${esc(e.body ?? "")}</div></span>
                  </li>`
                )
                .join("")}
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
              ${d.assignments.length
                ? d.assignments
                    .map((x) => `<li><span class="when">${esc((x.createdAt ?? "").slice(5, 10))}</span><span class="what"><span class="kind">${esc(x.role)}</span><div class="body">${esc(x.toUser)}${x.reason ? ` — ${esc(x.reason)}` : ""}</div></span></li>`)
                    .join("")
                : `<li class="body" style="color:var(--ink-3)">Not assigned yet.</li>`}
            </ul>
          </div>
        </div>
      </div>
    </div>`;

  // The full conversation belongs here — internal, where it is useful — rather
  // than in front of the visitor who just had it.
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
              ${t.messages
                .map(
                  (m) =>
                    `<div class="msg ${m.role === "agent" ? "a" : "v"}" style="max-width:88%;font-size:13px">${esc(m.content)}</div>`
                )
                .join("")}
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
        toast("Claimed — it's yours");
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
        toast(`${r.dealRefNo} created · ${r.queued.length} Facilio writes queued`);
        await loadLeads();
        reload();
      }
    };

  const nurture = $("aNurture");
  if (nurture)
    nurture.onclick = async () => {
      const until = prompt("Bring this back on which date? (YYYY-MM-DD)", new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10));
      if (!until) return;
      // Two steps: the status change is validated by the state machine, the date
      // is an ordinary field edit.
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
        "Why is this closing?\nspam · outside_region · wrong_service · not_interested · no_budget · no_response · lost_to_competitor",
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

/**
 * The AI assessment, and the reason this runs in a browser.
 *
 * 1. Ask the server for the prompt and agent name, so the scope brief that
 *    drives relevance is built from settings and never duplicated here.
 * 2. Call the model from the page — a function would abort at ~10s.
 * 3. Post the reply back to be parsed, clamped and stored as a new version.
 */
async function assess(id, btn) {
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Assessing…";
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
      toast(`${stored.verdict.replace("_", " ")} · score ${stored.score}`);
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

// --- website chat (customer view) -------------------------------------------

function renderChat() {
  $("title").textContent = "Website chat";
  $("subtitle").textContent = "What a visitor sees on the company site";

  const c = state.chat;

  const bubbles = (c?.messages ?? [])
    .map((m) =>
      m.role === "system"
        ? `<div class="sys">${esc(m.content)}</div>`
        : `<div class="msg ${m.role === "agent" ? "a" : "v"}">${esc(m.content)}</div>`
    )
    .join("");

  // No "captured so far" panel and no submit button: a visitor on a website does
  // not press submit, and must not be shown the extraction. The conversation IS
  // the enquiry — the lead is created the moment the agent has enough.
  view().innerHTML = `
    <div class="chat-shell">
      <div class="card chat">
        <div class="site">
          <span class="chip brand">albaytgrill.ae</span>
          <span>Chat with us — commercial kitchen extract cleaning</span>
        </div>
        <div class="msgs" id="msgs">
          ${bubbles || `<div class="empty">Starting…</div>`}
          <div id="typingSlot"></div>
        </div>
        <div class="composer">
          <input id="say" placeholder="Type your message…" autocomplete="off" ${c ? "" : "disabled"} />
          <button class="btn pri" id="send" ${c ? "" : "disabled"}>Send</button>
        </div>
      </div>
      <div class="chat-foot">
        <span>The assistant never quotes a price — a surveyor confirms that on site.</span>
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
    submitting: false,
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
    // The agent is stateless, so the whole conversation travels with each turn.
    const history = c.messages
      .filter((m) => m.role !== "system")
      .map((m) => `${m.role === "agent" ? "AGENT" : "VISITOR"}: ${m.content}`)
      .join("\n");

    // The LOGICAL agent name, not the flow-ai link name: the browser resolves an
    // agent by (app, name) from the request host. Passing `intake_<appuuid>` here
    // returns 404 — that form is only for the server-side ai-studio actions.
    const reply = await vibe.executeAgent(
      "intake",
      `CONVERSATION SO FAR:\n${history}\n\nReply to the visitor's last message.`
    );

    const content = reply?.response?.content;
    const turn = await call("intake-turn", {
      sessionToken: c.token,
      message: text,
      agentReply: content,
    });
    if (!turn) return;

    c.messages.push({ role: "agent", content: turn.reply });
    c.extracted = turn.extracted;
    c.missing = turn.missing;
    c.complete = turn.complete;
    renderChat();

    // Create the lead as soon as there is enough, without asking the visitor to
    // do anything. Guarded so a later turn cannot create a second one.
    if (!c.leadRef && !c.submitting && turn.missing.length === 0) {
      c.submitting = true;
      const r = await call("intake-submit", { sessionToken: c.token });
      c.submitting = false;
      if (r) {
        c.leadRef = r.refNo;
        c.messages.push({
          role: "system",
          content: `Your enquiry is with our team — reference ${r.refNo}.`,
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

// --- settings ---------------------------------------------------------------

async function renderSettings() {
  $("title").textContent = "Settings";
  $("subtitle").textContent = "What we do, where, and how fast we respond";

  const s = await call("settings-get");
  if (!s) return;

  const lineById = Object.fromEntries(s.serviceLines.map((l) => [l.id, l]));
  const rows = s.areas
    .map((a) => {
      const served = s.coverage
        .filter((c) => c.areaId === a.id && c.active === "true")
        .map((c) => lineById[c.serviceLineId])
        .filter(Boolean);
      return `<div class="lead-row" style="grid-template-columns:180px 1fr;cursor:default">
        <div><div class="co">${esc(a.name)}</div><div class="meta">${esc(a.country ?? "")}</div></div>
        <div>${served.length ? served.map((l) => `<span class="chip brand" style="margin:2px 4px 2px 0">${esc(l.code)} · ${esc(l.name)}</span>`).join("") : `<span class="meta">nothing enabled</span>`}</div>
      </div>`;
    })
    .join("");

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
            Overdue is worked out when the list loads, so a change here shows immediately —
            set the first target to 1 minute to watch the inbox turn red.
          </div>
        </div>
      </div>
    </div>`;

  $("slaSave").onclick = async () => {
    const r = await call("settings-put", {
      firstResponseMins: Number($("sla1").value),
      qualificationMins: Number($("sla2").value),
      assignmentMins: Number($("sla3").value),
    });
    if (r) {
      toast("Targets saved");
      await loadLeads();
    }
  };
}

// --- routing ----------------------------------------------------------------

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

// --- boot -------------------------------------------------------------------

(async function boot() {
  // getCurrentUser() is the single source of truth for "signed in?" — a null
  // result drives the redirect, never a 401 from a data call.
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
