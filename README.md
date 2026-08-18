# PX Dashboard — Sailor's Report

A dashboard for the PX (People Experience) team. It pulls attendance data live from a
Google Sheet and generates the **Sailor's Report** per month.

- **Zero dependencies** — pure Python 3 standard library + plain HTML/CSS/JS frontend.
- **Live Google Sheets sync** — reads tabs straight from the shared spreadsheet.
- **New-tab detection** — when a new tab appears in the sheet, the dashboard asks you
  how to use it (e.g. assign it to a month), so nothing needs code changes.
- **Extensible** — the report engine is a small config of sections; more criteria
  (meal, dormitory, transport, leave mismatches, etc.) can be added as data sources arrive.

## Quick start

```bash
python3 run.py            # serves on http://127.0.0.1:8787
```

Open http://127.0.0.1:8787, paste the Google Sheets link, and click **Connect**.

### Requirements for the Google Sheet
The spreadsheet must be shared as **Anyone with the link → Viewer** (this is needed so the
dashboard can read the tabs without credentials).

## How it works

1. **Connect** — paste the spreadsheet URL. The server stores it in `config/settings.json`.
2. **Map tabs** — every tab in the sheet is listed. New/unmapped tabs show in a banner;
   assign a tab as *Sailor's Report — Attendance* and pick its month (`YYYY-MM`).
   Mappings are stored in `config/tabs.json`.
3. **View the report** — pick a month from the sidebar. The report computes these
   criteria (all for **onsite employees**):
   - Late Check-in Count (> 3)
   - Partial Attendance, < 8 hours (> 3)
   - Early Check Out (> 3)
   - Average Daily Office Hours (< 9)
   - Average Daily Office Hours (> 9)
4. **Refresh** — pulls the latest data from the sheet and re-checks for new tabs.
   Tab data is cached under `data/cache/`; refresh clears and re-downloads it.

## Structure

```
server/
  server.py    HTTP server + JSON API
  sheets.py    Google Sheets access (tab listing + CSV export)
  report.py    Sailor's Report computation engine
  config.py    config persistence (settings, tab mappings)
web/
  index.html   dashboard layout
  app.js       frontend logic (connect, map tabs, render report)
  styles.css
config/        settings.json + tabs.json (created on first run)
data/cache/    cached CSV snapshots per tab
```

## API

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/status` | GET | Spreadsheet config + tab list with mapping status |
| `/api/config` | POST | Set the spreadsheet URL |
| `/api/map` | POST | Assign a tab to a report section + month |
| `/api/unmap` | POST | Remove a tab mapping |
| `/api/report?tab=NAME` | GET | Computed Sailor's Report for a mapped tab |
| `/api/data?tab=NAME` | GET | Raw per-employee attendance summary |
| `/api/refresh` | GET/POST | Re-download tab data and detect new tabs |