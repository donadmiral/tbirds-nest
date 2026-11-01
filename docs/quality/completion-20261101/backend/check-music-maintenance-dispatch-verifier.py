#!/usr/bin/env python3
"""Exercise source-bound maintenance projections and strict negative evidence."""
import copy
import json
import subprocess
import tempfile
from pathlib import Path
HERE = Path(__file__).resolve().parent

def check(source, phase, output):
    result = subprocess.run(["python3", str(HERE / "verify-music-maintenance-dispatch.py"), str(source), "--phase", phase, "--output", str(output)], capture_output=True, text=True)
    return result.returncode, json.loads(output.read_text())

positive = []
for phase in ("preflight", "postflight"):
    code, receipt = check(HERE / f"music-maintenance-dispatch-local-{phase}.json", phase, HERE / f"music-maintenance-dispatch-local-{phase}-checked.json")
    assert code == 0 and receipt["allChecksPassed"], receipt
    positive.append({"phase": phase, "passed": True})
base = json.loads((HERE / "music-maintenance-dispatch-local-postflight.json").read_text())
cases = []
def case(name, mutation, required):
    sample = copy.deepcopy(base)
    mutation(sample["observation"])
    cases.append((name, sample, required))
case("missing_private_table_catalog", lambda o: o["catalog"].__setitem__(slice(None), [r for r in o["catalog"] if not (r["k"] == "relation" and r["n"] == "music_library.maintenance_runs")]), "exactSourceCatalog")
case("public_validator_body_or_acl_drift", lambda o: next(r for r in o["catalog"] if r["n"].startswith("public.validate_music_maintenance_worker(" )).__setitem__("md5", "0"*32), "exactSourceCatalog")
case("duplicate_catalog_row", lambda o: o["catalog"].append(o["catalog"][0]), "exactSourceCatalog")
case("opened_private_access", lambda o: o.__setitem__("musicPrivateFunctionAccess", 1), "musicPrivateFunctionAccess")
case("boolean_zero_count", lambda o: o.__setitem__("musicPrivateTableAccess", False), "musicPrivateTableAccess")
case("boolean_singleton_count", lambda o: o["musicTableCounts"].__setitem__("maintenance_dispatch", True), "exactInitialTableCounts")
case("already_queued_capability", lambda o: o["musicTableCounts"].__setitem__("maintenance_runs", 1), "exactInitialTableCounts")
case("already_enabled_worker", lambda o: o["readiness"].__setitem__("maintenanceEnabled", True), "readinessDisabled")
case("reusable_credential_present", lambda o: o["readiness"].__setitem__("maintenanceCredentialConfigured", True), "readinessDisabled")
case("already_configured_dispatch", lambda o: o["maintenanceDispatchConfiguration"].__setitem__("projectOrigin", "https://example.supabase.co"), "dispatchUnconfigured")
case("public_audio_bucket", lambda o: o["audioBucket"].__setitem__("public", True), "privateAudioBucket")
case("provider_execute_unavailable", lambda o: o.__setitem__("netHttpPostExecutable", False), "providerQueueApiAvailable")
case("wrong_applied_source", lambda o: o["maintenanceJournal"][0].__setitem__("querySha256", "0"*64), "maintenanceJournal")
case("boolean_statement_count", lambda o: o["maintenanceJournal"][0].__setitem__("statementCount", True), "maintenanceJournal")
case("missing_music_prerequisite", lambda o: o["musicJournal"].pop(), "exactMusicJournal")
case("wrong_executor", lambda o: o.__setitem__("executor", "service_role"), "executor")
negative = []
with tempfile.TemporaryDirectory(prefix="platinum-maintenance-evidence-") as temp:
    for name, sample, failed in cases:
        source, target = Path(temp) / (name + ".json"), Path(temp) / (name + "-checked.json")
        source.write_text(json.dumps(sample))
        code, receipt = check(source, "postflight", target)
        assert code == 1 and not receipt["allChecksPassed"] and receipt["checks"][failed] is False, receipt
        negative.append({"case": name, "rejected": True, "requiredFailedCheck": failed})
result = {"formatVersion": 1, "isolatedSourceFixtureOnly": True, "hostedRequestMade": False, "positiveChecks": positive, "negativeChecks": negative, "allChecksPassed": True}
(HERE / "music-maintenance-dispatch-local-verifier-checks.json").write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps({"positive": len(positive), "negative": len(negative), "allChecksPassed": True}))
