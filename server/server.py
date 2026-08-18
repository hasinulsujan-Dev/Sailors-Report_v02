import json
import mimetypes
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from . import report as report_mod
from . import sheets
from .config import (
    REPORT_SECTIONS,
    extract_spreadsheet_id,
    load_settings,
    load_tabs,
    save_settings,
    save_tabs,
)

WEB_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web")


def _json(handler, data, status=200):
    body = json.dumps(data, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(body)


def _error(handler, message, status=400):
    _json(handler, {"error": message}, status)


def _read_body(handler):
    length = int(handler.headers.get("Content-Length") or 0)
    if not length:
        return {}
    raw = handler.rfile.read(length).decode("utf-8")
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {}


def _current_tabs(settings, tabs_cfg):
    listed = sheets.list_tabs(settings["spreadsheet_id"])
    for t in listed:
        mapped = tabs_cfg.get(t["name"])
        t["mapped"] = bool(mapped)
        t["type"] = mapped.get("type", "") if mapped else ""
        t["month"] = mapped.get("month", "") if mapped else ""
        t["raw"] = "raw" in t["name"].lower()
    return listed


def _do_refresh(handler):
    sheets.clear_cache()
    settings = load_settings()
    tabs_cfg = load_tabs()
    try:
        tabs = _current_tabs(settings, tabs_cfg)
    except sheets.SheetsError as e:
        _error(handler, str(e))
        return
    for t in tabs:
        if tabs_cfg.get(t["name"]):
            sheets.fetch_tab_rows(settings["spreadsheet_id"], t["gid"], use_cache=False)
    _json(handler, {"ok": True, "tabs": tabs})


def handle_get(handler, parsed):
    path = parsed.path

    if path == "/api/status":
        settings = load_settings()
        tabs_cfg = load_tabs()
        try:
            tabs = _current_tabs(settings, tabs_cfg)
        except sheets.SheetsError as e:
            tabs = []
            sheet_error = str(e)
        else:
            sheet_error = ""
        _json(
            handler,
            {
                "spreadsheet_url": settings["spreadsheet_url"],
                "spreadsheet_id": settings["spreadsheet_id"],
                "configured": bool(settings["spreadsheet_id"]),
                "sheet_error": sheet_error,
                "tabs": tabs,
                "sections": REPORT_SECTIONS,
            },
        )
        return

    if path == "/api/report":
        params = parse_qs(parsed.query)
        tab_name = (params.get("tab") or [""])[0]
        settings = load_settings()
        tabs_cfg = load_tabs()
        mapping = tabs_cfg.get(tab_name)
        if not mapping:
            _error(handler, "Tab '{}' is not mapped. Map it first.".format(tab_name))
            return
        try:
            tabs = sheets.list_tabs(settings["spreadsheet_id"])
            gid = next((t["gid"] for t in tabs if t["name"] == tab_name), None)
            if gid is None:
                _error(handler, "Tab '{}' no longer exists in the spreadsheet.".format(tab_name))
                return
            rows = sheets.fetch_tab_rows(settings["spreadsheet_id"], gid)
            employees = report_mod.parse_attendance(rows)
            rep = report_mod.build_report(employees)
        except (sheets.SheetsError, report_mod.ReportError) as e:
            _error(handler, str(e))
            return
        rep["tab"] = tab_name
        rep["month"] = mapping.get("month", "")
        _json(handler, rep)
        return

    if path == "/api/rows":
        params = parse_qs(parsed.query)
        tab_name = (params.get("tab") or [""])[0]
        settings = load_settings()
        tabs_cfg = load_tabs()
        mapping = tabs_cfg.get(tab_name)
        if not mapping:
            _error(handler, "Tab '{}' is not mapped.".format(tab_name))
            return
        try:
            tabs = sheets.list_tabs(settings["spreadsheet_id"])
            gid = next((t["gid"] for t in tabs if t["name"] == tab_name), None)
            if gid is None:
                _error(handler, "Tab '{}' no longer exists.".format(tab_name))
                return
            rows = sheets.fetch_tab_rows(settings["spreadsheet_id"], gid)
            employees = report_mod.parse_attendance(rows)
            raw = report_mod.raw_rows(employees)
        except (sheets.SheetsError, report_mod.ReportError) as e:
            _error(handler, str(e))
            return
        _json(
            handler,
            {
                "tab": tab_name,
                "month": mapping.get("month", ""),
                "row_count": len(raw),
                "rows": raw,
            },
        )
        return

    if path == "/api/data":
        params = parse_qs(parsed.query)
        tab_name = (params.get("tab") or [""])[0]
        settings = load_settings()
        tabs_cfg = load_tabs()
        mapping = tabs_cfg.get(tab_name)
        if not mapping:
            _error(handler, "Tab '{}' is not mapped.".format(tab_name))
            return
        try:
            tabs = sheets.list_tabs(settings["spreadsheet_id"])
            gid = next((t["gid"] for t in tabs if t["name"] == tab_name), None)
            if gid is None:
                _error(handler, "Tab '{}' no longer exists.".format(tab_name))
                return
            rows = sheets.fetch_tab_rows(settings["spreadsheet_id"], gid)
            employees = report_mod.parse_attendance(rows)
        except (sheets.SheetsError, report_mod.ReportError) as e:
            _error(handler, str(e))
            return
        _json(handler, {"tab": tab_name, "employees": employees})
        return

    if path == "/api/refresh":
        _do_refresh(handler)
        return

    if path.startswith("/api/"):
        _error(handler, "Unknown endpoint.", 404)
        return

    serve_static(handler, path)


def handle_post(handler, parsed):
    if parsed.path == "/api/config":
        body = _read_body(handler)
        url = (body.get("spreadsheet_url") or "").strip()
        sid = extract_spreadsheet_id(url) or load_settings().get("spreadsheet_id", "")
        if not sid:
            _error(handler, "Could not read a spreadsheet id from that URL.")
            return
        settings = load_settings()
        settings["spreadsheet_url"] = url
        settings["spreadsheet_id"] = sid
        save_settings(settings)
        try:
            tabs = _current_tabs(settings, load_tabs())
        except sheets.SheetsError as e:
            _error(handler, str(e), 502)
            return
        _json(handler, {"ok": True, "spreadsheet_id": sid, "tabs": tabs})
        return

    if parsed.path == "/api/map":
        body = _read_body(handler)
        tab_name = (body.get("tab") or "").strip()
        section = (body.get("type") or "").strip()
        month = (body.get("month") or "").strip()
        if not tab_name or not section:
            _error(handler, "Both 'tab' and 'type' are required.")
            return
        tabs_cfg = load_tabs()
        tabs_cfg[tab_name] = {"type": section, "month": month}
        save_tabs(tabs_cfg)
        _json(handler, {"ok": True, "tab": tab_name, "type": section, "month": month})
        return

    if parsed.path == "/api/unmap":
        body = _read_body(handler)
        tab_name = (body.get("tab") or "").strip()
        tabs_cfg = load_tabs()
        if tab_name in tabs_cfg:
            del tabs_cfg[tab_name]
            save_tabs(tabs_cfg)
        _json(handler, {"ok": True, "tab": tab_name})
        return

    if parsed.path == "/api/refresh":
        _do_refresh(handler)
        return

    _error(handler, "Unknown endpoint.", 404)


def serve_static(handler, path):
    rel = urlparse(path).path.lstrip("/")
    if not rel:
        rel = "index.html"
    full = os.path.join(WEB_DIR, rel)
    if not os.path.abspath(full).startswith(os.path.abspath(WEB_DIR)):
        _error(handler, "Forbidden.", 403)
        return
    if not os.path.isfile(full):
        _error(handler, "Not found.", 404)
        return
    ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
    with open(full, "rb") as f:
        body = f.read()
    handler.send_response(200)
    handler.send_header("Content-Type", ctype)
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def do_GET(self):
        try:
            handle_get(self, urlparse(self.path))
        except sheets.SheetsError as e:
            _error(self, str(e), 502)
        except Exception as e:  # noqa: BLE001
            _error(self, "Internal error: {}".format(e), 500)

    def do_POST(self):
        try:
            handle_post(self, urlparse(self.path))
        except sheets.SheetsError as e:
            _error(self, str(e), 502)
        except Exception as e:  # noqa: BLE001
            _error(self, "Internal error: {}".format(e), 500)


def run(host="127.0.0.1", port=8787):
    server = ThreadingHTTPServer((host, port), Handler)
    print("PX Dashboard running at http://{}:{}".format(host, port))
    server.serve_forever()


if __name__ == "__main__":
    run()