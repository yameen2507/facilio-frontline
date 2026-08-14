# Frontline Build Map v1

> **Update 15 Aug 2026 — all seven parts plus the quick wins are BUILT** (working
> tree, typechecked, 468 tests green, dist/ and build/functions rebuilt).
> Closed or advanced: D-19, F-12, F-22, X-05 (people spine + UserPicker);
> D-05 (value split lead→deal); D-04 partial + D-10 (controlled intake + origin);
> P-06, D-22, F-02, D-23 (one Submit, empty-survey gate, derived keys);
> D-25, D-26, X-04, X-02, D-33, D-35 partial, D-15 (lists & lookups);
> F-18, F-19, D-37 (account write path); F-08, F-09, P-09 (Won→Facilio + outbox
> surface); F-10, F-06, X-16, X-14, X-15, X-08, X-07 (quick wins).
> Still open by design: P-11's persona session (P-01–P-04, X-06), D-36 global
> search, D-24/D-27/D-28/D-29/D-30/D-31/D-32/D-34, F-13 breadth, and the
> runtime-only 🔍 items. Deploy note: none of this is on preview until
> `facilio vibe function push` (lead, survey, form, deal are all changed) and a
> `facilio vibe deploy` run.

What is built, what is not, and the order to build the rest — derived from
**Frontline Issues Coverage v1.md** (14 Aug 2026) and the repo at HEAD `c1dafdc` + working tree.

The organizing idea: the product is a **chain of handovers** (the H-numbers from the audit's
persona sheet). A module is only "done" when both ends of its handovers are wired. So this map
goes part by part down the funnel, then walks the touchpoints between parts, then gives the
build order.

---

## 1 · Part by part — what exists at each stage

### Intake (web widget, chat analyst)
**Built:** `features/chat/` (playground, widget preview, analyst brief), `fl_intake_session` /
`fl_intake_message`, `src/modules/intake.ts`, AI extraction into a lead.
**Missing:** the lead it produces inherits every lead-form gap below; widget endpoint failure
(N-11) unverified.
**State: ~80% — works, feeds a weak form.**

### Lead (inbox, detail, AI assessment, lifecycle)
**Built:** full module — SLA clocks, dedup on email/phone/domain with the duplicate dialog,
claim (now idempotent), assign, qualify/close, AI analysis with versioned
`fl_lead_analysis`, hand-raise dialog, permission-gated actions (`can()` — only module fully
gated).
**Missing (all on the FORM and the LIST, not the engine):**
- D-05 Estimated value split (one-off/recurring toggle + frequency) — **FINALISED, P0, untouched**
- D-04 controlled Service/City/Region from the coverage catalogue — **scheduled before demo**
- D-10 channel vs source split; D-01 field groups; D-02 "Lead contact name" + role;
  D-06 needed-by; D-07 incumbent; D-09 dedup keys not required
- D-25/D-26/X-04 the tab strip (three axes in one control, internal words, "Won"≠converted)
- F-06 convert has no score/verdict guard
**State: engine ~90%, form ~40%, list ~50%.**

### Account
**Built:** list, detail with contacts rail + enquiries/deals/surveys tabs, `fl_account_contact`,
Facilio sync status, raise-survey link that carries the deal.
**Missing:** F-18 standalone create (accounts can only be born from a lead), F-19 the page is
read-only, D-37 no add/edit-contact UI, X-15 address dedup, X-16 red "not in Facilio yet".
**State: read path done, write path absent.**

### Deal
**Built:** full module (new since the audit — closes F-14): list, detail, stage path,
`deal-state.ts` with tests, won/lost capture, reopen door, `won` event as the Ops cue.
**Missing:** nothing internal; its gaps are touchpoints (see §2 — F-08, H10).
**State: ~90%.**

### Survey — lifecycle & desk
**Built:** the whole state machine (T2–T9) with count guards, revision freeze before status,
rework loop with mandatory reason, visits with access details + site contact, reconciliation
(import → diff → decide), completeness restamped on every move, cancel with reason.
**Missing:**
- **D-19/F-12 assignee is still a free-text email box** — P0, scheduled before demo
- F-22 `user_id` columns exist but assign writes only email
- P-06 two buttons where the ruling said one Submit that routes on lead-ness
- D-22 second half: a template with zero required questions submits empty
- D-14 half: assignee + access not on the create form (only on Schedule visit)
- X-02 no Draft/Cancelled filter; D-33 next-visit date not in the list
**State: engine ~95%, people-wiring ~30%.**

### Survey — walk (capture)
**Built:** walk page, section entries, answers with types, observations (condition,
contamination, safety, access constraint), photos, ad-hoc questions, space creation under a
guaranteed site.
**Missing:** F-21 a general "add a note anywhere at site level" surface (ruled scope — voice
dropped); N-01/N-02 runtime behaviours unverified.
**State: ~85%.**

### Templates (form builder)
**Built:** builder with sections, repeatable entries that create spaces, five field types incl.
`number` + closed unit list, required toggle, estimable-type rule, publish blockers, version-up
copy, frozen-opens-as-preview, draft reopen.
**Missing:** F-02 ruling (auto-generate key, hide behind Advanced — key is still free text),
F-10 publish doesn't archive the prior published version (**data bug**), D-24 help text not
editable, D-34 card grid vs table.
**State: ~80%.**

### Portfolio / Prospects
**Built (new since the audit):** tree page, paste-from-RFP import, location detail,
verdicts, ancestry, convert-to-Facilio page with `fl_prospect_convert_log`
(dedup keys, error text, per-run status) — closes F-16, most of D-38, most of P-09's pre-flight.
**Missing:** hangs off the Deal only — no Related Sites entry from Lead/Account (D-38 as
specced); D-39 dedicated re-parent screen unconfirmed.
**State: ~85%.**

### Proposals + Rate cards
**Built (new since the audit):** full pricing lane — proposal lifecycle, lines sourced from
survey answers/observations via estimation keys, rate-card resolution, diff pane, negotiation
thread, approval panel, document render, one-time vs recurring-monthly totals, freeze +
checksum.
**Missing:** nothing raised by the audit (it predates the module). Depends on F-02's key
quality upstream.
**State: ~90%.**

### Settings (users, roles, permissions, coverage, rate cards, service links)
**Built:** Users + Roles + Permissions surfaces (D-14 confirmed live), permission catalog,
`can()` fail-open, service coverage catalogue, rate cards, survey settings.
**Missing:** F-13 `can()` only consumed by Leads + Settings; P-01–P-04/P-11 frozen behind the
persona working session (correctly — ruled a session, not code).
**State: surfaces done, adoption thin.**

### Cross-cutting
**Built:** responsive shell (N-04 ✅), clickable rows (X-01 ✅), URL state on 4 of 7 lists.
**Missing:** **D-35 searchable lookup — FINALISED "one component, everywhere", zero comboboxes
in the codebase**; D-36 global search; X-05 raw emails everywhere a name belongs; D-28 saved
views; N-08 export.

---

## 2 · The touchpoints — the handover chain

This is the "connect the respective things" view. Each arrow is a handover the audit graded.

```
Intake ──► Lead ──► Account+Deal ──► Survey ──► Walk ──► Review ──► Proposal ──► Won ──► Facilio
   H1        H2/H3       H4             H5        (capture)  H6/H7      H8/H9      H10
```

| Touchpoint | From → To | Status | What carries it | What's missing |
| --- | --- | --- | --- | --- |
| H1 | Widget → Lead | 🟢 | intake extraction → `fl_lead` | inherits weak form fields |
| H2 | Handler → BDR | 🟡 | `claimLead` + `fl_lead_assignment.reason` | thin context; P-10 |
| H3 | BDR → BD manager | 🔴 | nothing lands anywhere | P-07 — no manager destination |
| H4 | Lead → Account+Deal | 🟢 | `convert.ts` (atomic, idempotent) | F-06 no score guard |
| H5 | Coordinator → Surveyor | 🟡 | visit: access, site contact, instructions | **the assignee itself is a typed email** (D-19/F-22) |
| H6 | Surveyor → Survey lead | 🟢 | T5 + `reviewGuard` + send-back with reason | P-06 wants it as one button |
| H7 | Lead → Estimator | 🟢 | revision freeze + checksum + warnings | P-06 same button; D-22 empty-survey hole |
| H8 | Revision → Proposal lines | 🟢 | estimation keys → rate-card rows | key quality (F-02 free text) |
| H9 | Proposal → Decision | 🟢 | approve/send/accept/reject lifecycle | — |
| H10 | Won → Ops/Facilio | 🟡 | convert log pre-flight exists | fires at **convert**, not Won (F-08); `won` event already emitted, nothing listens |

**Reading:** the middle of the chain (H4–H9) is now solid. The two red/weak links are the
**people** (H5 — who goes, typed as a string) and the **exit** (H10 — the Facilio write happens
at the wrong moment). Everything else is form quality, not plumbing.

---

## 3 · The build order — most important first

Each part is sized, names the issues it closes, and names the touchpoints it connects.
Do them in order; each unlocks the next.

### Part 1 — The people spine ⚡ (highest leverage, smallest gap)
**Build:** one `UserPicker` combobox over `fl_user` (name + role + team + region), used by:
survey Assign, set-lead, visit assignees, lead assign dialog. Write `user_id` alongside email.
Render `fl_user.name` wherever an email prints today.
**Closes:** D-19 (P0, pre-demo), F-12, F-22, X-05, half of D-14, strengthens H2/H5.
**Touchpoints connected:** Settings→Users becomes the source of truth for Surveys, Leads,
Deals, activity. This is also the first instance of the D-35 component — build it as the
generic searchable lookup, not a one-off.
**Why first:** everything is already in place except the control; it was raised to P0 and
scheduled before the demo; and it seeds Part 5.

### Part 2 — The commercial value spine
**Build:** D-05 exactly as ruled — rename to *Estimated value*, One-off/Recurring/Both toggle,
frequency picker when recurring, two columns on `fl_lead` (`value_type`, `value_frequency`),
carried through convert onto `fl_deal`, summed correctly in any pipeline number.
**Closes:** D-05 (P0, FINALISED, untouched).
**Touchpoints connected:** Lead → Deal → (eventually) Proposal totals all speak the same
one-off/recurring language the proposal module *already has*
(`total_one_time` / `total_recurring_monthly`) — today the lead throws away the distinction
the proposal ends with.

### Part 3 — Controlled intake
**Build:** D-04 — Service/City/Region pickers reading the coverage catalogue that already
exists in Settings, with "outside our areas" self-scoring; D-10 channel/source as two fields.
**Closes:** D-04 (pre-demo), D-10, improves AI scoring (the §6 doctrine violation), makes
"wins by source" answerable.
**Touchpoints connected:** Settings→Coverage becomes the vocabulary of Intake and of the AI
analyst; H1 starts producing scoreable leads.

### Part 4 — One Submit (finish the survey exit)
**Build:** P-06 as ruled — one **Submit** button: if the actor is not the lead → T5
(pending review); if the actor *is* the lead → T5+T7 in one move, freeze fires. Plus D-22's
gate: at least one answered question. Plus F-02's key auto-generation (slug from question
text + unit, visible under Advanced).
**Closes:** P-06 (P0), D-22, F-02 remainder, D-23 (superseded into this).
**Touchpoints connected:** H6+H7 collapse into the single control Sudharsan asked for; H8
gets stable keys so proposal lines stop falling through to unpriced.

### Part 5 — Lists and lookups
**Build:** D-35 rollout of the Part-1 combobox to every reference field (deal, site, template,
account, service); D-25 tab strip split into status filter + ownership toggle + SLA flag;
rename D-26 words; fix X-04 Won/converted; add X-02 Draft/Cancelled filters; D-33 next-visit
date column.
**Closes:** D-25 (P0), D-26, D-35, X-02, X-04, D-33 — six items, one sweep.
**Touchpoints connected:** none new — this is friction removal on every surface at once.

### Part 6 — Account write path
**Build:** F-18 standalone create, F-19 edit dialog, D-37 contact add/edit on the rail.
**Closes:** F-18, F-19, D-37, and gives H3 a place to land (a manager works accounts, not the
inbox).

### Part 7 — Won → Facilio (move the exit to the right moment)
**Build:** F-08 — move client/contact enqueue from `convert.ts` to the `won` transition in
`deal.ts` (the event and the idempotent outbox already exist); surface P-09's pre-flight from
the deal's Won moment; surface F-09 sync errors (`last_error` is already stored).
**Closes:** F-08, P-09 remainder, F-09.
**Touchpoints connected:** H10 fires when the business fact is true, with a pre-flight, with
visible failures.

### Quick wins — slot anywhere (each < 1 hour)
- **F-10** publish archives the prior published version (`form.ts:359`) — data bug
- **F-06** convert guard: warn/confirm when verdict is `not_relevant` or score < threshold
- **X-16** neutral tone for "not in Facilio yet"; **X-14** title maxLength; **X-15** address dedup
- **X-08** rename "AI assessment" → "AI analysis"; **X-07** show model + prompt version (data already stored)

### Not code — schedule it
- **P-11** the persona working session. P-01–P-04 and the "Actioner" wording (X-06) all wait
  on it, and every week it slips, more UI ships the old words.

---

## 4 · One-line summary

The pipes are built end to end — lead engine, deal, survey lifecycle, portfolio, proposals.
What is not built is **who** (people as records, not strings), **how much** (one-off vs
recurring at intake), and **when** (Facilio at Won, not convert) — plus the form/list quality
the audit spent most of its rows on. Parts 1–4 above close every remaining P0 that is code.
