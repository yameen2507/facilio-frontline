/**
 * Accounts — the company view.
 *
 * Two screens: the list of companies, and one company with its contacts, deals
 * and every lead that resolved to it. That last list is the point of the screen:
 * a repeat customer's whole history in one place.
 *
 * Kept out of main.js because it is self-contained, and its helpers are injected
 * rather than imported so the two files never form a cycle.
 */

export function accountViews({ $, call, esc, view, ago }) {
  const state = { search: "", rows: [], total: 0 };
  let searchTimer;

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  const money = (value, currency) =>
    value === null || value === undefined
      ? "—"
      : `${esc(currency ?? "AED")} ${Number(value).toLocaleString()}`;

  /**
   * An account exists here before it exists in Facilio — the outbox writes it
   * later — so the client id doubles as the sync state. Showing "pending" as a
   * warning would be wrong; it is the normal state for the first minute.
   */
  const syncChip = (a) =>
    a.facilioClientId
      ? `<span class="chip good"><span class="dot"></span>client ${esc(a.facilioClientId)}</span>`
      : `<span class="chip warm"><span class="dot"></span>not in Facilio yet</span>`;

  const STAGE_TONE = { open: "brand", won: "good", lost: "" };

  // --- list -----------------------------------------------------------------

  async function list() {
    $("title").textContent = "Accounts";
    $("subtitle").textContent = "";

    // The shell is rendered once and only the rows are replaced, so typing in
    // the search box never loses focus mid-keystroke.
    view().innerHTML = `
      <div class="bar" style="margin-bottom:14px">
        <input type="text" id="acSearch" placeholder="Search name, email or domain"
               value="${esc(state.search)}" style="min-width:300px">
      </div>
      <div class="card" id="acRows"><div class="empty">Loading…</div></div>`;

    const input = $("acSearch");
    input.oninput = () => {
      state.search = input.value.trim();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(load, 250);
    };
    input.focus();

    await load();
  }

  async function load() {
    const data = await call("account-list", {
      limit: 100,
      ...(state.search ? { search: state.search } : {}),
    });

    // The user may have navigated away while this was in flight.
    const box = $("acRows");
    if (!box) return;

    if (!data) {
      box.innerHTML = `<div class="empty">Could not load accounts.</div>`;
      return;
    }

    state.rows = data.accounts;
    state.total = data.total;
    $("subtitle").textContent = data.total
      ? `${plural(data.total, "company", "companies")}${data.truncated ? " · first page" : ""}`
      : "";

    box.innerHTML =
      state.rows
        .map(
          (a) => `
      <div class="lead-row" data-id="${esc(a.id)}">
        <div>
          <div class="co">${esc(a.name ?? "Unnamed account")}</div>
          <div class="meta">
            ${a.websiteDomain ? esc(a.websiteDomain) : "<em>no domain</em>"}
            ${a.email ? ` · ${esc(a.email)}` : ""}
          </div>
        </div>
        <div class="score">${a.leadCount}<small>${a.leadCount === 1 ? "lead" : "leads"}</small></div>
        <div class="score">${a.dealCount}<small>${a.dealCount === 1 ? "deal" : "deals"}</small></div>
        <div>${syncChip(a)}<div class="meta" style="font-size:11.5px;color:var(--ink-3)">${ago(a.createdAt)}</div></div>
      </div>`
        )
        .join("") ||
      `<div class="empty">${
        state.search
          ? "No company matches that."
          : "No accounts yet.<br>A company appears here when a qualified lead is converted."
      }</div>`;

    for (const row of box.querySelectorAll("[data-id]")) {
      row.onclick = () => {
        location.hash = `#account/${row.dataset.id}`;
      };
    }
  }

  // --- one account ----------------------------------------------------------

  async function detail(id) {
    $("title").textContent = "Account";
    $("subtitle").textContent = "";
    view().innerHTML = `<div class="empty">Loading…</div>`;

    const d = await call("account-get", { accountId: id });
    if (!d) {
      view().innerHTML = `<div class="empty">Account not found.
        <div style="margin-top:12px"><a href="#accounts" style="color:var(--brand)">Back to accounts</a></div></div>`;
      return;
    }

    const a = d.account;
    $("title").textContent = a.name ?? "Account";
    $("subtitle").textContent = `${plural(d.leads.length, "lead", "leads")} · ${plural(
      d.deals.length,
      "deal",
      "deals"
    )}`;

    const addr = a.address ?? {};
    const place = [addr.street, addr.city, addr.state].filter(Boolean).join(", ");

    const facts = `
      <dl class="facts">
        <div><dt>Domain</dt><dd>${
          a.websiteDomain
            ? `<a href="https://${esc(a.websiteDomain)}" target="_blank" rel="noreferrer">${esc(a.websiteDomain)}</a>`
            : "—"
        }</dd></div>
        <div><dt>Email</dt><dd>${a.email ? `<a href="mailto:${esc(a.email)}">${esc(a.email)}</a>` : "—"}</dd></div>
        <div><dt>Phone</dt><dd>${a.phone ? `<a href="tel:${esc(a.phone)}">${esc(a.phone)}</a>` : "—"}</dd></div>
        <div><dt>Location</dt><dd>${place ? esc(place) : "—"}</dd></div>
        <div><dt>Facilio client</dt><dd>${a.facilioClientId ? `<code>${esc(a.facilioClientId)}</code>` : "queued"}</dd></div>
        <div><dt>Customer since</dt><dd>${esc(String(a.createdAt ?? "").slice(0, 10))}</dd></div>
      </dl>`;

    // `facilioContactId` is deliberately not shown: Facilio's create-client-contact
    // returns no id we can extract, so it is null even when the contact synced
    // (ARCHITECTURE.md §8a). Showing "—" there would read as a failure.
    const contacts = d.contacts.length
      ? `<table class="clocks">${d.contacts
          .map(
            (c) => `
        <tr>
          <td>
            <b>${esc(c.name ?? "—")}</b>
            ${String(c.isPrimary) === "true" ? ` <span class="chip">primary</span>` : ""}
            <div class="due">${esc(c.email ?? "")}${c.phone ? ` · ${esc(c.phone)}` : ""}</div>
          </td>
        </tr>`
          )
          .join("")}</table>`
      : `<div class="empty" style="padding:20px">No contact captured.</div>`;

    const deals = d.deals.length
      ? `<table class="clocks">${d.deals
          .map(
            (deal) => `
        <tr>
          <td>
            <b>${esc(deal.title ?? "Untitled deal")}</b>
            <div class="due"><code>${esc(deal.refNo)}</code>${deal.salesOwnerEmail ? ` · ${esc(deal.salesOwnerEmail)}` : ""}</div>
          </td>
          <td class="due" style="text-align:right;white-space:nowrap">${money(deal.estimatedValue, deal.currency)}</td>
          <td style="text-align:right"><span class="chip ${STAGE_TONE[deal.stage] ?? ""}">${esc(deal.stage)}</span></td>
        </tr>`
          )
          .join("")}</table>`
      : `<div class="empty" style="padding:20px">No deals yet.</div>`;

    const leads = d.leads.length
      ? d.leads
          .map(
            (l) => `
        <div class="lead-row" data-lead="${esc(l.id)}">
          <div>
            <div class="co">${esc(l.refNo)}</div>
            <div class="meta">${esc(l.source)}${l.serviceType ? ` · ${esc(l.serviceType)}` : ""}</div>
          </div>
          <div><span class="chip ${l.status === "converted" ? "good" : ""}">${esc(String(l.status).replace("_", " "))}</span></div>
          <div class="score">${l.score ?? "—"}<small>score</small></div>
          <div class="meta" style="font-size:11.5px;color:var(--ink-3)">${ago(l.createdAt)}</div>
        </div>`
          )
          .join("")
      : `<div class="empty" style="padding:20px">No leads linked.</div>`;

    view().innerHTML = `
      <div class="bar" style="margin-bottom:14px">
        <a class="btn" href="#accounts" style="text-decoration:none">← Accounts</a>
        <span style="flex:1"></span>
        ${syncChip(a)}
      </div>

      <div class="split">
        <div class="stack">
          <div class="card">
            <header><h3>Enquiries</h3><span class="grow"></span>
              <span style="font-size:11.5px;color:var(--ink-3)">every lead that resolved to this company</span>
            </header>
            ${leads}
          </div>
          <div class="card">
            <header><h3>Deals</h3></header>
            <div class="in">${deals}</div>
          </div>
        </div>

        <div class="stack">
          <div class="card">
            <header><h3>Company</h3></header>
            <div class="in">${facts}</div>
          </div>
          <div class="card">
            <header><h3>Contacts</h3></header>
            <div class="in">${contacts}</div>
          </div>
        </div>
      </div>`;

    for (const row of view().querySelectorAll("[data-lead]")) {
      row.onclick = () => {
        location.hash = `#lead/${row.dataset.lead}`;
      };
    }
  }

  return { list, detail };
}
