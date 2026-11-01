#!/usr/bin/env python3
"""Check the exact QA story prerequisite boundary without provider actions."""
import argparse
import hashlib
import json
from pathlib import Path
from importlib.util import spec_from_file_location, module_from_spec

HERE = Path(__file__).resolve().parent
spec = spec_from_file_location("music_verifier", HERE / "verify-music-observation.py")
module = module_from_spec(spec)
spec.loader.exec_module(module)

parser = argparse.ArgumentParser()
parser.add_argument("observation", type=Path)
parser.add_argument("--phase", choices=("preflight", "postflight"), required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
candidate = json.loads((HERE / "music-story-prerequisite-candidate.json").read_text())
request = json.loads((HERE / "music-story-prerequisite-request.json").read_text())
raw = json.loads(args.observation.read_text())
o = raw.get("observation", raw)
checks = {
    "exactSourceRequest": request["project_id"] == candidate["projectRef"] and request["name"] == candidate["migrationName"] and hashlib.sha256(request["query"].encode()).hexdigest() == candidate["sourceSha256"] and len(request["query"].encode()) == candidate["sourceBytes"],
    "readOnly": o.get("readOnly") is True,
    "executor": o.get("executor") == "postgres",
    "exactFunctionBodiesAndPrivileges": module.exact_json(o.get("functions"), candidate["beforeFunctions" if args.phase == "preflight" else "afterFunctions"]),
    "musicSchemaAbsent": o.get("musicSchemaAbsent") is True,
    "legacyAudioAbsent": module.exact_json(o.get("legacyAudioCounts"), {"sounds": 0, "storiesWithAudio": 0, "booksWithSoundtrack": 0, "postsWithSoundtrack": 0}),
    "legacyBookColumn": module.exact_json(o.get("bookSoundtrackPosition"), 9),
    "exactBusinessJournal": module.exact_json(o.get("businessJournal"), [candidate["prerequisiteBusinessJournal"]]),
    "noConcurrentClientTransaction": module.exact_json(o.get("otherActiveOrOpenClientTransactions"), 0),
    "noPreparedTransaction": module.exact_json(o.get("preparedTransactions"), 0),
}
journal = o.get("journal", [])
if args.phase == "preflight":
    checks["migrationJournal"] = journal == []
else:
    checks["migrationJournal"] = len(journal) == 1 and journal[0].get("name") == candidate["migrationName"] and journal[0].get("querySha256") == candidate["sourceSha256"] and module.exact_json(journal[0].get("queryBytes"), candidate["sourceBytes"]) and module.exact_json(journal[0].get("statementCount"), 1)
result = {"formatVersion": 1, "phase": args.phase, "projectRef": candidate["projectRef"], "sourceSha256": candidate["sourceSha256"], "observedAt": o.get("observedAt"), "checks": checks, "allGatesPassed": all(checks.values()), "providerVersion": journal[0].get("version") if journal else None, "scope": "Exact publisher source/ACL transition and unchanged surrounding story contract only; no music installation or provider acceptance inferred."}
args.output.write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps(result))
raise SystemExit(0 if result["allGatesPassed"] else 1)
