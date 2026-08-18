const state = {
  status: null,
  currentTab: null,
  reportMonth: null,
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
  $("#reportSub").textContent = "Under revision — calculations will be added back.";
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
  const card = el("div", "card");
  const head = el("div", "card-head");
  head.appendChild(el("h3", "", "Attendance data pulled from Google Sheets"));
  head.appendChild(el("span", "meta", data.row_count + " rows · " + (data.month || "")));
  card.appendChild(head);
  const table = document.createElement("table");
  table.appendChild(theader(["Employee ID", "Name", "Perks", "Department/Team", "Date", "Weekdays", "Clock In", "Clock Out"]));
  const tbody = document.createElement("tbody");
  for (const r of data.rows) {
    const tr = el("tr");
    tr.appendChild(el("td", "", r.emp_id));
    tr.appendChild(el("td", "", r.name));
    tr.appendChild(el("td", "", r.perk));
    tr.appendChild(el("td", "", r.team));
    tr.appendChild(el("td", "", r.date));
    tr.appendChild(el("td", "", r.weekday));
    tr.appendChild(el("td", "", r.clock_in));
    tr.appendChild(el("td", "", r.clock_out));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  card.appendChild(table);
  body.appendChild(card);
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
  cols.forEach((c, i) => {
    const th = el("th", i > 0 ? "num" : "", c);
    tr.appendChild(th);
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