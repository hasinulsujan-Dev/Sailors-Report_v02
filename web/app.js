const state = {
  status: null,
  currentTab: null,
  reportMonth: null,
  overviewMonths: [],
  view: "report",
};

const $ = (sel) => document.querySelector(sel);

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function toast(msg) {
  let t = $(".toast");
  if (!t) {
    t = document.createElement("div");
    t.className = "toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove("show"), 2600);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

async function loadStatus() {
  state.status = await api("/api/status");
  renderSidebar();
  renderConfig();
  renderNewTabsBanner();
  if (!state.status.configured) {
    switchView("config");
    return;
  }
  const mapped = mappedAttendanceTabs();
  if (!state.currentTab || !mapped.find((t) => t.name === state.currentTab)) {
    state.currentTab = mapped[0] ? mapped[0].name : null;
  }
  if (state.currentTab) {
    selectTab(state.currentTab);
  } else {
    renderView();
  }
}

function mappedAttendanceTabs() {
  return (state.status.tabs || []).filter((t) => t.mapped && t.type === "attendance");
}

function mappedAttendanceMonths() {
  return mappedAttendanceTabs()
    .filter((t) => t.month)
    .sort((a, b) => b.month.localeCompare(a.month));
}

function renderSidebar() {
  const list = $("#tabList");
  list.innerHTML = "";
  const tabs = state.status.tabs || [];
  if (!tabs.length) {
    list.appendChild(el("li", "", "No tabs found."));
    return;
  }
  for (const t of tabs) {
    if (t.raw || !t.name.endsWith("Attendance 2026")) continue;
    const li = el("li");
    li.dataset.tab = t.name;
    if (t.mapped) {
      li.title = t.month || "Mapped";
      li.appendChild(el("span", "", t.name));
      li.appendChild(el("span", "badge badge-mapped", t.month ? t.month : "MAP"));
      li.addEventListener("click", () => selectTab(t.name));
    } else {
      li.classList.add("unmapped");
      li.appendChild(el("span", "", t.name));
      li.appendChild(el("span", "badge badge-new", "NEW"));
    }
    if (t.name === state.currentTab) li.classList.add("selected");
    list.appendChild(li);
  }
}

function renderConfig() {
  const st = state.status;
  $("#configView").classList.toggle("hidden", st.configured);
  if (st.configured) {
    $("#sheetUrl").value = st.spreadsheet_url;
  }
  const stat = $("#sheetStatus");
  if (st.configured) {
    stat.innerHTML = "<b>Connected</b><br>" + (st.spreadsheet_id || "");
    if (st.sheet_error) {
      stat.innerHTML += "<br><span style='color:#ffb4b4'>" + escapeHtml(st.sheet_error) + "</span>";
    }
  } else {
    stat.textContent = "Not connected";
  }
}

function renderNewTabsBanner() {
  const banner = $("#newTabsBanner");
  banner.innerHTML = "";
  const st = state.status;
  if (!st.configured) {
    banner.classList.add("hidden");
    return;
  }
  const newTabs = (st.tabs || []).filter((t) => !t.mapped && !t.raw);
  if (!newTabs.length) {
    banner.classList.add("hidden");
    return;
  }
  banner.classList.remove("hidden");
  banner.appendChild(el("h3", "", "New tabs detected in the spreadsheet"));
  banner.appendChild(
    el("p", "", "A tab appeared that has not been assigned yet. Tell me how to use it:")
  );
  for (const t of newTabs) {
    const row = el("div", "map-row");
    row.appendChild(el("span", "tab-name", t.name));
    const typeSel = document.createElement("select");
    for (const s of st.sections) {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.label;
      typeSel.appendChild(opt);
    }
    const monthInput = document.createElement("input");
    monthInput.type = "month";
    monthInput.value = "";
    monthInput.placeholder = "YYYY-MM";
    const mapBtn = el("button", "btn btn-sm btn-primary", "Map it");
    mapBtn.addEventListener("click", async () => {
      try {
        await api("/api/map", {
          method: "POST",
          body: JSON.stringify({ tab: t.name, type: typeSel.value, month: monthInput.value }),
        });
        toast("Mapped " + t.name);
        await loadStatus();
      } catch (e) {
        toast(e.message);
      }
    });
    row.appendChild(typeSel);
    row.appendChild(monthInput);
    row.appendChild(mapBtn);
    banner.appendChild(row);
  }
}

async function selectTab(name) {
  state.currentTab = name;
  const tab = (state.status.tabs || []).find((t) => t.name === name);
  if (state.view === "report" && tab && tab.month) {
    state.reportMonth = tab.month;
  }
  renderSidebar();
  renderView();
}

function switchView(name) {
  state.view = name;
  document.querySelectorAll(".nav-item").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === name);
  });
  ["config", "report", "data"].forEach((v) => {
    $("#" + v + "View").classList.toggle("hidden", v !== name);
  });
  if (name !== "config") renderView();
}

async function renderView() {
  const st = state.status;
  if (!st.configured) return;
  if (state.view === "report") {
    await renderReportView();
  } else if (state.view === "data") {
    await renderDataView();
  }
}

async function renderReportView() {
  $("#reportSub").textContent = "Overview across months · latest month shown by default";
  const ovWrap = $("#overviewWrap");
  ovWrap.innerHTML = '<div class="spin"></div>';
  try {
    const ov = await api("/api/overview");
    state.overviewMonths = ov.months;
    renderOverviewTable(ov);
    renderMonthTabs(ov.months);
    const month = (state.reportMonth && ov.months.includes(state.reportMonth)) ? state.reportMonth : ov.months[0];
    state.reportMonth = month;
    renderMonthDetail(month);
  } catch (e) {
    ovWrap.innerHTML = '<div class="empty">' + escapeHtml(e.message) + "</div>";
    $("#monthTabs").innerHTML = "";
    $("#reportBody").innerHTML = "";
  }
}

function renderOverviewTable(ov) {
  const wrap = $("#overviewWrap");
  wrap.innerHTML = "";
  const card = el("div", "card");
  const head = el("div", "card-head");
  head.appendChild(el("h3", "", "Sailor's Report — Overview (criteria × month)"));
  head.appendChild(el("span", "meta", "Count of flagged employees per criterion"));
  card.appendChild(head);

  const cols = ["#", "Criterion", "Rule", "Scope"];
  ov.months.forEach((m) => cols.push({ label: m, num: true }));
  const table = document.createElement("table");
  table.appendChild(theader(cols));
  const tbody = document.createElement("tbody");
  for (const c of ov.criteria) {
    const tr = el("tr");
    tr.appendChild(el("td", "num", String(c.n)));
    tr.appendChild(el("td", "", c.title));
    tr.appendChild(el("td", "", c.rule));
    tr.appendChild(el("td", "", c.scope));
    for (const m of ov.months) {
      const val = c.counts[m];
      if (val === null) {
        tr.appendChild(el("td", "num st-absent", "—"));
      } else if (m === ov.months[0]) {
        tr.appendChild(el("td", "num " + (val > 0 ? "flag-danger" : ""), String(val)));
      } else {
        tr.appendChild(el("td", "num", String(val)));
      }
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  card.appendChild(table);
  wrap.appendChild(card);
}

function renderMonthTabs(months) {
  const wrap = $("#monthTabs");
  wrap.innerHTML = "";
  for (const m of months) {
    const btn = el("button", "month-tab" + (m === state.reportMonth ? " active" : ""), m);
    btn.addEventListener("click", () => selectMonth(m));
    wrap.appendChild(btn);
  }
}

function selectMonth(month) {
  state.reportMonth = month;
  renderMonthTabs(mappedMonthsFromOverview());
  renderMonthDetail(month);
}

function mappedMonthsFromOverview() {
  return (state.overviewMonths || []);
}

async function renderMonthDetail(month) {
  const body = $("#reportBody");
  const st = state.status;
  const tab = (st.tabs || []).find((t) => t.mapped && t.type === "attendance" && t.month === month);
  body.innerHTML = '<div class="spin"></div>';
  if (!tab) {
    body.innerHTML = '<div class="empty">No attendance tab mapped for ' + month + '.</div>';
    return;
  }
  try {
    const rep = await api("/api/report?tab=" + encodeURIComponent(tab.name));
    renderReportDetail(rep);
  } catch (e) {
    body.innerHTML = '<div class="empty">' + escapeHtml(e.message) + "</div>";
  }
}

function renderReportDetail(rep) {
  const body = $("#reportBody");
  body.innerHTML = "";
  const title = el("div", "month-data-title", "Month detail — " + (rep.month || ""));
  body.appendChild(title);

  const sectionsById = {};
  for (const s of rep.sections) sectionsById[s.id] = s;

  for (const c of rep.overview) {
    const card = el("div", "card");
    const head = el("div", "card-head");
    head.appendChild(el("h3", "", c.n + ". " + c.title));
    head.appendChild(el("span", "meta", [c.rule, c.scope].filter(Boolean).join(" · ")));
    card.appendChild(head);
    if (c.computable) {
      const s = sectionsById[c.id];
      if (!s || !s.rows.length) {
        card.appendChild(el("div", "no-rows", "No one flagged. All clear."));
      } else {
        const table = document.createElement("table");
        table.appendChild(theader(["#", "Employee", "ID", "Team", "Value"]));
        const tbody = document.createElement("tbody");
        s.rows.forEach((r, i) => {
          const tr = el("tr");
          tr.appendChild(el("td", "num", String(i + 1)));
          tr.appendChild(el("td", "", r.name));
          tr.appendChild(el("td", "", r.id));
          tr.appendChild(el("td", "", r.team));
          tr.appendChild(el("td", "num flag-danger", String(r.value)));
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        card.appendChild(table);
      }
    } else {
      card.appendChild(el("div", "no-rows awaiting", "Awaiting data — " + c.source));
    }
    body.appendChild(card);
  }
}

async function renderDataView() {
  const st = state.status;
  const name = state.currentTab;
  const dataBody = $("#dataBody");
  if (!name) {
    dataBody.innerHTML = '<div class="empty">Select a month from the sidebar.</div>';
    return;
  }
  const tab = (st.tabs || []).find((t) => t.name === name);
  if (!tab || !tab.mapped) {
    dataBody.innerHTML = '<div class="empty">This tab is not mapped.</div>';
    return;
  }
  $("#dataSub").textContent = tab.month || "Month not set";
  dataBody.innerHTML = '<div class="spin"></div>';
  try {
    const data = await api("/api/rows?tab=" + encodeURIComponent(name));
    renderRawRows(data);
  } catch (e) {
    dataBody.innerHTML = '<div class="empty">' + escapeHtml(e.message) + "</div>";
  }
}

function renderRawRows(data) {
  const body = $("#dataBody");
  body.innerHTML = "";

  const teamOrder = ["Exabyting Office", "Exabyting Remote", "bKash"];
  const groups = {};
  for (const r of data.rows) {
    if (!teamOrder.includes(r.team)) continue;
    if (!groups[r.team]) groups[r.team] = [];
    groups[r.team].push(r);
  }

  for (const team of teamOrder) {
    const members = groups[team] || [];
    const card = el("div", "card");
    const head = el("div", "card-head card-head-toggle");
    const chevron = el("span", "chevron", "▸");
    head.appendChild(chevron);
    head.appendChild(el("h3", "", team));
    head.appendChild(el("span", "meta", members.length + " rows · click to expand"));
    head.addEventListener("click", () => toggleCard(card));
    card.appendChild(head);

    const wrap = el("div", "collapsible");
    wrap.style.display = "none";
    const table = document.createElement("table");
    table.appendChild(theader([
      "Employee ID", "Name", "Perks", "Department/Team", "Date", "Weekdays",
      { label: "Clock In", num: true },
      { label: "Clock Out", num: true },
      "Status",
      { label: "Late for Hrs.", num: true },
      { label: "Work Time per day", num: true },
      "Below 8 Hrs", "Below 9 Hrs", "Above 9 Hrs",
    ]));
    const tbody = document.createElement("tbody");
    for (const r of members) {
      const tr = el("tr");
      tr.appendChild(el("td", "", r.emp_id));
      tr.appendChild(el("td", "", r.name));
      tr.appendChild(el("td", "", r.perk));
      tr.appendChild(el("td", "", r.team));
      tr.appendChild(el("td", "", r.date));
      tr.appendChild(el("td", "", r.weekday));
      tr.appendChild(el("td", "num", r.clock_in));
      tr.appendChild(el("td", "num", r.clock_out));
      tr.appendChild(el("td", "status " + statusClass(r.status), r.status));
      tr.appendChild(el("td", "num" + (r.late_hrs && r.late_hrs !== "0:00" ? " flag-danger" : ""), r.late_hrs ? r.late_hrs + " hrs" : ""));
      tr.appendChild(el("td", "num" + (r.work_hrs ? "" : " st-absent"), r.work_hrs ? r.work_hrs + " hrs" : ""));
      tr.appendChild(el("td", flagClass(r.below_8), r.below_8 || ""));
      tr.appendChild(el("td", flagClass(r.below_9), r.below_9 || ""));
      tr.appendChild(el("td", flagClass(r.above_9), r.above_9 || ""));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    card.appendChild(wrap);
    body.appendChild(card);
  }
}

function flagClass(flag) {
  if (flag === "Yes") return "flag-danger";
  if (flag === "No") return "flag-ok";
  return "st-absent";
}

function statusClass(status) {
  if (status === "Late") return "st-late";
  if (status === "On Time") return "st-ok";
  return "st-absent";
}

function toggleCard(card) {
  const wrap = card.querySelector(".collapsible");
  const chevron = card.querySelector(".chevron");
  const open = wrap.style.display !== "none";
  wrap.style.display = open ? "none" : "";
  chevron.textContent = open ? "▸" : "▾";
}
  function renderTeamData(container, employees) {
  container.innerHTML = "";

  const teamOrder = ["bKash", "Exabyting Office", "Exabyting Remote"];
  const perkOrder = ["Public Transport", "Exavehicle", "Exanest", "Exanest A4", "Exanest A7", "Remote"];
  const rank = (list, v) => {
    const i = list.indexOf(v);
    return i < 0 ? 99 + (v || "").length : i;
  };

  const sorted = employees.slice().sort((a, b) => {
    const ta = rank(teamOrder, a.team);
    const tb = rank(teamOrder, b.team);
    if (ta !== tb) return ta - tb;
    const pa = rank(perkOrder, a.perk);
    const pb = rank(perkOrder, b.perk);
    if (pa !== pb) return pa - pb;
    return (a.name || "").localeCompare(b.name || "");
  });

  const groups = {};
  for (const e of sorted) {
    const team = e.team || "Other";
    if (!groups[team]) groups[team] = [];
    groups[team].push(e);
  }

  const teams = Object.keys(groups).sort((a, b) => rank(teamOrder, a) - rank(teamOrder, b));

  for (const team of teams) {
    const members = groups[team];
    const card = el("div", "card");
    const head = el("div", "card-head");
    head.appendChild(el("h3", "", team + " (" + members.length + ")"));
    card.appendChild(head);

    const table = document.createElement("table");
    table.appendChild(theader(["Employee", "ID", "Perk", "Days worked", "Late", "Partial (<8h)", "Early out", "Avg hours"]));
    const tbody = document.createElement("tbody");
    for (const e of members) {
      const tr = el("tr");
      tr.appendChild(el("td", "", e.name));
      tr.appendChild(el("td", "", e.id));
      tr.appendChild(el("td", "", e.perk || "—"));
      tr.appendChild(el("td", "num", String(e.worked_days)));
      tr.appendChild(el("td", "num " + (e.late > 3 ? "flag-danger" : ""), String(e.late)));
      tr.appendChild(el("td", "num " + (e.partial > 3 ? "flag-danger" : ""), String(e.partial)));
      tr.appendChild(el("td", "num " + (e.early > 3 ? "flag-danger" : ""), String(e.early)));
      tr.appendChild(el("td", "num", e.avg_hours ? String(e.avg_hours) : ""));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    card.appendChild(table);
    container.appendChild(card);
  }
}

function theader(cols) {
  const thead = document.createElement("thead");
  const tr = el("tr");
  cols.forEach((c) => {
    const label = typeof c === "string" ? c : c.label;
    const cls = typeof c === "string" ? "" : (c.num ? "num" : "");
    tr.appendChild(el("th", cls, label));
  });
  thead.appendChild(tr);
  return thead;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

document.querySelectorAll(".nav-item").forEach((b) => {
  b.addEventListener("click", () => switchView(b.dataset.view));
});

$("#connectBtn").addEventListener("click", async () => {
  const url = $("#sheetUrl").value.trim();
  const msg = $("#configMsg");
  msg.className = "msg";
  msg.textContent = "Connecting...";
  try {
    const r = await api("/api/config", {
      method: "POST",
      body: JSON.stringify({ spreadsheet_url: url }),
    });
    msg.className = "msg ok";
    msg.textContent = "Connected. Found " + r.tabs.length + " tab(s).";
    await loadStatus();
  } catch (e) {
    msg.className = "msg err";
    msg.textContent = e.message;
  }
});

$("#refreshBtn").addEventListener("click", async () => {
  const btn = $("#refreshBtn");
  btn.disabled = true;
  btn.textContent = "Pulling...";
  try {
    await api("/api/refresh", { method: "POST" });
    await loadStatus();
    toast("Data refreshed from Google Sheets");
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Refresh";
  }
});

loadStatus().catch((e) => toast(e.message));