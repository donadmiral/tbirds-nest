#!/usr/bin/env python3
"""Observe the generated QA AppDelegate URL boundary without changing forwarding."""

import hashlib
import json
import os
from pathlib import Path
import stat
import sys


HELPER = "scripts/quality/native-ui-ios-url-trace.py"
DELEGATE = Path("ios/PlatinumQA/AppDelegate.swift")
OUTPUT = Path("native-ui-logs/ios-url-trace")
MAX_SOURCE_BYTES = 128 * 1024
CLASS = "public class AppDelegate: ExpoAppDelegate {\n"
FORWARD = "    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)\n"
METHOD = """  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
""" + FORWARD + "  }\n"
COUNTER = """  // BEGIN NATIVE_UI_URL_TRACE_COUNTER (disposable QA only)
  private var nativeUIURLTraceSequence: Int = 0
  // END NATIVE_UI_URL_TRACE_COUNTER
"""
TRACE = """    // BEGIN NATIVE_UI_URL_TRACE (disposable QA only)
    let nativeUIURLTraceToken: (Int, Bool)?
    if Bundle.main.bundleIdentifier == "app.platinumcircles.mobile.qa"
      && url.scheme?.lowercased() == "platinum-circles-qa"
      && nativeUIURLTraceSequence < 16 {
      nativeUIURLTraceSequence += 1
      let matched = url.absoluteString == "platinum-circles-qa://ui-fixture/memory"
      nativeUIURLTraceToken = (nativeUIURLTraceSequence, matched)
      NSLog("[native-ui-url] entry sequence=%ld atUnixMs=%.0f matched=%ld",
        nativeUIURLTraceSequence, Date().timeIntervalSince1970 * 1000, matched ? 1 : 0)
    } else {
      nativeUIURLTraceToken = nil
    }
    defer {
      if let (sequence, matched) = nativeUIURLTraceToken {
        NSLog("[native-ui-url] exit sequence=%ld atUnixMs=%.0f matched=%ld",
          sequence, Date().timeIntervalSince1970 * 1000, matched ? 1 : 0)
      }
    }
    // END NATIVE_UI_URL_TRACE
"""


def digest(value):
    return hashlib.sha256(value).hexdigest()


def read_regular(path, limit):
    for entry in (path, *path.parents):
        if entry.is_symlink():
            raise ValueError("Refusing a symbolic link in a QA trace path.")
    with path.open("rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
            raise ValueError("Expected a bounded regular QA trace input.")
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise ValueError("QA trace input exceeds its byte bound.")
    return data


def transform(before):
    source = before.decode("utf-8")
    if "NATIVE_UI_URL_TRACE" in source or "nativeUIURLTrace" in source:
        raise ValueError("The generated AppDelegate already contains URL tracing.")
    if source.count(CLASS) != 1 or source.count(METHOD) != 1 or source.count(FORWARD) != 1:
        raise ValueError("Expected exactly one reviewed generated Swift URL method and forwarding expression.")
    if source.count("import Expo\n") != 1 or source.count("import Foundation\n") > 1:
        raise ValueError("Expected the reviewed generated Swift imports.")
    added_foundation = "import Foundation\n" not in source
    after = source.replace(CLASS, CLASS + COUNTER).replace(METHOD, METHOD.replace(FORWARD, TRACE + FORWARD))
    if added_foundation:
        after = after.replace("import Expo\n", "import Expo\nimport Foundation\n")
    restored = after.replace(COUNTER, "", 1).replace(TRACE, "", 1)
    if added_foundation:
        restored = restored.replace("import Expo\nimport Foundation\n", "import Expo\n", 1)
    if restored != source or after.count(FORWARD) != 1:
        raise ValueError("URL tracing changed unreviewed generated source.")
    return after.encode("utf-8"), added_foundation


def main():
    if (os.environ.get("CI") != "true" or os.environ.get("EXPO_PUBLIC_APP_ENV") != "qa"
            or os.environ.get("EXPO_PUBLIC_SUPABASE_ANON_KEY") != "native-ui-synthetic-no-provider-key"):
        raise ValueError("URL tracing requires the disposable synthetic QA CI configuration.")
    if len(sys.argv) != 1:
        raise ValueError("URL tracing uses only the fixed generated QA paths.")
    helper_hash = digest(read_regular(Path(__file__), MAX_SOURCE_BYTES))
    manifest_bytes = read_regular(Path("native-ui-logs/source.json"), 1024 * 1024)
    manifest = json.loads(manifest_bytes)
    if not isinstance(manifest, dict) or not isinstance(manifest.get("hashes"), dict):
        raise ValueError("Expected the current-run original-source manifest shape.")
    if (not os.environ.get("GITHUB_SHA") or not os.environ.get("GITHUB_RUN_ID")
            or manifest.get("commit") != os.environ["GITHUB_SHA"]
            or manifest.get("workflowRun") != os.environ["GITHUB_RUN_ID"]
            or manifest.get("hashes", {}).get(HELPER) != helper_hash):
        raise ValueError("URL tracing requires matching current-run original-source provenance.")
    before = read_regular(DELEGATE, MAX_SOURCE_BYTES)
    after, added_foundation = transform(before)
    if OUTPUT.exists() or OUTPUT.is_symlink():
        raise ValueError("Refusing to reuse URL trace evidence.")
    OUTPUT.mkdir()
    before_name, after_name = "AppDelegate.before.swift.txt", "AppDelegate.after.swift.txt"
    (OUTPUT / before_name).write_bytes(before)
    (OUTPUT / after_name).write_bytes(after)
    # Replace only this disposable generated file after retaining both complete
    # versions. The original Swift forwarding expression is byte-identical.
    temporary = DELEGATE.with_suffix(".swift.native-ui-url-trace")
    with temporary.open("xb") as stream:
        stream.write(after)
    temporary.chmod(DELEGATE.stat().st_mode & 0o777)
    temporary.replace(DELEGATE)
    proof = {
        "schemaVersion": 1,
        "commit": manifest["commit"],
        "workflowRun": manifest["workflowRun"],
        "helper": HELPER,
        "helperSHA256": helper_hash,
        "sourceManifestSHA256": digest(manifest_bytes),
        "generatedPath": DELEGATE.as_posix(),
        "before": {"file": before_name, "bytes": len(before), "sha256": digest(before)},
        "after": {"file": after_name, "bytes": len(after), "sha256": digest(after)},
        "addedFoundationImport": added_foundation,
        "originalForwardingExpressionSHA256": digest(FORWARD.encode("utf-8")),
        "exactReversalMatchesBefore": True,
        "maximumTracedURLs": 16,
        "maximumLogRecords": 32,
        "recordFields": ["phase", "sequence", "atUnixMs", "matched"],
        "clock": "Foundation Date epoch milliseconds; not calibrated against the host clock",
        "runtimeAcceptance": False,
    }
    (OUTPUT / "source-proof.json").write_text(json.dumps(proof, indent=2) + "\n", encoding="utf-8")
    print("Retained generated QA URL trace source proof; original forwarding is unchanged.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, UnicodeError, ValueError, TypeError, KeyError) as error:
        message = str(error) if isinstance(error, ValueError) and not isinstance(error, UnicodeError) else type(error).__name__
        print("QA URL trace preparation failed: " + message, file=sys.stderr)
        raise SystemExit(2) from None
