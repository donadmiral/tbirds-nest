#!/usr/bin/env python3
"""Verify a source-bound music migration observation; performs no provider action."""
import argparse
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent


def exact_json(actual, expected):
    if type(actual) is not type(expected):
        return False
    if isinstance(expected, dict):
        return actual.keys() == expected.keys() and all(exact_json(actual[key], value) for key, value in expected.items())
    if isinstance(expected, list):
        return len(actual) == len(expected) and all(exact_json(a, b) for a, b in zip(actual, expected))
    return actual == expected


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("observation", type=Path)
    parser.add_argument("--unit", type=int, choices=(1, 2, 3), required=True)
    parser.add_argument("--phase", choices=("preflight", "postflight"), required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    package = json.loads((HERE / "music-migration-requests" / f"{args.unit:02d}_expected.json").read_text())
    raw = json.loads(args.observation.read_text())
    observed = raw.get("observation", raw.get("postflight", raw))
    expected = package[args.phase]
    checks = {}
    details = {}

    for unit in package["allMigrationSources"]:
        request_path = HERE / "music-migration-requests" / f"{unit['order']:02d}_{unit['migrationName']}.json"
        request = json.loads(request_path.read_text())
        sql = request["query"].encode()
        checks[f"unchangedSource{unit['order']}"] = (
            request["project_id"] == package["projectRef"]
            and request["name"] == unit["migrationName"]
            and len(sql) == unit["sourceBytes"]
            and hashlib.sha256(sql).hexdigest() == unit["sourceSha256"]
        )
    checks["readOnly"] = observed.get("readOnly") is True
    checks["executor"] = observed.get("executor") == "postgres"
    checks["phaseAndStage"] = observed.get("phase") == args.phase and exact_json(observed.get("packageStage"), expected["stage"])
    checks["schemaPresence"] = observed.get("musicSchemaPresent") is (expected["stage"] > 0)
    wanted = {(r["k"], r["n"]): r["md5"] for r in expected["catalog"]}
    actual_rows = observed.get("catalog", [])
    actual = {(r["k"], r["n"]): r["md5"] for r in actual_rows}
    missing = sorted(set(wanted) - set(actual))
    extra = sorted(set(actual) - set(wanted))
    different = sorted(key for key in wanted.keys() & actual.keys() if wanted[key] != actual[key])
    checks["exactSourceCatalog"] = not missing and not extra and not different and len(actual) == len(actual_rows)
    details["catalog"] = {"expectedRows": len(wanted), "observedRows": len(actual_rows), "missing": missing, "extra": extra, "different": different}
    for key in ("musicPrivateTableAccess", "musicPrivateFunctionAccess", "musicPrivateSchemaAccess", "musicTablesWithoutRls", "preparedTransactions"):
        checks[key] = exact_json(observed.get(key), 0)
    checks["exactInitialTableCounts"] = exact_json(observed.get("musicTableCounts"), expected["tableCounts"])
    checks["readinessDisabled"] = exact_json(observed.get("readiness"), expected["readiness"])
    checks["privateAudioBucket"] = exact_json(observed.get("audioBucket"), package["expectedAudioBucket"] if expected["stage"] else None)
    checks["noConcurrentClientTransaction"] = exact_json(observed.get("otherActiveOrOpenClientTransactions"), 0)

    business_journal = observed.get("stage8Journal", [])
    business_source = package["prerequisiteBusinessSource"]
    checks["exactBusinessStage8Journal"] = len(business_journal) == 1 and (
        business_journal[0].get("name") == business_source["migrationName"]
        and exact_json(business_journal[0].get("statementCount"), 1)
        and business_journal[0].get("querySha256") == business_source["sha256"]
        and exact_json(business_journal[0].get("queryBytes"), business_source["bytes"])
    )
    story_journal = observed.get("storyPrerequisiteJournal", [])
    story_source = package["prerequisiteStorySource"]
    checks["exactStoryPrerequisiteJournal"] = len(story_journal) == 1 and (
        story_journal[0].get("name") == story_source["migrationName"]
        and exact_json(story_journal[0].get("statementCount"), 1)
        and story_journal[0].get("querySha256") == story_source["sourceSha256"]
        and exact_json(story_journal[0].get("queryBytes"), story_source["sourceBytes"])
    )
    journal = observed.get("musicJournal", [])
    expected_units = package["allMigrationSources"][:expected["stage"]]
    checks["exactMusicJournal"] = len(journal) == len(expected_units) and all(
        len(matches := [r for r in journal if r.get("name") == unit["migrationName"]]) == 1
        and matches[0].get("querySha256") == unit["sourceSha256"]
        and exact_json(matches[0].get("queryBytes"), unit["sourceBytes"])
        and exact_json(matches[0].get("statementCount"), 1)
        for unit in expected_units
    )
    result = {
        "formatVersion": 1,
        "projectRef": package["projectRef"],
        "migrationOrder": args.unit,
        "migrationName": package["source"]["migrationName"],
        "phase": args.phase,
        "sourceSha256": package["source"]["sourceSha256"],
        "observedAt": observed.get("observedAt"),
        "observationPath": str(args.observation),
        "checks": checks,
        "details": details,
        "allChecksPassed": all(checks.values()),
        "scope": "Exact catalog, source journal, private ACL and disabled initial-state checks only; no live identity, upload, cleanup, provider or licence acceptance is claimed.",
    }
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"allChecksPassed": result["allChecksPassed"], "failedChecks": [k for k, v in checks.items() if not v], "catalog": details["catalog"]}))
    return 0 if result["allChecksPassed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
