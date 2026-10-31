#!/usr/bin/env bash
set -euo pipefail
if [[ "${CI:-}" != true || $# != 1 || -z "$1" ]]; then
  printf '%s\n' 'Use the existing disposable native UI device for both required flows.' >&2
  exit 2
fi
native_ui_device="$1"
evidence='native-ui-logs'
navigation_attempts=0
capture_attempts=0
navigation_exit=null
capture_exit=null
if [[ -e "$evidence/flow-results.json" || -e "$evidence/maestro-navigation.xml" || -e "$evidence/maestro-memory-capture.xml" ]]; then
  printf '%s\n' 'Refusing to repeat native flows or reuse an earlier JUnit report.' >&2
  exit 2
fi
mkdir -p "$evidence/maestro/navigation" "$evidence/maestro/memory-capture"
write_results() {
  cat > "$evidence/flow-results.json" <<EOF
{
  "schemaVersion": 1,
  "mode": "same-app-required-flows",
  "flows": [
    {"name":"navigation","flow":"tests/native/flows/navigation.yaml","attempts":$navigation_attempts,"exitCode":$navigation_exit,"junit":"maestro-navigation.xml"},
    {"name":"memory-capture","flow":"tests/native/flows/memory-capture.yaml","attempts":$capture_attempts,"exitCode":$capture_exit,"junit":"maestro-memory-capture.xml"}
  ]
}
EOF
}
write_results
# Neither command is retried. The capture flow only opens its existing deep
# link: it does not launch, clear state, or authenticate a replacement session.
navigation_attempts=1
write_results
if maestro --device "$native_ui_device" test --format junit --output "$evidence/maestro-navigation.xml" \
  --debug-output "$evidence/maestro/navigation" --test-output-dir "$evidence/maestro/navigation" \
  tests/native/flows/navigation.yaml 2>&1 | tee "$evidence/maestro-navigation.log"; then
  navigation_exit=0
else
  navigation_exit=$?
fi
write_results
capture_attempts=1
write_results
if maestro --device "$native_ui_device" test --format junit --output "$evidence/maestro-memory-capture.xml" \
  --debug-output "$evidence/maestro/memory-capture" --test-output-dir "$evidence/maestro/memory-capture" \
  tests/native/flows/memory-capture.yaml 2>&1 | tee "$evidence/maestro-memory-capture.log"; then
  capture_exit=0
else
  capture_exit=$?
fi
write_results
# A successful process exit alone is insufficient: empty, skipped, mismatched
# or failed JUnit reports must still fail the complete job.
python3 scripts/quality/native-ui-flow-results.py "$evidence" > "$evidence/flow-verification.json"
