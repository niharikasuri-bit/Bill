/* Bill Inbox prototype: billing-period multiselect, bulk approve / download / delete, generate bill. */
(() => {
  "use strict";

  // ---------- Data ----------
  const CAMPAIGN = "Bednet_endtoend_1";
  const LGA = "Shani";

  const PERIODS = [
    { id: "p1", n: 1, start: "2026-04-01", end: "2026-04-07" },
    { id: "p2", n: 2, start: "2026-04-08", end: "2026-04-14" },
    { id: "p3", n: 3, start: "2026-04-15", end: "2026-04-21" },
    { id: "p4", n: 4, start: "2026-04-22", end: "2026-04-28" },
  ];

  const FIRST = ["Aisha", "Musa", "Fatima", "Ibrahim", "Zainab", "Yusuf", "Hauwa", "Abubakar", "Amina", "Sani", "Halima", "Bello", "Maryam", "Umar", "Khadija", "Idris", "Safiya", "Garba", "Rakiya", "Lawal"];
  const LAST = ["Abdullahi", "Mohammed", "Usman", "Aliyu", "Bala", "Danjuma", "Yakubu", "Suleiman", "Haruna", "Adamu"];
  const ROLES = ["Distributor", "Registrar", "Team supervisor"];

  const periodById = (id) => PERIODS.find((p) => p.id === id);

  let seq = 360;
  const registers = [];
  function addRegister(periodId, boundary, attendees, status, by) {
    const id = `WR/2026-27/04/30/${String(seq++).padStart(6, "0")}`;
    const reg = { id, periodId, boundary, attendees, status, approvedBy: status === "approved" ? by : "", submittedBy: "proxy sup", logs: [] };
    reg.logs.push({ action: "Register submitted", by: "proxy sup", at: periodEnd(periodId, 0, 18, 10) });
    if (status === "approved") reg.logs.push({ action: "Register approved", by, at: periodEnd(periodId, 1, 9, 30), comment: "Attendance verified against the muster roll." });
    registers.push(reg);
  }
  function periodEnd(pid, addDays, h, m = 0) {
    const d = new Date(periodById(pid).end + "T00:00:00");
    d.setDate(d.getDate() + addDays);
    d.setHours(h, m);
    return d;
  }

  // Period 1 mirrors the live screen: 2 approved, 0 pending.
  addRegister("p1", "Walama Tawa", 12, "approved", "proxy sup");
  addRegister("p1", "Thlida T Gulami", 6, "approved", "proxy sup");
  addRegister("p2", "Walama Tawa", 12, "approved", "proxy sup");
  addRegister("p2", "Thlida T Gulami", 6, "approved", "proxy sup");
  addRegister("p2", "Kubo", 9, "pending");
  addRegister("p2", "Gora", 14, "pending");
  addRegister("p3", "Walama Tawa", 11, "approved", "proxy sup");
  addRegister("p3", "Thlida T Gulami", 6, "pending");
  addRegister("p3", "Kubo", 8, "pending");
  addRegister("p3", "Gora", 15, "pending");
  addRegister("p3", "Shani Town", 10, "pending");
  addRegister("p4", "Walama Tawa", 12, "pending");
  addRegister("p4", "Thlida T Gulami", 7, "pending");
  addRegister("p4", "Kubo", 9, "pending");

  // Deterministic attendee list per register.
  function attendeesOf(reg) {
    const seed = parseInt(reg.id.slice(-3), 10);
    return Array.from({ length: reg.attendees }, (_, i) => {
      const k = seed * 7 + i * 13;
      const days = Array.from({ length: 7 }, (_, d) => ((k + d * 5) % 9 === 0 ? "A" : "P"));
      return {
        name: `${FIRST[k % FIRST.length]} ${LAST[(k >> 1) % LAST.length]}`,
        role: ROLES[i === 0 ? 2 : k % 2],
        mobile: `080${String(30000000 + ((k * 7919) % 69999999)).padStart(8, "0")}`,
        days,
      };
    });
  }

  // ---------- State ----------
  const state = {
    draftPeriods: ["p1"],
    appliedPeriods: ["p1"],
    tab: "approved",
    selected: { approved: new Set(), pending: new Set() },
    page: 0,
    rowsPerPage: 10,
    bills: [], // { no, periodId, registerIds }
    flash: new Set(),
  };
  const ME = "You";

  // ---------- Helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const plural = (n, w) => `${n} ${n === 1 ? w : w + "s"}`;
  const fmt = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const fmtDT = (d) => d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const periodLabel = (p) => `Period ${p.n} (${fmt(p.start)} - ${fmt(p.end)})`;
  const periodShort = (p) => `Period ${p.n}`;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ICON = {
    check: '<svg class="i" viewBox="0 0 24 24"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>',
    close: '<svg class="i" viewBox="0 0 24 24"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4l5.6 5.6L5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6z"/></svg>',
    warn: '<svg class="i" viewBox="0 0 24 24"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>',
    bill: '<svg class="i" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>',
  };

  const inScope = () => registers.filter((r) => state.appliedPeriods.includes(r.periodId) && !r.billNo);
  const tabRows = (tab) => inScope().filter((r) => r.status === tab);
  const multiPeriod = () => state.appliedPeriods.length > 1;

  // ---------- Loader / toast ----------
  function withLoader(text, fn, ms = 900) {
    $("#loaderText").textContent = text;
    $("#loader").hidden = false;
    return new Promise((res) => setTimeout(async () => {
      try { await fn(); } finally { $("#loader").hidden = true; res(); }
    }, ms));
  }
  function toast(msg, opts = {}) {
    const el = document.createElement("div");
    el.className = "toast" + (opts.error ? " error" : "");
    el.innerHTML = `${opts.error ? ICON.warn : ICON.check}<span>${esc(msg)}</span>`;
    if (opts.action) {
      const b = document.createElement("button");
      b.textContent = opts.action.label;
      b.onclick = () => { opts.action.run(); el.remove(); };
      el.appendChild(b);
    }
    $("#toasts").appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }

  // ---------- Billing period multiselect ----------
  const ms = $("#periodSelect");
  const msTrigger = $(".ms-trigger", ms);
  const msPanel = $(".ms-panel", ms);
  let focusIdx = 0;

  function availablePeriods() { return PERIODS.filter((p) => registers.some((r) => r.periodId === p.id && !r.billNo)); }

  function renderPeriodSelect() {
    const avail = availablePeriods();
    const sel = state.draftPeriods;
    const v = $("#periodValue");
    if (!sel.length) { v.textContent = "Select billing periods"; v.classList.add("placeholder"); }
    else if (sel.length === 1) { v.textContent = periodLabel(periodById(sel[0])); v.classList.remove("placeholder"); }
    else { v.textContent = `${sel.length} billing periods selected`; v.classList.remove("placeholder"); }

    const allOn = avail.length > 0 && avail.every((p) => sel.includes(p.id));
    const someOn = sel.length > 0 && !allOn;
    const opts = [
      `<button type="button" role="option" class="ms-option all" data-id="__all" aria-selected="${allOn}"><span class="cbox ${allOn ? "on" : someOn ? "mixed" : ""}"></span><span>Select all</span></button>`,
      ...PERIODS.map((p) => {
        const all = registers.filter((r) => r.periodId === p.id);
        const regs = all.filter((r) => !r.billNo);
        const billed = all.length > 0 && regs.length === 0;
        const on = sel.includes(p.id);
        const pend = regs.filter((r) => r.status === "pending").length;
        const done = all.length - regs.length;
        const hint = billed ? "Bill generated for all registers" : `${plural(regs.length, "register")}${pend ? ` · ${pend} pending approval` : " · all approved"}${done ? ` · ${done} billed` : ""}`;
        return `<button type="button" role="option" class="ms-option" data-id="${p.id}" aria-selected="${on}" ${billed ? 'aria-disabled="true" disabled style="opacity:.55;cursor:not-allowed"' : ""}><span class="cbox ${on ? "on" : ""}"></span><span>${periodLabel(p)}<small>${hint}</small></span></button>`;
      }),
    ];
    msPanel.innerHTML = opts.join("");

    $("#periodChips").innerHTML = sel.length > 1
      ? sel.map((id) => `<span class="chip">${periodShort(periodById(id))}<button type="button" data-remove="${id}" aria-label="Remove ${periodShort(periodById(id))}">${ICON.close}</button></span>`).join("") + `<button type="button" class="chip-clear" data-remove="__all">Clear all</button>`
      : "";
  }

  function toggleDraft(id) {
    const avail = availablePeriods().map((p) => p.id);
    if (id === "__all") {
      state.draftPeriods = avail.every((x) => state.draftPeriods.includes(x)) ? [] : [...avail];
    } else if (state.draftPeriods.includes(id)) {
      state.draftPeriods = state.draftPeriods.filter((x) => x !== id);
    } else {
      state.draftPeriods = PERIODS.map((p) => p.id).filter((x) => x === id || state.draftPeriods.includes(x));
    }
    if (state.draftPeriods.length) $("#periodError").hidden = true;
    renderPeriodSelect();
    focusOption(focusIdx);
  }
  function optionEls() { return $$(".ms-option:not([disabled])", msPanel); }
  function focusOption(i) {
    const els = optionEls();
    if (!els.length) return;
    focusIdx = Math.max(0, Math.min(i, els.length - 1));
    els.forEach((e, k) => e.classList.toggle("focused", k === focusIdx));
    if (!msPanel.hidden) els[focusIdx].focus();
  }
  function openMs() { msPanel.hidden = false; msTrigger.setAttribute("aria-expanded", "true"); focusOption(0); }
  function closeMs(returnFocus) { msPanel.hidden = true; msTrigger.setAttribute("aria-expanded", "false"); if (returnFocus) msTrigger.focus(); }

  msTrigger.addEventListener("click", () => (msPanel.hidden ? openMs() : closeMs()));
  msTrigger.addEventListener("keydown", (e) => { if (e.key === "ArrowDown") { e.preventDefault(); openMs(); } });
  msPanel.addEventListener("click", (e) => {
    const o = e.target.closest(".ms-option");
    if (!o || o.disabled) return;
    focusIdx = optionEls().indexOf(o);
    toggleDraft(o.dataset.id);
  });
  msPanel.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); focusOption(focusIdx + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusOption(focusIdx - 1); }
    else if (e.key === "Escape" || e.key === "Tab") { closeMs(e.key === "Escape"); }
  });
  document.addEventListener("click", (e) => {
    if (!ms.contains(e.target) && !msPanel.hidden) closeMs();
    if (!e.target.closest(".menu-wrap")) closeMenu();
  });
  $("#periodChips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-remove]");
    if (!b) return;
    state.draftPeriods = b.dataset.remove === "__all" ? [] : state.draftPeriods.filter((x) => x !== b.dataset.remove);
    renderPeriodSelect();
  });

  $("#filters").addEventListener("submit", (e) => {
    e.preventDefault();
    closeMs();
    if (!state.draftPeriods.length) { $("#periodError").hidden = false; msTrigger.focus(); return; }
    withLoader("Fetching registers…", () => {
      state.appliedPeriods = [...state.draftPeriods];
      state.selected.approved.clear();
      state.selected.pending.clear();
      state.page = 0;
      render();
    }, 700);
  });
  $("#resetFilters").addEventListener("click", () => {
    const first = availablePeriods()[0];
    state.draftPeriods = first ? [first.id] : [];
    $("#periodError").hidden = true;
    renderPeriodSelect();
  });

  // ---------- Tabs ----------
  $$(".tab").forEach((t) => t.addEventListener("click", () => setTab(t.dataset.tab)));
  $(".tabs").addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const next = state.tab === "approved" ? "pending" : "approved";
      setTab(next);
      $(`#tab-${next}`).focus();
    }
  });
  function setTab(tab) { state.tab = tab; state.page = 0; closeMenu(); render(); }

  // ---------- Table ----------
  function columns() {
    const cols = [
      { key: "id", label: "Attendance ID" },
      { key: "boundary", label: "Boundary" },
      { key: "who", label: state.tab === "approved" ? "Approved by" : "Submitted by" },
      { key: "attendees", label: "Number of attendees", num: true },
    ];
    if (multiPeriod()) cols.push({ key: "period", label: "Billing period" });
    cols.push({ key: "logs", label: "Comments" });
    return cols;
  }

  function render() {
    // Prune selections of registers that moved or no longer exist.
    for (const tab of ["approved", "pending"]) {
      const ids = new Set(tabRows(tab).map((r) => r.id));
      [...state.selected[tab]].forEach((id) => { if (!ids.has(id)) state.selected[tab].delete(id); });
    }

    const approved = tabRows("approved");
    const pending = tabRows("pending");
    $("#tab-approved").innerHTML = `Approved registers (<span class="count">${approved.length}</span>)`;
    $("#tab-pending").innerHTML = `Pending registers (<span class="count">${pending.length}</span>)`;
    $$(".tab").forEach((t) => {
      const on = t.dataset.tab === state.tab;
      t.setAttribute("aria-selected", on);
      t.tabIndex = on ? 0 : -1;
    });
    $("#panel").setAttribute("aria-labelledby", `tab-${state.tab}`);

    // Header range
    const ps = state.appliedPeriods.map(periodById);
    $("#campaignRange").textContent = ps.length === 1
      ? `(${fmt(ps[0].start)} - ${fmt(ps[0].end)})`
      : `(${fmt(ps[0].start)} - ${fmt(ps[ps.length - 1].end)} · ${ps.length} billing periods)`;

    const rows = state.tab === "approved" ? approved : pending;
    const sel = state.selected[state.tab];
    const pages = Math.max(1, Math.ceil(rows.length / state.rowsPerPage));
    state.page = Math.min(state.page, pages - 1);
    const startIdx = state.page * state.rowsPerPage;
    const pageRows = rows.slice(startIdx, startIdx + state.rowsPerPage);
    const pageSel = pageRows.filter((r) => sel.has(r.id)).length;
    const allPage = pageRows.length > 0 && pageSel === pageRows.length;

    const cols = columns();
    $("#thead").innerHTML = `<tr><th class="cb">${rows.length ? `<button type="button" role="checkbox" id="selectPage" aria-checked="${allPage ? "true" : pageSel ? "mixed" : "false"}" aria-label="Select all registers on this page"><span class="cbox ${allPage ? "on" : pageSel ? "mixed" : ""}"></span></button>` : ""}</th>${cols.map((c) => `<th class="${c.num ? "num" : ""}">${c.label}</th>`).join("")}</tr>`;

    if (!rows.length) {
      const msg = state.tab === "pending"
        ? ["No registers waiting for approval", "All registers for the selected billing period are approved."]
        : ["No approved registers yet", pending.length ? `Approve registers from the Pending registers tab to include them in the bill.` : "There are no registers for the selected billing period."];
      $("#tbody").innerHTML = `<tr><td colspan="${cols.length + 1}" class="empty"><strong>${msg[0]}</strong>${msg[1]}${state.tab === "approved" && pending.length ? `<div style="margin-top:12px"><button type="button" class="btn outline" data-goto="pending">Go to pending registers</button></div>` : ""}</td></tr>`;
    } else {
      $("#tbody").innerHTML = pageRows.map((r) => {
        const on = sel.has(r.id);
        const cells = cols.map((c) => {
          switch (c.key) {
            case "id": return `<td><a href="#" class="link" data-open="${r.id}">${r.id}</a></td>`;
            case "boundary": return `<td>${esc(r.boundary)}</td>`;
            case "who": return `<td>${esc(state.tab === "approved" ? r.approvedBy : r.submittedBy)}</td>`;
            case "attendees": return `<td class="num">${r.attendees}</td>`;
            case "period": return `<td class="period-cell">${periodLabel(periodById(r.periodId))}</td>`;
            case "logs": return `<td><a href="#" class="link" data-logs="${r.id}">View Logs</a></td>`;
          }
        }).join("");
        return `<tr class="${on ? "is-selected" : ""} ${state.flash.has(r.id) ? "flash" : ""}"><td class="cb"><button type="button" role="checkbox" aria-checked="${on}" aria-label="Select ${r.id}" data-toggle="${r.id}"><span class="cbox ${on ? "on" : ""}"></span></button></td>${cells}</tr>`;
      }).join("");
    }
    state.flash.clear();

    // Pager
    $("#pageInfo").textContent = rows.length ? `${startIdx + 1}-${Math.min(startIdx + state.rowsPerPage, rows.length)} of ${rows.length}` : "0 of 0";
    $('[data-page="first"]').disabled = $('[data-page="prev"]').disabled = state.page === 0;
    $('[data-page="next"]').disabled = $('[data-page="last"]').disabled = state.page >= pages - 1;

    // Bulk bar
    const n = sel.size;
    const word = state.tab === "approved" ? "approved register" : "pending register";
    $("#bulkInfo").innerHTML = n
      ? `<strong>${plural(n, "register")} selected</strong><button type="button" id="clearSel">Clear selection</button>`
      : `<span>${plural(rows.length, word)}${rows.length ? ` · select registers to ${state.tab === "pending" ? "approve, " : "generate a bill, "}download or delete` : ""}</span>`;
    $("#approveBtn").hidden = state.tab !== "pending";
    $("#approveBtn").disabled = n === 0;
    $("#approveBtn").lastChild.textContent = n > 1 ? `Approve (${n})` : "Approve";
    $("#downloadBtn").disabled = n === 0;
    $("#deleteBtn").disabled = n === 0;
    $("#downloadBtn .caret").hidden = n < 2;
    $("#singleHint").textContent = `All ${n} registers in one sheet`;

    // Footer
    // Generate Bill works on the approved registers the user has ticked.
    const toBill = approved.filter((r) => state.selected.approved.has(r.id));
    $("#generateBtn").hidden = state.tab !== "approved";
    $("#generateBtn").disabled = toBill.length === 0;
    $("#generateBtn").lastChild.textContent = toBill.length > 1 ? `Generate Bill (${toBill.length})` : "Generate Bill";

    renderPeriodSelect();
  }

  // Table interactions
  $("#thead").addEventListener("click", (e) => {
    if (!e.target.closest("#selectPage")) return;
    const rows = tabRows(state.tab);
    const pageRows = rows.slice(state.page * state.rowsPerPage, (state.page + 1) * state.rowsPerPage);
    const sel = state.selected[state.tab];
    const all = pageRows.every((r) => sel.has(r.id));
    pageRows.forEach((r) => (all ? sel.delete(r.id) : sel.add(r.id)));
    render();
    $("#selectPage")?.focus();
  });
  $("#tbody").addEventListener("click", (e) => {
    const t = e.target.closest("[data-toggle]");
    if (t) {
      const sel = state.selected[state.tab];
      sel.has(t.dataset.toggle) ? sel.delete(t.dataset.toggle) : sel.add(t.dataset.toggle);
      const id = t.dataset.toggle;
      render();
      $(`[data-toggle="${CSS.escape(id)}"]`)?.focus();
      return;
    }
    const o = e.target.closest("[data-open]");
    if (o) { e.preventDefault(); openRegister(o.dataset.open); return; }
    const l = e.target.closest("[data-logs]");
    if (l) { e.preventDefault(); openLogs(l.dataset.logs); return; }
    const g = e.target.closest("[data-goto]");
    if (g) setTab(g.dataset.goto);
  });
  $("#bulkInfo").addEventListener("click", (e) => {
    if (e.target.id === "clearSel") { state.selected[state.tab].clear(); render(); }
  });
  $(".pager-btns").addEventListener("click", (e) => {
    const b = e.target.closest("[data-page]");
    if (!b || b.disabled) return;
    const pages = Math.max(1, Math.ceil(tabRows(state.tab).length / state.rowsPerPage));
    state.page = { first: 0, prev: state.page - 1, next: state.page + 1, last: pages - 1 }[b.dataset.page];
    render();
  });
  $("#rowsPerPage").addEventListener("change", (e) => { state.rowsPerPage = +e.target.value; state.page = 0; render(); });

  // ---------- Dialog ----------
  let lastFocus = null;
  function dialog({ tone = "info", icon = ICON.bill, title, body, actions }) {
    lastFocus = document.activeElement;
    const ic = $("#dialogIcon");
    ic.className = `dialog-icon ${tone}`;
    ic.innerHTML = icon;
    $("#dialogTitle").textContent = title;
    $("#dialogBody").innerHTML = body;
    const wrap = $("#dialogActions");
    wrap.className = `dialog-actions ${actions.length === 1 ? "one" : ""}`;
    wrap.innerHTML = "";
    actions.forEach((a) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `btn ${a.kind || "outline"}`;
      b.textContent = a.label;
      b.onclick = () => { if (a.run?.() !== false) closeDialog(); };
      wrap.appendChild(b);
    });
    $("#dialogOverlay").hidden = false;
    ($("textarea", $("#dialogBody")) || wrap.lastChild).focus();
  }
  function closeDialog() { $("#dialogOverlay").hidden = true; lastFocus?.focus?.(); }

  // ---------- Approve ----------
  $("#approveBtn").addEventListener("click", () => {
    const ids = [...state.selected.pending];
    const regs = registers.filter((r) => ids.includes(r.id));
    const att = regs.reduce((s, r) => s + r.attendees, 0);
    dialog({
      tone: "success",
      icon: ICON.check,
      title: ids.length > 1 ? `Approve ${ids.length} registers?` : "Approve this register?",
      body: `<div class="summary"><div><span>Registers</span><strong>${ids.length}</strong></div><div><span>Attendees</span><strong>${att}</strong></div>${multiPeriod() ? `<div><span>Billing periods</span><strong>${[...new Set(regs.map((r) => periodShort(periodById(r.periodId))))].join(", ")}</strong></div>` : ""}</div>
        <label for="approveComment">Comment (optional)</label>
        <textarea id="approveComment" placeholder="Add a note for the audit log"></textarea>
        <p class="note">Approved registers move to the Approved registers tab and are included when you generate the bill.</p>`,
      actions: [
        { label: "Cancel" },
        {
          label: ids.length > 1 ? `Approve ${ids.length} registers` : "Approve",
          kind: "primary",
          run: () => {
            const comment = $("#approveComment").value.trim();
            withLoader(`Approving ${plural(ids.length, "register")}…`, () => {
              regs.forEach((r) => {
                r.status = "approved";
                r.approvedBy = ME;
                r.logs.push({ action: "Register approved", by: ME, at: new Date(), comment });
                state.flash.add(r.id);
              });
              state.selected.pending.clear();
              render();
              toast(`${plural(ids.length, "register")} approved`, { action: { label: "View approved", run: () => setTab("approved") } });
            });
          },
        },
      ],
    });
  });

  // ---------- Delete ----------
  $("#deleteBtn").addEventListener("click", () => {
    const ids = [...state.selected[state.tab]];
    dialog({
      tone: "danger",
      icon: ICON.warn,
      title: ids.length > 1 ? "Are you sure you want to delete these registers?" : "Are you sure you want to delete this register?",
      body: `<p>You've selected ${plural(ids.length, "register")}. Once deleted, ${ids.length > 1 ? "they" : "it"} cannot be recovered and won't be included in the bill.</p>`,
      actions: [
        { label: "Cancel" },
        {
          label: "Delete",
          kind: "primary",
          run: () => withLoader(`Deleting ${plural(ids.length, "register")}…`, () => {
            ids.forEach((id) => registers.splice(registers.findIndex((r) => r.id === id), 1));
            state.selected[state.tab].clear();
            render();
            toast(`${plural(ids.length, "register")} deleted`);
          }),
        },
      ],
    });
  });

  // ---------- Download ----------
  const menu = $("#downloadMenu");
  function closeMenu() { menu.hidden = true; $("#downloadBtn").setAttribute("aria-expanded", "false"); }
  $("#downloadBtn").addEventListener("click", () => {
    const n = state.selected[state.tab].size;
    if (n === 1) return download("single");
    const open = menu.hidden;
    menu.hidden = !open;
    $("#downloadBtn").setAttribute("aria-expanded", String(open));
    if (open) $("button", menu).focus();
  });
  menu.addEventListener("click", (e) => {
    const b = e.target.closest("[data-mode]");
    if (!b) return;
    closeMenu();
    download(b.dataset.mode);
  });
  menu.addEventListener("keydown", (e) => {
    const items = $$("button", menu);
    const i = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    if (e.key === "Escape") { closeMenu(); $("#downloadBtn").focus(); }
  });

  function dayHeaders(p) {
    const d = new Date(p.start + "T00:00:00");
    return Array.from({ length: 7 }, (_, i) => {
      const x = new Date(d);
      x.setDate(d.getDate() + i);
      return x.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
    });
  }
  function registerRows(reg, withRegCols) {
    const p = periodById(reg.periodId);
    return attendeesOf(reg).map((a, i) => {
      const row = {};
      if (withRegCols) Object.assign(row, { "Attendance ID": reg.id, Boundary: reg.boundary, "Billing period": periodLabel(p), Status: reg.status === "approved" ? "Approved" : "Pending" });
      Object.assign(row, { "S.No": i + 1, Name: a.name, Role: a.role, "Mobile number": a.mobile });
      dayHeaders(p).forEach((h, k) => (row[h] = a.days[k]));
      row["Days present"] = a.days.filter((d) => d === "P").length;
      return row;
    });
  }
  const safe = (id) => id.replace(/\//g, "-");
  function saveBlob(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function download(mode) {
    const ids = [...state.selected[state.tab]];
    const regs = registers.filter((r) => ids.includes(r.id));
    if (!window.XLSX) { toast("Download needs an internet connection to load the Excel library.", { error: true }); return; }
    withLoader("Preparing your download…", async () => {
      if (regs.length === 1) {
        const r = regs[0];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(registerRows(r, false)), "Register");
        XLSX.writeFile(wb, `${safe(r.id)}.xlsx`);
      } else if (mode === "single") {
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(regs.flatMap((r) => registerRows(r, true))), "Registers");
        XLSX.writeFile(wb, `${CAMPAIGN}_${LGA}_${regs.length}-registers.xlsx`);
      } else {
        const zip = new JSZip();
        regs.forEach((r) => {
          const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(registerRows(r, false)), "Register");
          zip.file(`${safe(r.id)}.xlsx`, XLSX.write(wb, { type: "array", bookType: "xlsx" }));
        });
        saveBlob(await zip.generateAsync({ type: "blob" }), `${CAMPAIGN}_${LGA}_registers.zip`);
      }
      toast(regs.length === 1 ? "Register downloaded" : `${plural(regs.length, "register")} downloaded`);
    }, 900);
  }

  // ---------- Generate bill ----------
  $("#generateBtn").addEventListener("click", () => {
    const toBill = tabRows("approved").filter((r) => state.selected.approved.has(r.id));
    if (!toBill.length) return;
    const periods = [...new Set(toBill.map((r) => r.periodId))].map(periodById);
    const att = toBill.reduce((s, r) => s + r.attendees, 0);
    dialog({
      title: periods.length > 1 ? `Generate ${periods.length} bills?` : "Generate bill?",
      body: `<div class="summary">
          <div><span>Billing ${periods.length > 1 ? "periods" : "period"}</span><strong style="text-align:right">${periods.map(periodLabel).join("<br>")}</strong></div>
          <div><span>Approved registers</span><strong>${toBill.length}</strong></div>
          <div><span>Attendees</span><strong>${att}</strong></div>
        </div>
        ${periods.length > 1 ? `<p class="note">One bill is generated for each billing period. You can find them in My Bills.</p>` : `<p class="note">You can find the bill in My Bills.</p>`}`,
      actions: [
        { label: "Cancel" },
        {
          label: periods.length > 1 ? `Generate ${periods.length} bills` : "Generate Bill",
          kind: "primary",
          run: () => withLoader(periods.length > 1 ? "Generating bills…" : "Generating bill…", () => {
            const nums = periods.map((p) => {
              const no = `BILL/2026-27/${String(p.n).padStart(2, "0")}/${String(Math.floor(1000 + Math.random() * 9000))}`;
              const regs = toBill.filter((r) => r.periodId === p.id);
              regs.forEach((r) => { r.billNo = no; r.logs.push({ action: `Bill generated (${no})`, by: ME, at: new Date() }); });
              state.bills.push({ no, periodId: p.id, registerIds: regs.map((r) => r.id) });
              return [p, no, regs.length];
            });
            state.selected.approved.clear();
            // Drop fully billed periods from the filter; fall back to the next period that still has registers.
            const avail = availablePeriods().map((p) => p.id);
            const keep = state.appliedPeriods.filter((id) => avail.includes(id));
            state.draftPeriods = state.appliedPeriods = keep.length ? keep : avail.slice(0, 1);
            if (!state.appliedPeriods.length) state.appliedPeriods = [periods[0].id]; // everything billed: show the empty state
            render();
            dialog({
              tone: "success",
              icon: ICON.check,
              title: nums.length > 1 ? `${nums.length} bills generated` : "Bill generated",
              body: `<div class="summary">${nums.map(([p, no, n]) => `<div><span>${periodShort(p)} · ${plural(n, "register")}</span><strong>${no}</strong></div>`).join("")}</div>
                <p class="note">Billed registers are removed from the inbox. You can find the ${nums.length > 1 ? "bills" : "bill"} in My Bills.</p>`,
              actions: [{ label: "Go to My Bills", run: () => toast("My Bills opens here in the full product") }, { label: "Done", kind: "primary" }],
            });
          }, 1300),
        },
      ],
    });
  });

  // ---------- Drawers ----------
  function openDrawer(title, sub, html) {
    lastFocus = document.activeElement;
    $("#drawerTitle").textContent = title;
    $("#drawerSub").textContent = sub;
    $("#drawerBody").innerHTML = html;
    $("#drawerOverlay").hidden = false;
    $("#drawerClose").focus();
  }
  function closeDrawer() { $("#drawerOverlay").hidden = true; lastFocus?.focus?.(); }
  $("#drawerClose").addEventListener("click", closeDrawer);
  $("#drawerOverlay").addEventListener("click", (e) => { if (e.target.id === "drawerOverlay") closeDrawer(); });
  $("#dialogOverlay").addEventListener("click", (e) => { if (e.target.id === "dialogOverlay") closeDialog(); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("#dialogOverlay").hidden) closeDialog();
    else if (!$("#drawerOverlay").hidden) closeDrawer();
  });

  function openLogs(id) {
    const r = registers.find((x) => x.id === id);
    openDrawer("Logs", r.id, `<ol class="log">${[...r.logs].reverse().map((l) => `<li><strong>${esc(l.action)}</strong><small>${esc(l.by)} · ${fmtDT(l.at)}</small>${l.comment ? `<p>${esc(l.comment)}</p>` : ""}</li>`).join("")}</ol>`);
  }
  function openRegister(id) {
    const r = registers.find((x) => x.id === id);
    const p = periodById(r.periodId);
    const list = attendeesOf(r);
    openDrawer(r.id, `${r.boundary} · ${periodLabel(p)}`, `
      <div class="facts">
        <div><span>Status</span><span class="status ${r.status}">${r.status === "approved" ? "Approved" : "Pending approval"}</span></div>
        <div><span>Attendees</span><strong>${r.attendees}</strong></div>
        <div><span>${r.status === "approved" ? "Approved by" : "Submitted by"}</span><strong>${esc(r.status === "approved" ? r.approvedBy : r.submittedBy)}</strong></div>
        <div><span>Total days present</span><strong>${list.reduce((s, a) => s + a.days.filter((d) => d === "P").length, 0)}</strong></div>
      </div>
      <table><thead><tr><th>Name</th><th>Role</th><th class="num">Days present</th></tr></thead>
      <tbody>${list.map((a) => `<tr><td>${esc(a.name)}</td><td>${a.role}</td><td class="num">${a.days.filter((d) => d === "P").length} / 7</td></tr>`).join("")}</tbody></table>`);
  }

  $("#myBills").addEventListener("click", (e) => {
    e.preventDefault();
    const n = state.bills.length;
    toast(n ? `${plural(n, "bill")} in My Bills` : "No bills generated yet");
  });

  // Optional deep link for demos: #periods=p2,p3&tab=pending
  const hp = new URLSearchParams(location.hash.slice(1));
  const hashPeriods = (hp.get("periods") || "").split(",").filter((id) => periodById(id));
  if (hashPeriods.length) state.draftPeriods = state.appliedPeriods = hashPeriods;
  if (hp.get("tab") === "pending") state.tab = "pending";
  if (hp.get("selectall")) tabRows(state.tab).forEach((r) => state.selected[state.tab].add(r.id));

  render();
  if (hp.get("open")) openMs();
})();
