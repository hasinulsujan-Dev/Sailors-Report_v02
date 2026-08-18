import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_DIR = os.path.join(ROOT, "config")
DATA_DIR = os.path.join(ROOT, "data")
CACHE_DIR = os.path.join(DATA_DIR, "cache")

SETTINGS_FILE = os.path.join(CONFIG_DIR, "settings.json")
TABS_FILE = os.path.join(CONFIG_DIR, "tabs.json")

DEFAULT_SETTINGS = {
    "spreadsheet_url": "",
    "spreadsheet_id": "",
    "auto_refresh_minutes": 0,
}

REPORT_SECTIONS = [
    {"id": "attendance", "label": "Sailor's Report — Attendance"},
    {"id": "raw", "label": "Raw data (reference)"},
]


def ensure_dirs():
    for d in (CONFIG_DIR, DATA_DIR, CACHE_DIR):
        os.makedirs(d, exist_ok=True)


def load_json(path, default):
    ensure_dirs()
    if not os.path.exists(path):
        return json.loads(json.dumps(default))
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return json.loads(json.dumps(default))


def save_json(path, data):
    ensure_dirs()
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def load_settings():
    return load_json(SETTINGS_FILE, DEFAULT_SETTINGS)


def save_settings(settings):
    save_json(SETTINGS_FILE, settings)


def load_tabs():
    return load_json(TABS_FILE, {})


def save_tabs(tabs):
    save_json(TABS_FILE, tabs)


def extract_spreadsheet_id(url):
    if not url:
        return ""
    m = re.search(r"/spreadsheets/d/([a-zA-Z0-9-_]+)", url)
    if m:
        return m.group(1)
    m = re.search(r"^[a-zA-Z0-9-_]{20,}$", url.strip())
    if m:
        return url.strip()
    return ""