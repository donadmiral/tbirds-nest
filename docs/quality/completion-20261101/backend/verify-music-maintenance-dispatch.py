#!/usr/bin/env python3
"""Strict read-only evidence check for the one-use maintenance installation."""
import argparse
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]


def exact(actual, expected):
    if type(actual) is not type(expected):
        return False
    if isinstance(expected, dict):
        return actual.keys() == expected.keys() and all(exact(actual[k], v) for k, v in expected.items())
    if isinstance(expected, list):
        return len(actual) == len(expected) and all(exact(a, b) for a, b in zip(actual, expected))
    return actual == expected


def journal_matches(rows, units):
    return isinstance(rows, list) and len(rows) == len(units) and all(
        len(matches := [r for r in rows if r.get("name") == u["migrationName"]]) == 1
        and exact(matches[0].get("statementCount"), 1)
        and exact(matches[0].get("queryBytes"), u["sourceBytes"])
        and matches[0].get("querySha256") == u["sourceSha256"]
        for u in units
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("observation", type=Path)
    parser.add_argument("--phase", choices=("preflight", "postflight"), required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    package = json.loads((HERE / "music-maintenance-dispatch-expected.json").read_text())
    raw = json.loads(args.observation.read_text())
    observed = raw.get("observation", raw)
    expected, unit = package[args.phase], package["source"]
    request = json.loads((HERE / "music-maintenance-dispatch-request.json").read_text())
    sql = (ROOT / unit["sourcePath"]).read_bytes()
    checks = {
        "exactSourceRequest": request == {"project_id": package["projectRef"], "name": unit["migrationName"], "query": sql.decode()}
        and len(sql) == unit["sourceBytes"] and hashlib.sha256(sql).hexdigest() == unit["sourceSha256"],
        "readOnly": observed.get("readOnly") is True,
        "executor": observed.get("executor") == "postgres",
        "phaseAndStage": observed.get("phase") == args.phase and exact(observed.get("packageStage"), expected["stage"]),
        "musicSchemaPresent": observed.get("musicSchemaPresent") is True,
    }
    wanted = {(r["k"], r["n"]): r["md5"] for r in expected["catalog"]}
    rows = observed.get("catalog", [])
    actual = {(r["k"], r["n"]): r["md5"] for r in rows}
    missing, extra = sorted(wanted.keys() - actual.keys()), sorted(actual.keys() - wanted.keys())
    different = sorted(k for k in wanted.keys() & actual.keys() if wanted[k] != actual[k])
    checks["exactSourceCatalog"] = not missing and not extra and not different and len(actual) == len(rows)
    for key in ("musicPrivateTableAccess", "musicPrivateFunctionAccess", "musicPrivateSchemaAccess", "musicTablesWithoutRls", "otherActiveOrOpenClientTransactions", "preparedTransactions"):
        checks[key] = exact(observed.get(key), 0)
    checks["exactInitialTableCounts"] = exact(observed.get("musicTableCounts"), expected["tableCounts"])
    checks["readinessDisabled"] = exact(observed.get("readiness"), expected["readiness"])
    checks["privateAudioBucket"] = exact(observed.get("audioBucket"), package["expectedAudioBucket"])
    checks["dispatchPresence"] = observed.get("maintenanceDispatchPresent") is expected["dispatchPresent"] and observed.get("maintenanceRunsPresent") is expected["runsPresent"]
    checks["dispatchUnconfigured"] = exact(observed.get("maintenanceDispatchConfiguration"), expected["dispatchConfiguration"])
    checks["providerQueueApiAvailable"] = observed.get("netHttpPostAvailable") is True and observed.get("netHttpPostExecutable") is True
    business = package["prerequisiteBusinessSource"]
    checks["exactBusinessJournal"] = journal_matches(observed.get("stage8Journal"), [{"migrationName": business["migrationName"], "sourceBytes": business["bytes"], "sourceSha256": business["sha256"]}])
    checks["exactStoryJournal"] = journal_matches(observed.get("storyPrerequisiteJournal"), [package["prerequisiteStorySource"]])
    checks["exactMusicJournal"] = journal_matches(observed.get("musicJournal"), package["allMigrationSources"])
    checks["maintenanceJournal"] = journal_matches(observed.get("maintenanceJournal"), [unit] if args.phase == "postflight" else [])
    for original in package["allMigrationSources"]:
        p = HERE / "music-migration-requests" / f"{original['order']:02d}_{original['migrationName']}.json"
        r = json.loads(p.read_text())
        query = r["query"].encode()
        checks[f"originalMusicSource{original['order']}Unchanged"] = r["project_id"] == package["projectRef"] and r["name"] == original["migrationName"] and len(query) == original["sourceBytes"] and hashlib.sha256(query).hexdigest() == original["sourceSha256"]
    result = {
        "formatVersion": 1, "projectRef": package["projectRef"], "phase": args.phase,
        "sourceSha256": unit["sourceSha256"], "sourceBytes": unit["sourceBytes"],
        "observedAt": observed.get("observedAt"), "observationPath": str(args.observation),
        "checks": checks, "allChecksPassed": all(checks.values()),
        "catalog": {"expectedRows": len(wanted), "observedRows": len(rows), "missing": missing, "extra": extra, "different": different},
        "scope": package["scope"],
    }
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"allChecksPassed": result["allChecksPassed"], "failedChecks": [k for k, v in checks.items() if not v], "catalog": result["catalog"]}))
    return 0 if result["allChecksPassed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
