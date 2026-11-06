#!/usr/bin/env python3
"""Add passive, bounded native touch geometry to the disposable QA AppDelegate."""

import hashlib
import json
import os
from pathlib import Path
import stat
import sys


HELPER = "scripts/quality/native-ui-ios-input-trace.py"
DELEGATE = Path("ios/PlatinumQA/AppDelegate.swift")
OUTPUT = Path("native-ui-logs/ios-input-trace")
ARTIFACT = "native-ui-ios-input-diagnostics.jsonl"
MAX_SOURCE_BYTES = 128 * 1024
CLASS = "public class AppDelegate: ExpoAppDelegate {\n"
LAUNCH = """  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
"""
FORWARD = "    return super.application(application, didFinishLaunchingWithOptions: launchOptions)\n"
INSTALL = """    // BEGIN NATIVE_UI_INPUT_TRACE_INSTALL (disposable QA only)
    NativeUIInputTrace.install()
    // END NATIVE_UI_INPUT_TRACE_INSTALL
"""
DISPATCH = "    self.nativeUIInputTraceSendEvent(event)\n"
IMPORTS = ("Foundation", "UIKit", "ObjectiveC", "Dispatch")
SWIFT = r'''
// BEGIN NATIVE_UI_INPUT_TRACE (disposable synthetic QA only)
private struct NativeUIInputTraceRect: Encodable, Sendable {
  let x: Double?
  let y: Double?
  let width: Double?
  let height: Double?

  init(_ rect: CGRect) {
    x = Self.finite(Double(rect.origin.x))
    y = Self.finite(Double(rect.origin.y))
    width = Self.finite(Double(rect.size.width))
    height = Self.finite(Double(rect.size.height))
  }

  static func finite(_ value: Double) -> Double? {
    value.isFinite ? value : nil
  }
}

private struct NativeUIInputTraceAncestor: Encodable, Sendable {
  let viewClass: String
  let frame: NativeUIInputTraceRect
  let bounds: NativeUIInputTraceRect
  let point: [Double?]
  // Geometry only. Never call point(inside:with:) or hitTest(_:with:).
  let containsPoint: Bool
}

private struct NativeUIInputTraceTouch: Encodable, Sendable {
  let phase: String
  let timestampMs: Double?
  let hitViewPresent: Bool
  let ancestors: [NativeUIInputTraceAncestor]
  let ancestorLimitReached: Bool
}

private struct NativeUIInputTraceRecord: Encodable, Sendable {
  let schemaVersion: Int
  let sequence: Int
  let boundary: String
  let atUnixMs: Double
  let eventTimestampMs: Double?
  let touches: [NativeUIInputTraceTouch]
  let touchLimitReached: Bool
}

private enum NativeUIInputTraceSink {
  private static let queue = DispatchQueue(label: "native-ui.input-geometry", qos: .utility)
  private static let maximumFileBytes: UInt64 = 8 * 1024 * 1024

  static func enqueue(_ record: NativeUIInputTraceRecord) {
    // Only immutable value snapshots cross this queue. No UIKit object is retained.
    queue.async {
      do {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        var line = try encoder.encode(record)
        guard line.count <= 128 * 1024 else { return }
        line.append(0x0a)
        let manager = FileManager.default
        guard let documents = manager.urls(for: .documentDirectory, in: .userDomainMask).first else { return }
        let file = documents.appendingPathComponent("native-ui-ios-input-diagnostics.jsonl", isDirectory: false)
        if !manager.fileExists(atPath: file.path) {
          guard manager.createFile(atPath: file.path, contents: nil) else { return }
        }
        let attributes = try manager.attributesOfItem(atPath: file.path)
        guard attributes[.type] as? FileAttributeType == .typeRegular,
          let size = (attributes[.size] as? NSNumber)?.uint64Value,
          size <= maximumFileBytes,
          UInt64(line.count) <= maximumFileBytes - size else { return }
        let handle = try FileHandle(forWritingTo: file)
        defer { try? handle.close() }
        try handle.seekToEnd()
        try handle.write(contentsOf: line)
      } catch {
        // An observer write failure must never alter event delivery.
      }
    }
  }
}

@MainActor
private enum NativeUIInputTrace {
  private static var installed = false
  private static var sequence = 0
  private static let maximumDispatches = 512
  private static let maximumTouches = 4
  private static let maximumAncestors = 24

  static func install() {
    guard Thread.isMainThread, !installed,
      Bundle.main.bundleIdentifier == "app.platinumcircles.mobile.qa",
      let original = class_getInstanceMethod(UIApplication.self, #selector(UIApplication.sendEvent(_:))),
      let observed = class_getInstanceMethod(UIApplication.self, #selector(UIApplication.nativeUIInputTraceSendEvent(_:))),
      method_getNumberOfArguments(original) == 3,
      method_getNumberOfArguments(observed) == 3,
      let originalType = method_getTypeEncoding(original),
      let observedType = method_getTypeEncoding(observed),
      String(cString: originalType) == String(cString: observedType) else { return }
    method_exchangeImplementations(original, observed)
    installed = true
  }

  private static func phase(_ touch: UITouch) -> String? {
    switch touch.phase {
    case .began: return "began"
    case .ended: return "ended"
    case .cancelled: return "cancelled"
    default: return nil
    }
  }

  static func begin(_ event: UIEvent) -> Int? {
    guard Thread.isMainThread, installed, event.type == .touches,
      sequence < maximumDispatches,
      (event.allTouches ?? []).contains(where: { phase($0) != nil }) else { return nil }
    sequence += 1
    capture(event, sequence: sequence, boundary: "before")
    return sequence
  }

  static func capture(_ event: UIEvent, sequence: Int, boundary: String) {
    guard Thread.isMainThread else { return }
    let selected = (event.allTouches ?? []).filter { phase($0) != nil }
    let snapshots = selected.prefix(maximumTouches).compactMap { touch -> NativeUIInputTraceTouch? in
      guard let phase = phase(touch) else { return nil }
      var ancestors: [NativeUIInputTraceAncestor] = []
      var current = touch.view
      while let view = current, ancestors.count < maximumAncestors {
        let point = touch.location(in: view)
        let bounds = view.bounds
        ancestors.append(NativeUIInputTraceAncestor(
          viewClass: String(NSStringFromClass(type(of: view)).prefix(120)),
          frame: NativeUIInputTraceRect(view.frame),
          bounds: NativeUIInputTraceRect(bounds),
          point: [NativeUIInputTraceRect.finite(Double(point.x)), NativeUIInputTraceRect.finite(Double(point.y))],
          containsPoint: bounds.contains(point)))
        current = view.superview
      }
      return NativeUIInputTraceTouch(
        phase: phase, timestampMs: NativeUIInputTraceRect.finite(touch.timestamp * 1000),
        hitViewPresent: touch.view != nil, ancestors: ancestors, ancestorLimitReached: current != nil)
    }
    NativeUIInputTraceSink.enqueue(NativeUIInputTraceRecord(
      schemaVersion: 1, sequence: sequence, boundary: boundary,
      atUnixMs: Date().timeIntervalSince1970 * 1000,
      eventTimestampMs: NativeUIInputTraceRect.finite(event.timestamp * 1000),
      touches: snapshots, touchLimitReached: selected.count > maximumTouches))
  }
}

extension UIApplication {
  @objc fileprivate dynamic func nativeUIInputTraceSendEvent(_ event: UIEvent) {
    let sequence = NativeUIInputTrace.begin(event)
    // After the one installation exchange, this selector is the original implementation.
    // Dispatch the original UIEvent once, unconditionally, without responder decisions.
    self.nativeUIInputTraceSendEvent(event)
    if let sequence = sequence {
      NativeUIInputTrace.capture(event, sequence: sequence, boundary: "after")
    }
  }
}
// END NATIVE_UI_INPUT_TRACE
'''


def digest(value):
    return hashlib.sha256(value).hexdigest()


def read_regular(path, limit):
    for entry in (path, *path.parents):
        if entry.is_symlink():
            raise ValueError("Refusing a symbolic link in an input trace path.")
    with path.open("rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
            raise ValueError("Expected a bounded regular input trace file.")
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise ValueError("Input trace source exceeds its byte bound.")
    return data


def transform(before):
    source = before.decode("utf-8")
    if "NATIVE_UI_INPUT_TRACE" in source or "nativeUIInputTrace" in source:
        raise ValueError("The generated AppDelegate already contains input tracing.")
    if (source.count(CLASS) != 1 or source.count(LAUNCH) != 1
            or source.count(FORWARD) != 1 or "sendEvent" in source
            or "method_exchangeImplementations" in source):
        raise ValueError("Expected the reviewed generated launch and event-dispatch source.")
    if source.count("import Expo\n") != 1 or any(source.count("import " + name + "\n") > 1 for name in IMPORTS):
        raise ValueError("Expected the reviewed generated Swift imports.")
    added_imports = [name for name in IMPORTS if "import " + name + "\n" not in source]
    import_block = "".join("import " + name + "\n" for name in added_imports)
    after = source.replace("import Expo\n", "import Expo\n" + import_block, 1)
    after = after.replace(LAUNCH, LAUNCH + INSTALL, 1) + SWIFT
    restored = after[:-len(SWIFT)].replace(INSTALL, "", 1)
    restored = restored.replace("import Expo\n" + import_block, "import Expo\n", 1)
    if restored != source or after.count(FORWARD) != 1 or SWIFT.count(DISPATCH) != 1:
        raise ValueError("Input tracing changed unreviewed generated source or dispatch.")
    return after.encode("utf-8"), added_imports


def main():
    if (os.environ.get("CI") != "true" or os.environ.get("EXPO_PUBLIC_APP_ENV") != "qa"
            or os.environ.get("EXPO_PUBLIC_SUPABASE_URL") != "https://uaulhuelcfkjwojtymmw.supabase.co"
            or os.environ.get("EXPO_PUBLIC_SUPABASE_ANON_KEY") != "native-ui-synthetic-no-provider-key"):
        raise ValueError("Input tracing requires the disposable synthetic QA CI configuration.")
    if len(sys.argv) != 1:
        raise ValueError("Input tracing uses only the fixed generated QA paths.")
    helper_hash = digest(read_regular(Path(__file__), MAX_SOURCE_BYTES))
    manifest_bytes = read_regular(Path("native-ui-logs/source.json"), 1024 * 1024)
    manifest = json.loads(manifest_bytes)
    if not isinstance(manifest, dict) or not isinstance(manifest.get("hashes"), dict):
        raise ValueError("Expected the current-run original-source manifest shape.")
    if (not os.environ.get("GITHUB_SHA") or not os.environ.get("GITHUB_RUN_ID")
            or manifest.get("commit") != os.environ["GITHUB_SHA"]
            or manifest.get("workflowRun") != os.environ["GITHUB_RUN_ID"]
            or manifest["hashes"].get(HELPER) != helper_hash):
        raise ValueError("Input tracing requires matching current-run original-source provenance.")
    before = read_regular(DELEGATE, MAX_SOURCE_BYTES)
    after, added_imports = transform(before)
    if OUTPUT.exists() or OUTPUT.is_symlink():
        raise ValueError("Refusing to reuse input trace evidence.")
    OUTPUT.mkdir()
    before_name, after_name = "AppDelegate.before.swift.txt", "AppDelegate.after.swift.txt"
    (OUTPUT / before_name).write_bytes(before)
    (OUTPUT / after_name).write_bytes(after)
    temporary = DELEGATE.with_suffix(".swift.native-ui-input-trace")
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
        "addedImports": added_imports,
        "originalLaunchForwardingExpressionSHA256": digest(FORWARD.encode("utf-8")),
        "originalEventDispatchCallSHA256": digest(DISPATCH.encode("utf-8")),
        "exactReversalMatchesBefore": True,
        "runtimeArtifact": "Documents/" + ARTIFACT,
        "maximumDispatchesPerProcess": 512,
        "maximumRecordsPerProcess": 1024,
        "maximumTouchesPerRecord": 4,
        "maximumAncestorsPerTouch": 24,
        "maximumClassNameCharacters": 120,
        "maximumEncodedRecordBytes": 128 * 1024,
        "maximumArtifactBytes": 8 * 1024 * 1024,
        "phases": ["began", "ended", "cancelled"],
        "boundaries": ["before", "after"],
        "recordFields": ["schemaVersion", "sequence", "boundary", "atUnixMs", "eventTimestampMs", "touches", "touchLimitReached"],
        "touchFields": ["phase", "timestampMs", "hitViewPresent", "ancestors", "ancestorLimitReached"],
        "ancestorFields": ["viewClass", "frame", "bounds", "point", "containsPoint"],
        "snapshotThread": "main",
        "serializationAndFileWriteQueue": "serial utility queue",
        "clock": "Date epoch milliseconds and UIKit monotonic timestamps; not calibrated against the host clock",
        "runtimeAcceptance": False,
    }
    (OUTPUT / "source-proof.json").write_text(json.dumps(proof, indent=2) + "\n", encoding="utf-8")
    print("Retained disposable QA input observer source proof; original event dispatch is unchanged.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, UnicodeError, ValueError, TypeError, KeyError) as error:
        message = str(error) if isinstance(error, ValueError) and not isinstance(error, UnicodeError) else type(error).__name__
        print("QA input trace preparation failed: " + message, file=sys.stderr)
        raise SystemExit(2) from None
