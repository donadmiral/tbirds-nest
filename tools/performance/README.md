# Performance planning tools

`capacity-model.cjs` is an offline workload calculator. It reads explicit assumptions and calculates concurrent sessions, API rates, media bytes, polling demand and retained data at several DAU targets. It does not send traffic, read credentials, measure throughput or certify a supported user count.

`capacity-scenarios.json` contains illustrative light/base/heavy workloads at 5M, 10M and 20M DAU. Replace these assumptions with measured product behavior before sizing infrastructure. Native share refers to active session-time. Background HTTP/API operations and media requests are separate from primary application traffic. The output preserves those distinctions and its limitations.

From the repository root:

```sh
node tools/performance/capacity-model.cjs --input=tools/performance/capacity-scenarios.json --output=/tmp/capacity-results.json --csv=/tmp/capacity-results.csv
node --test tests/capacity-model.test.cjs
```

The existing `http-load.cjs` is a separate GET-only latency probe. It defaults to localhost and requires exact staging-host opt-in for remote use, capped at 10 requests/second and eight workers. Its result never establishes whole-app user capacity. Keep those guards when developing any separate, explicitly budgeted distributed load suite.
