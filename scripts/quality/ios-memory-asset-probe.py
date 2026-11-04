#!/usr/bin/env python3
"""One source-bound AVFoundation diagnosis on the failed full-app target."""
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import plistlib
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time

BASE = "e25cc20af8f7196bd814532b78cf5dbfb5f5e9a7"
EXPECTED_HASH = "e7a68e03487b0527b67426cf8a9a706a047a70535d571c17ead636b1806013f2"
EXPECTED_BYTES = 54_300
BUNDLE = "com.platinum.qa.memoryassetprobe"
EXECUTABLE = "MemoryAssetLoadProbe"
DEVELOPER = "/Applications/Xcode_16.4.app/Contents/Developer"
RUNTIME = "com.apple.CoreSimulator.SimRuntime.iOS-18-5"
DEVICE = "com.apple.CoreSimulator.SimDeviceType.iPhone-16"
FIXTURE = "tests/native/assets/memory-capture-video.mp4"
SOURCES = [
    "scripts/quality/MemoryAssetLoadProbe.swift",
    "scripts/quality/ios-memory-asset-probe.py",
    "tests/quality/test_ios_memory_asset_probe.py",
    ".github/workflows/ios-memory-asset-diagnostics.yml",
    FIXTURE, "package-lock.json", "src/services/memoryMovieExport.ts",
    "src/services/memoryMovieFiles.ts", "tests/native/expo-fetch-fixture.cjs",
]


class ProbeFailure(Exception):
    pass


def file_identity(path, maximum=16 * 1024 * 1024):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > maximum:
        raise ProbeFailure("invalid_source_file")
    data = path.read_bytes()
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def select_runtime(data):
    candidates = [item for item in data.get("runtimes", [])
                  if item.get("identifier") == RUNTIME and item.get("isAvailable") is True
                  and item.get("version") == "18.5"]
    if len(candidates) != 1:
        raise ProbeFailure("exact_simulator_runtime_unavailable")
    value = candidates[0]
    build = value.get("buildversion", "")
    if build != "22F77":
        raise ProbeFailure("invalid_simulator_runtime_identity")
    return {"identifier": RUNTIME, "version": "18.5", "buildVersion": build,
            "deviceType": DEVICE}


def finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def validate_receipt(value):
    if not isinstance(value, dict) or value.get("schemaVersion") != 1:
        raise ProbeFailure("invalid_native_receipt")
    required = {"scope": "standalone_exact_fixture_avfoundation_probe",
                "loadContract": "AVAsset.load(.duration, .preferredTransform, .isPlayable)",
                "loadDeadlineSeconds": 20, "requestedDecodedFrames": 6}
    if any(value.get(key) != expected for key, expected in required.items()):
        raise ProbeFailure("native_receipt_scope_mismatch")
    for key in ("productionJsExecuted", "expoPlayerExecuted", "productAcceptance",
                "networkUsed", "photosWritten", "movieExported"):
        if value.get(key) is not False:
            raise ProbeFailure("native_receipt_scope_mismatch")
    phases = {"initializing", "foreground", "copy_and_hash", "asset_keys", "video_tracks", "decode_frames"}
    if value.get("phase") not in phases or not finite(value.get("elapsedMs")) or value["elapsedMs"] < 0:
        raise ProbeFailure("invalid_native_timing")
    events = value.get("events")
    if not isinstance(events, list) or len(events) > 5:
        raise ProbeFailure("invalid_native_events")
    previous = -1
    for event in events:
        if (not isinstance(event, dict) or event.get("phase") not in phases
                or not finite(event.get("atUptimeMs")) or event["atUptimeMs"] < previous
                or not finite(event.get("atUnixMs")) or type(event.get("mainThread")) is not bool):
            raise ProbeFailure("invalid_native_events")
        previous = event["atUptimeMs"]
    if type(value.get("passed")) is not bool:
        raise ProbeFailure("invalid_native_result")
    if value["passed"] is not True:
        if value.get("reason") == "phase_deadline":
            if (value.get("timedOutPhase") != value["phase"]
                    or not finite(value.get("phaseElapsedMs"))
                    or not finite(value.get("deadlineSeconds"))
                    or value["phaseElapsedMs"] < value["deadlineSeconds"] * 1000 - 1):
                raise ProbeFailure("invalid_timeout_receipt")
            if value["phase"] == "asset_keys" and value["deadlineSeconds"] != 20:
                raise ProbeFailure("changed_asset_deadline")
        return False
    evidence = value.get("evidence", {})
    if (value.get("reason") != "six_frames_decoded" or value["phase"] != "decode_frames"
            or evidence.get("sourceBytes") != EXPECTED_BYTES or evidence.get("copiedBytes") != EXPECTED_BYTES
            or evidence.get("sourceSha256") != EXPECTED_HASH or evidence.get("copiedSha256") != EXPECTED_HASH
            or evidence.get("systemVersion") != "18.5"
            or evidence.get("assetClass") != "AVURLAsset" or evidence.get("avAssetOptions") != "nil"):
        raise ProbeFailure("unverified_native_source")
    for key in ("fileHandlesClosedBeforeLoad", "sourceIsFileURL", "copyIsFileURL",
                "mainActorEntry", "mainActorAfterLoad", "applicationActive", "playable", "stoppedAfterRequestedFrames"):
        if evidence.get(key) is not True:
            raise ProbeFailure("unverified_native_boundary")
    if (not finite(evidence.get("assetLoadMs")) or not 0 <= evidence["assetLoadMs"] < 20_000
            or not finite(evidence.get("durationSeconds")) or abs(evidence["durationSeconds"] - 3) >= .06
            or evidence.get("decodedFrameCount") != 6
            or evidence.get("readerStatusBeforeStop") not in ("reading", "completed")):
        raise ProbeFailure("unverified_media_result")
    frames = evidence.get("decodedFrames")
    if not isinstance(frames, list) or len(frames) != 6:
        raise ProbeFailure("unverified_decoded_frames")
    previous = -1
    for frame in frames:
        if (not isinstance(frame, dict) or not finite(frame.get("presentationSeconds"))
                or frame["presentationSeconds"] < 0 or frame["presentationSeconds"] <= previous
                or frame.get("pixelFormat") != "32BGRA"
                or any(type(frame.get(key)) is not int or not 1 <= frame[key] <= 8192
                       for key in ("width", "height"))):
            raise ProbeFailure("unverified_decoded_frames")
        previous = frame["presentationSeconds"]
    return True


class Driver:
    def __init__(self, output):
        self.output = output
        self.deadline = time.monotonic() + 450
        self.steps = []
        self.device = None
        self.temporary = None
        self.container = None

    def command(self, args, label, seconds, allow_failure=False):
        remaining = min(seconds, self.deadline - time.monotonic())
        if remaining <= 0:
            raise ProbeFailure("driver_deadline")
        started = time.monotonic()
        log = self.output / (label + ".log")
        timed_out = False
        with log.open("wb") as stream:
            process = subprocess.Popen(args, stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
            try:
                code = process.wait(timeout=remaining)
            except subprocess.TimeoutExpired:
                timed_out = True
                os.killpg(process.pid, signal.SIGKILL)
                code = process.wait(timeout=5)
        self.steps.append({"step": label, "elapsedMs": round((time.monotonic() - started) * 1000, 3),
                           "exitCode": code, "timedOut": timed_out})
        if timed_out:
            raise ProbeFailure("step_deadline_" + label)
        if log.stat().st_size > 2 * 1024 * 1024:
            raise ProbeFailure("step_output_limit_" + label)
        if code and not allow_failure:
            raise ProbeFailure("step_failed_" + label)
        return log.read_text(errors="replace").strip(), code

    def cleanup(self):
        if self.device:
            for action in (("terminate", self.device, BUNDLE), ("shutdown", self.device), ("delete", self.device)):
                try:
                    subprocess.run(["xcrun", "simctl", *action], stdout=subprocess.DEVNULL,
                                   stderr=subprocess.DEVNULL, timeout=20, check=False)
                except (subprocess.TimeoutExpired, OSError):
                    pass
        if self.temporary:
            shutil.rmtree(self.temporary, ignore_errors=True)

    def execute(self):
        if (platform.system() != "Darwin" or platform.machine() != "x86_64"
                or os.environ.get("CI") != "true" or os.environ.get("DEVELOPER_DIR") != DEVELOPER):
            raise ProbeFailure("requires_exact_disposable_intel_runner")
        commit, _ = self.command(["git", "rev-parse", "HEAD"], "source-commit", 5)
        if not re.fullmatch(r"[a-f0-9]{40}", commit) or commit != os.environ.get("GITHUB_SHA"):
            raise ProbeFailure("source_commit_mismatch")
        self.command(["git", "merge-base", "--is-ancestor", BASE, "HEAD"], "source-base", 5)
        state, _ = self.command(["git", "status", "--porcelain", "--untracked-files=no"], "source-state", 5)
        if state:
            raise ProbeFailure("modified_tracked_source")
        hashes = {name: file_identity(Path(name)) for name in SOURCES}
        if hashes[FIXTURE] != {"bytes": EXPECTED_BYTES, "sha256": EXPECTED_HASH}:
            raise ProbeFailure("fixture_source_mismatch")
        package = json.loads(Path("package-lock.json").read_text())["packages"]["node_modules/expo-video"]
        if package.get("version") != "3.0.16":
            raise ProbeFailure("expo_reference_version_changed")
        source = {"schemaVersion": 1, "sourceCommit": commit, "baseCommit": BASE,
                  "workflowRun": os.environ.get("GITHUB_RUN_ID"), "sources": hashes,
                  "comparisonExpoVideoVersion": package["version"],
                  "comparisonExpoVideoIntegrity": package.get("integrity"),
                  "scope": "plain AVURLAsset probe, no Expo or production JS execution"}
        (self.output / "source.json").write_text(json.dumps(source, indent=2) + "\n")
        (self.output / "sources").mkdir()
        for name in SOURCES[:4]:
            shutil.copyfile(name, self.output / "sources" / Path(name).name)
        xcode, _ = self.command(["xcodebuild", "-version"], "xcode-version", 10)
        sdk_version, _ = self.command(["xcrun", "--sdk", "iphonesimulator", "--show-sdk-version"], "sdk-version", 10)
        sdk_build, _ = self.command(["xcrun", "--sdk", "iphonesimulator", "--show-sdk-build-version"], "sdk-build", 10)
        if xcode != "Xcode 16.4\nBuild version 16F6" or sdk_version != "18.5" or sdk_build != "22F76":
            raise ProbeFailure("toolchain_mismatch")
        sdk, _ = self.command(["xcrun", "--sdk", "iphonesimulator", "--show-sdk-path"], "sdk-path", 10)
        swift, _ = self.command(["xcrun", "swiftc", "--version"], "swift-version", 10)
        macos, _ = self.command(["sw_vers", "-productVersion"], "macos-version", 10)
        if not re.fullmatch(r"15\.[0-9]+(?:\.[0-9]+)?", macos):
            raise ProbeFailure("runner_os_mismatch")
        # The first simctl call also starts CoreSimulator on the fresh runner.
        # This setup bound is separate from the unchanged 20-second media load.
        runtimes, _ = self.command(["xcrun", "simctl", "list", "runtimes", "--json"], "available-runtimes", 90)
        runtime = select_runtime(json.loads(runtimes))
        runtime.update(architecture="x86_64", runner="macos-15-intel", macosVersion=macos,
                       xcodeVersion="16.4", xcodeBuild="16F6", sdkVersion="18.5", sdkBuild=sdk_build,
                       swiftVersion=swift[:512], developerDirectory=DEVELOPER,
                       compilerOptimization="-O", swiftLanguageMode="5",
                       compilerTarget="x86_64-apple-ios15.1-simulator")
        (self.output / "runtime.json").write_text(json.dumps(runtime, indent=2) + "\n")
        self.temporary = Path(tempfile.mkdtemp(prefix="memory-asset-probe-", dir=os.environ.get("RUNNER_TEMP")))
        app = self.temporary / (EXECUTABLE + ".app")
        app.mkdir()
        shutil.copyfile(FIXTURE, app / "fixture.mp4")
        info = {"CFBundleIdentifier": BUNDLE, "CFBundleName": "Memory Asset Probe",
                "CFBundleExecutable": EXECUTABLE, "CFBundlePackageType": "APPL",
                "CFBundleVersion": "1", "CFBundleShortVersionString": "1.0", "MinimumOSVersion": "15.1",
                "LSRequiresIPhoneOS": True, "UIDeviceFamily": [1], "CFBundleSupportedPlatforms": ["iPhoneSimulator"]}
        (app / "Info.plist").write_bytes(plistlib.dumps(info))
        self.command(["xcrun", "--sdk", "iphonesimulator", "swiftc", "-O", "-swift-version", "5",
                      "-sdk", sdk, "-target", "x86_64-apple-ios15.1-simulator", "-parse-as-library",
                      SOURCES[0], "-framework", "UIKit", "-framework", "AVFoundation", "-framework", "CoreMedia",
                      "-framework", "CoreVideo", "-framework", "CryptoKit", "-o", str(app / EXECUTABLE)],
                     "swift-build", 100)
        self.command(["xcrun", "lipo", str(app / EXECUTABLE), "-verify_arch", "x86_64"], "binary-architecture", 10)
        self.command(["codesign", "--force", "--sign", "-", str(app)], "sign-standalone-probe", 15)
        self.command(["codesign", "--verify", "--strict", str(app)], "verify-probe-signature", 10)
        binary = {"executable": file_identity(app / EXECUTABLE), "infoPlist": file_identity(app / "Info.plist"),
                  "packagedFixture": file_identity(app / "fixture.mp4"), "bundleIdentifier": BUNDLE,
                  "application": "standalone diagnostic, no production app rebuilt or resigned"}
        if binary["packagedFixture"] != hashes[FIXTURE]:
            raise ProbeFailure("packaged_fixture_mismatch")
        (self.output / "binary.json").write_text(json.dumps(binary, indent=2) + "\n")
        device, _ = self.command(["xcrun", "simctl", "create", "Memory asset probe " + commit[:8], DEVICE, RUNTIME], "create-simulator", 15)
        if not re.fullmatch(r"[A-Fa-f0-9-]{36}", device):
            raise ProbeFailure("invalid_created_simulator")
        self.device = device
        self.command(["xcrun", "simctl", "boot", device], "boot-simulator", 20)
        self.command(["xcrun", "simctl", "bootstatus", device, "-b"], "simulator-ready", 300)
        self.command(["xcrun", "simctl", "install", device, str(app)], "install-probe", 30)
        container, _ = self.command(["xcrun", "simctl", "get_app_container", device, BUNDLE, "data"], "probe-container", 10)
        self.container = Path(container)
        if not self.container.is_dir():
            raise ProbeFailure("missing_probe_container")
        # One launch only. Native timers exit without waiting for AVFoundation;
        # this independent 60-second process bound covers a missing receipt.
        _, code = self.command(["xcrun", "simctl", "launch", "--console", device, BUNDLE], "probe-console", 60, allow_failure=True)
        receipt = self.container / "Documents/memory-asset-probe.json"
        file_identity(receipt, 32 * 1024)
        shutil.copyfile(receipt, self.output / "receipt.json")
        value = json.loads(receipt.read_text())
        passed = validate_receipt(value)
        if passed and code != 0:
            raise ProbeFailure("probe_process_exit_mismatch")
        return passed


def main():
    output = Path("native-memory-asset-logs")
    output.mkdir(exist_ok=False)
    driver = Driver(output)
    passed, failure = False, None
    try:
        passed = driver.execute()
    except (ProbeFailure, OSError, ValueError, KeyError, TypeError) as error:
        failure = str(error) if isinstance(error, ProbeFailure) else "driver_setup_or_evidence_error"
    finally:
        driver.cleanup()
        (output / "driver-result.json").write_text(json.dumps({"schemaVersion": 1, "passed": passed,
            "failure": failure, "steps": driver.steps, "automaticRetries": 0,
            "simulatorsCreated": int(driver.device is not None), "productionAcceptance": False}, indent=2) + "\n")
    print("Standalone memory asset probe " + ("passed." if passed else "failed. Inspect the bounded diagnostic receipt."))
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
