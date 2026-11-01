#!/usr/bin/env python3
"""Exercise exact observation checks with isolated source-derived samples only."""
import copy
import json
import subprocess
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
PACKAGE = HERE / "music-migration-requests"


def run_check(sample, unit, phase, target):
    result = subprocess.run(
        ["python3", str(HERE / "verify-music-observation.py"), str(sample), "--unit", str(unit), "--phase", phase, "--output", str(target)],
        capture_output=True, text=True, check=False,
    )
    receipt = json.loads(target.read_text())
    return result.returncode, receipt


positive = []
for unit in (1, 2, 3):
    for phase in ("preflight", "postflight"):
        code, receipt = run_check(PACKAGE / f"{unit:02d}_local-{phase}.json", unit, phase, PACKAGE / f"{unit:02d}_local-{phase}-checked.json")
        assert code == 0 and receipt["allChecksPassed"], receipt
        positive.append({"unit": unit, "phase": phase, "passed": True})

baseline = json.loads((PACKAGE / "03_local-postflight.json").read_text())
cases = []
missing_storage = copy.deepcopy(baseline)
missing_storage["observation"]["catalog"] = [row for row in missing_storage["observation"]["catalog"] if row["n"] != "storage.objects.music_audio_no_direct_read"]
assert len(missing_storage["observation"]["catalog"]) == len(baseline["observation"]["catalog"]) - 1
cases.append(("missing_storage_policy", missing_storage, "exactSourceCatalog"))
changed_function = copy.deepcopy(baseline)
next(row for row in changed_function["observation"]["catalog"] if row["k"] == "function")["md5"] = "0" * 32
cases.append(("changed_function_body_or_acl", changed_function, "exactSourceCatalog"))
private_acl = copy.deepcopy(baseline)
private_acl["observation"]["musicPrivateFunctionAccess"] = 1
cases.append(("opened_private_execute", private_acl, "musicPrivateFunctionAccess"))
activation = copy.deepcopy(baseline)
activation["observation"]["readiness"]["cataloguePlaybackEnabled"] = True
cases.append(("unexpected_catalogue_activation", activation, "readinessDisabled"))
journal = copy.deepcopy(baseline)
journal["observation"]["musicJournal"][0]["querySha256"] = "0" * 64
cases.append(("different_applied_source", journal, "exactMusicJournal"))
bucket = copy.deepcopy(baseline)
bucket["observation"]["audioBucket"]["public"] = True
cases.append(("public_audio_bucket", bucket, "privateAudioBucket"))
boolean_access = copy.deepcopy(baseline)
boolean_access["observation"]["musicPrivateFunctionAccess"] = False
cases.append(("boolean_instead_of_zero_count", boolean_access, "musicPrivateFunctionAccess"))
boolean_singleton = copy.deepcopy(baseline)
boolean_singleton["observation"]["musicTableCounts"]["service_state"] = True
cases.append(("boolean_instead_of_singleton_count", boolean_singleton, "exactInitialTableCounts"))
numeric_readiness = copy.deepcopy(baseline)
numeric_readiness["observation"]["readiness"]["uploadsEnabled"] = 0
cases.append(("number_instead_of_disabled_flag", numeric_readiness, "readinessDisabled"))
executor = copy.deepcopy(baseline)
executor["observation"]["executor"] = "authenticated"
cases.append(("unexpected_executor", executor, "executor"))
business_name = copy.deepcopy(baseline)
business_name["observation"]["stage8Journal"][0]["name"] = "different_stage8_name"
cases.append(("unexpected_business_journal_name", business_name, "exactBusinessStage8Journal"))
business_count = copy.deepcopy(baseline)
business_count["observation"]["stage8Journal"][0]["statementCount"] = True
cases.append(("boolean_business_statement_count", business_count, "exactBusinessStage8Journal"))
story_missing = copy.deepcopy(baseline)
story_missing["observation"]["storyPrerequisiteJournal"] = []
cases.append(("missing_guarded_story_prerequisite", story_missing, "exactStoryPrerequisiteJournal"))
story_source = copy.deepcopy(baseline)
story_source["observation"]["storyPrerequisiteJournal"][0]["querySha256"] = "0" * 64
cases.append(("different_story_prerequisite_source", story_source, "exactStoryPrerequisiteJournal"))
negative = []
with tempfile.TemporaryDirectory(prefix="platinum-music-verifier-") as temporary:
    for name, sample, required_failure in cases:
        source = Path(temporary) / f"{name}.json"
        output = Path(temporary) / f"{name}-checked.json"
        source.write_text(json.dumps(sample))
        code, receipt = run_check(source, 3, "postflight", output)
        assert code == 1 and not receipt["allChecksPassed"] and receipt["checks"][required_failure] is False, receipt
        negative.append({"case": name, "rejected": True, "requiredFailedCheck": required_failure})
result = {"formatVersion": 1, "isolatedSourceFixtureOnly": True, "hostedRequestMade": False, "positiveChecks": positive, "negativeChecks": negative, "allChecksPassed": True}
(PACKAGE / "local-verifier-checks.json").write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps({"positive": len(positive), "negative": len(negative), "allChecksPassed": True}))
