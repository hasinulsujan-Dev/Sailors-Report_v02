import csv
import io
import json
import os
import re
import urllib.parse
import urllib.request

from .config import CACHE_DIR, extract_spreadsheet_id

USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"


def _get(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


class SheetsError(Exception):
    pass


def list_tabs(spreadsheet_id):
    if not spreadsheet_id:
        raise SheetsError("No spreadsheet configured. Set the spreadsheet URL first.")
    preview_url = "https://docs.google.com/spreadsheets/d/{}/preview".format(spreadsheet_id)
    html = _get(preview_url)
    if "view-source" in html or len(html) < 2000:
        raise SheetsError("Spreadsheet is not publicly shared. Enable 'Anyone with the link -> Viewer'.")
    tabs = []
    pattern = re.compile(
        r'name:\s*"([^"]+)".*?gid:\s*"(\d+)"', re.DOTALL
    )
    for m in pattern.finditer(html):
        name, gid = m.group(1), m.group(2)
        if not any(t["gid"] == gid for t in tabs):
            tabs.append({"name": name, "gid": gid})
    if not tabs:
        raise SheetsError("Could not read the sheet's tabs. Check sharing settings.")
    return tabs


def fetch_tab_csv(spreadsheet_id, gid, timeout=60):
    url = "https://docs.google.com/spreadsheets/d/{}/export?format=csv&gid={}".format(
        spreadsheet_id, gid
    )
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
    text = raw.decode("utf-8", errors="replace")
    if text.lstrip().startswith("<!DOCTYPE") or "<html" in text[:500].lower():
        raise SheetsError("Tab could not be exported as CSV (gid={}).".format(gid))
    return text


def _cache_key(spreadsheet_id, gid):
    safe = re.sub(r"[^a-zA-Z0-9_-]", "_", spreadsheet_id)
    return os.path.join(CACHE_DIR, "{}_{}.csv".format(safe, gid))


def fetch_tab_rows(spreadsheet_id, gid, use_cache=True):
    cache_path = _cache_key(spreadsheet_id, gid)
    if use_cache and os.path.exists(cache_path):
        with open(cache_path, "r", encoding="utf-8") as f:
            text = f.read()
    else:
        text = fetch_tab_csv(spreadsheet_id, gid)
        os.makedirs(CACHE_DIR, exist_ok=True)
        with open(cache_path, "w", encoding="utf-8") as f:
            f.write(text)
    return list(csv.reader(io.StringIO(text)))


def clear_cache():
    for name in os.listdir(CACHE_DIR):
        os.remove(os.path.join(CACHE_DIR, name))