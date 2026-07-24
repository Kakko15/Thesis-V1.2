"""Live, read-only PI-04 catalog API verification for a disposable project."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from fastapi.testclient import TestClient

# Direct script execution places only ``scripts/`` on sys.path. Add the
# backend root explicitly so this verifier behaves identically from any cwd.
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from main import app


EXPECTED_PROGRAMS = {"BSCS", "BSIT", "BSDSA", "BSIS", "BLIS"}
EXPECTED_SPECIALIZATIONS = {"DM", "WMAD", "NETSEC"}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    with TestClient(app) as client:
        response = client.get("/catalog/departments")
    response.raise_for_status()
    payload = response.json()

    departments = payload.get("departments") or []
    ccsict = next((item for item in departments if item.get("code") == "CCSICT"), None)
    programs = (ccsict or {}).get("programs") or []
    program_codes = {item.get("code") for item in programs}
    specialization_codes = {
        specialization.get("code")
        for program in programs
        for specialization in (program.get("specializations") or [])
    }
    checks = {
        "http_status_200": response.status_code == 200,
        "contract_version": payload.get("contract_version") == "2026-07-25",
        "ccsict_present": ccsict is not None,
        "programs_exact": program_codes == EXPECTED_PROGRAMS,
        "specializations_exact": specialization_codes == EXPECTED_SPECIALIZATIONS,
    }
    report = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "profile": "pi-04-disposable-supabase-live-api",
        "privacy": {
            "credentials_preserved": False,
            "database_rows_preserved": False,
        },
        "observed": {
            "department_code": (ccsict or {}).get("code"),
            "program_codes": sorted(code for code in program_codes if code),
            "specialization_codes": sorted(code for code in specialization_codes if code),
        },
        "checks": checks,
        "result": "PASS" if all(checks.values()) else "FAIL",
    }
    Path(args.output).write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0 if report["result"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
