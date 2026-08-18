from collections import OrderedDict


class ReportError(Exception):
    pass


def _norm(v):
    return str(v).strip().lower()


def _cell(row, idx):
    if idx is None or idx >= len(row):
        return ""
    return str(row[idx]).strip()


def _hours(text):
    text = str(text).replace(";", ":").strip()
    if not text:
        return 0.0
    parts = text.split(":")
    try:
        if len(parts) == 3:
            return int(parts[0]) + int(parts[1]) / 60.0 + int(parts[2]) / 3600.0
        if len(parts) == 2:
            return int(parts[0]) + int(parts[1]) / 60.0
        return float(text)
    except (ValueError, IndexError):
        return 0.0


def parse_attendance(rows):
    header_idx = None
    for i, r in enumerate(rows[:6]):
        cells = [_norm(c) for c in r]
        if any("employee id" in c or c == "employee" for c in cells) and any(
            c == "date" or "date" in c for c in cells
        ):
            header_idx = i
            break
    if header_idx is None:
        raise ReportError("Could not find the attendance header row in this tab.")

    header = rows[header_idx]
    col = {}
    for j, h in enumerate(header):
        key = _norm(h)
        if not key:
            break
        if "employee id" in key:
            col["emp_id"] = j
        elif key == "name":
            col["name"] = j
        elif "perk" in key:
            col["perk"] = j
        elif "department" in key or key == "team":
            col["team"] = j
        elif "date" in key:
            col["date"] = j
        elif "weekday" in key or "week" in key:
            col["weekday"] = j
        elif "status" in key:
            col["status"] = j
        elif "clock in" in key:
            col["clock_in"] = j
        elif "clock out" in key:
            col["clock_out"] = j
        elif "early" in key:
            col["early"] = j
        elif "work time" in key:
            col["work_time"] = j
        elif "below-8" in key:
            col["below8"] = j
        elif "avarage daily" in key or "average daily" in key:
            col["avg_daily"] = j
        elif "avarage hours" in key or "average hours" in key:
            col["avg_month"] = j

    required = ["emp_id", "date", "status"]
    missing = [k for k in required if k not in col]
    if missing:
        raise ReportError("Tab is missing required columns: {}".format(", ".join(missing)))

    employees = OrderedDict()
    for r in rows[header_idx + 1:]:
        emp_id = _cell(r, col.get("emp_id"))
        date = _cell(r, col.get("date"))
        if not emp_id or not date:
            continue
        emp = employees.setdefault(
            emp_id,
            {
                "id": emp_id,
                "name": _cell(r, col.get("name")),
                "perk": _cell(r, col.get("perk")),
                "team": _cell(r, col.get("team")),
                "days": [],
                "late": 0,
                "partial": 0,
                "early": 0,
                "worked_days": 0,
                "total_hours": 0.0,
                "avg_hours": 0.0,
            },
        )
        if _cell(r, col.get("name")):
            emp["name"] = _cell(r, col.get("name"))
        if _cell(r, col.get("perk")):
            emp["perk"] = _cell(r, col.get("perk"))
        if _cell(r, col.get("team")):
            emp["team"] = _cell(r, col.get("team"))

        status = _norm(_cell(r, col.get("status")))
        if status == "late":
            emp["late"] += 1
        attended = status != "absent"
        if attended and _norm(_cell(r, col.get("below8"))) == "below-8":
            emp["partial"] += 1
        if attended and _norm(_cell(r, col.get("early"))) == "yes":
            emp["early"] += 1
        if attended:
            emp["worked_days"] += 1
            wh = _hours(_cell(r, col.get("work_time")))
            emp["total_hours"] += wh
        emp["days"].append(
            {
                "date": date,
                "weekday": _cell(r, col.get("weekday")) if "weekday" in col else "",
                "status": status,
                "clock_in": _cell(r, col.get("clock_in")) if "clock_in" in col else "",
                "clock_out": _cell(r, col.get("clock_out")) if "clock_out" in col else "",
                "work_hours": round(_hours(_cell(r, col.get("work_time"))), 2),
            }
        )

    for emp in employees.values():
        if emp["worked_days"]:
            emp["avg_hours"] = round(emp["total_hours"] / emp["worked_days"], 2)
    return list(employees.values())


def raw_rows(employees):
    rows = []
    for emp in employees:
        for d in emp["days"]:
            rows.append(
                {
                    "emp_id": emp["id"],
                    "name": emp["name"],
                    "perk": emp["perk"],
                    "team": emp["team"],
                    "date": d["date"],
                    "weekday": d["weekday"],
                    "clock_in": d["clock_in"],
                    "clock_out": d["clock_out"],
                    "status": _attendance_status(d["clock_in"], d["clock_out"]),
                    "late_hrs": _late_hours(d["clock_in"]),
                    "work_hrs": _work_hours(d["clock_in"], d["clock_out"]),
                    "below_8": _duration_flag(d["clock_in"], d["clock_out"], 8),
                    "below_9": _duration_flag(d["clock_in"], d["clock_out"], 9),
                    "above_9": _duration_flag(d["clock_in"], d["clock_out"], 9, above=True),
                }
            )
    return rows


def _to_minutes(text):
    text = (text or "").strip()
    if not text:
        return None
    try:
        parts = text.split(":")
        return int(parts[0]) * 60 + int(parts[1])
    except (ValueError, IndexError):
        return None


def _work_minutes(clock_in, clock_out):
    ci = _to_minutes(clock_in)
    co = _to_minutes(clock_out)
    if ci is None or co is None:
        return None
    if co < ci:
        co += 24 * 60
    return co - ci


def _duration_flag(clock_in, clock_out, hours, above=False):
    mins = _work_minutes(clock_in, clock_out)
    if mins is None:
        return ""
    limit = hours * 60
    if above:
        return "Yes" if mins > limit else "No"
    return "Yes" if mins < limit else "No"


def _late_hours(clock_in):
    minutes = _to_minutes(clock_in)
    if minutes is None:
        return ""
    if minutes <= 600:
        return "0:00"
    diff = minutes - 600
    h, m = divmod(diff, 60)
    return "{}:{:02d}".format(h, m)


def _work_hours(clock_in, clock_out):
    diff = _work_minutes(clock_in, clock_out)
    if diff is None:
        return ""
    h, m = divmod(diff, 60)
    return "{}:{:02d}".format(h, m)


def _attendance_status(clock_in, clock_out):
    ci = (clock_in or "").strip()
    co = (clock_out or "").strip()
    if not ci or not co:
        return "Absent"
    try:
        parts = ci.split(":")
        minutes = int(parts[0]) * 60 + int(parts[1])
    except (ValueError, IndexError):
        return "Absent"
    return "Late" if minutes > 600 else "On Time"


def build_overview_matrix(month_counts):
    months = sorted(month_counts.keys(), reverse=True)
    criteria = []
    for c in PRD_CRITERIA:
        entry = {
            "n": c["n"],
            "id": c["id"],
            "title": c["title"],
            "rule": c["rule"],
            "scope": c["scope"],
            "computable": c["computable"],
            "source": c["source"],
            "counts": {},
        }
        for m in months:
            if c["computable"]:
                entry["counts"][m] = month_counts[m].get(c["section"], 0)
            else:
                entry["counts"][m] = None
        criteria.append(entry)
    return {"months": months, "criteria": criteria}


def _is_onsite(emp):
    team = emp["team"].lower()
    perk = emp["perk"].lower()
    if "remote" in team or team == "":
        return False
    if perk == "remote":
        return False
    return True


PRD_CRITERIA = [
    {"n": 1, "id": "meal", "title": "Enjoyed Late / Unrequested Meal", "rule": "> 3 times", "scope": "", "computable": False, "section": None, "source": "Meal sheet — not linked yet"},
    {"n": 2, "id": "double_lunch", "title": "Double lunch booking (bKash & Exabyting)", "rule": "", "scope": "", "computable": False, "section": None, "source": "Lunch sheet — not linked yet"},
    {"n": 3, "id": "late_checkin", "title": "Late Check-in Count", "rule": "> 3 times", "scope": "Onsite only", "computable": True, "section": "late_checkin", "source": "Attendance sheet"},
    {"n": 4, "id": "partial_attendance", "title": "Partial Attendance Count", "rule": "> 3 times, < 8 hours", "scope": "Onsite only", "computable": True, "section": "partial_attendance", "source": "Attendance sheet"},
    {"n": 5, "id": "early_checkout", "title": "Early Check Out", "rule": "> 3 times", "scope": "Onsite only", "computable": True, "section": "early_checkout", "source": "Attendance sheet"},
    {"n": 6, "id": "avg_hours_below_9", "title": "Average Daily Office Hours", "rule": "< 9 hours", "scope": "Onsite only", "computable": True, "section": "avg_hours_below_9", "source": "Attendance sheet"},
    {"n": 7, "id": "avg_hours_above_9", "title": "Average Daily Office Hours", "rule": "> 9 hours", "scope": "Onsite only", "computable": True, "section": "avg_hours_above_9", "source": "Attendance sheet"},
    {"n": 8, "id": "home_office", "title": "Home Office Count", "rule": "> 2 times", "scope": "Onsite only", "computable": False, "section": None, "source": "Not linked yet"},
    {"n": 9, "id": "transport_allowance", "title": "Transport allowance misuse", "rule": "", "scope": "", "computable": False, "section": None, "source": "Transport sheet — not linked yet"},
    {"n": 10, "id": "dormitory", "title": "Dormitory low utilization", "rule": "< 80%", "scope": "", "computable": False, "section": None, "source": "Dormitory sheet — not linked yet"},
    {"n": 11, "id": "exanest_misuse", "title": "ExaNest Misuse", "rule": "", "scope": "", "computable": False, "section": None, "source": "Not linked yet"},
    {"n": 12, "id": "transport_utilization", "title": "Transport Utilization", "rule": "< 80% only", "scope": "", "computable": False, "section": None, "source": "Transport sheet — not linked yet"},
    {"n": 13, "id": "non_cooperative", "title": "Non-Cooperative Behaviour", "rule": "", "scope": "", "computable": False, "section": None, "source": "Not linked yet"},
    {"n": 14, "id": "leave_fingerprint", "title": "Leave Count mismatch (Aladin vs fingerprint device)", "rule": "Count", "scope": "Non bKash", "computable": False, "section": None, "source": "Leave sheet — not linked yet"},
    {"n": 15, "id": "leave_bkash", "title": "Leave Count mismatch (Aladin vs bKash Timecard)", "rule": "Count", "scope": "bKash only", "computable": False, "section": None, "source": "Leave sheet — not linked yet"},
    {"n": 16, "id": "extra_working_days", "title": "Extra Working Days Count", "rule": "> 2 / Month", "scope": "", "computable": False, "section": None, "source": "Not linked yet"},
    {"n": 17, "id": "recharge", "title": "Recharge misuse", "rule": "", "scope": "", "computable": False, "section": None, "source": "Not linked yet"},
]


def build_report(employees):
    onsite = [e for e in employees if _is_onsite(e)]
    sections = [
        {
            "id": "late_checkin",
            "title": "Late Check-in Count (> 3 times)",
            "scope": "Onsite employees",
            "threshold": "> 3",
            "rows": [
                {"id": e["id"], "name": e["name"], "team": e["team"], "value": e["late"]}
                for e in onsite
                if e["late"] > 3
            ],
        },
        {
            "id": "partial_attendance",
            "title": "Partial Attendance (< 8 hours) (> 3 times)",
            "scope": "Onsite employees",
            "threshold": "> 3",
            "rows": [
                {"id": e["id"], "name": e["name"], "team": e["team"], "value": e["partial"]}
                for e in onsite
                if e["partial"] > 3
            ],
        },
        {
            "id": "early_checkout",
            "title": "Early Check Out (> 3 times)",
            "scope": "Onsite employees",
            "threshold": "> 3",
            "rows": [
                {"id": e["id"], "name": e["name"], "team": e["team"], "value": e["early"]}
                for e in onsite
                if e["early"] > 3
            ],
        },
        {
            "id": "avg_hours_below_9",
            "title": "Average Daily Office Hours (< 9 hours)",
            "scope": "Onsite employees",
            "threshold": "< 9",
            "rows": [
                {"id": e["id"], "name": e["name"], "team": e["team"], "value": e["avg_hours"]}
                for e in onsite
                if 0 < e["avg_hours"] < 9
            ],
        },
        {
            "id": "avg_hours_above_9",
            "title": "Average Daily Office Hours (> 9 hours)",
            "scope": "Onsite employees",
            "threshold": "> 9",
            "rows": [
                {"id": e["id"], "name": e["name"], "team": e["team"], "value": e["avg_hours"]}
                for e in onsite
                if e["avg_hours"] > 9
            ],
        },
    ]
    counts = {s["id"]: len(s["rows"]) for s in sections}
    overview = []
    for c in PRD_CRITERIA:
        entry = {
            "n": c["n"],
            "id": c["id"],
            "title": c["title"],
            "rule": c["rule"],
            "scope": c["scope"],
            "computable": c["computable"],
            "source": c["source"],
            "status": "computed" if c["computable"] else "awaiting-data",
        }
        if c["computable"]:
            entry["count"] = counts.get(c["section"], 0)
        else:
            entry["count"] = None
        overview.append(entry)
    return {
        "total_employees": len(employees),
        "onsite_employees": len(onsite),
        "sections": sections,
        "overview": overview,
    }