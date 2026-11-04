import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("ios_memory_asset_probe", ROOT / "scripts/quality/ios-memory-asset-probe.py")
PROBE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROBE)


def receipt():
    return {
        "schemaVersion": 1, "passed": True, "reason": "six_frames_decoded", "phase": "decode_frames",
        "scope": "standalone_exact_fixture_avfoundation_probe",
        "loadContract": "AVAsset.load(.duration, .preferredTransform, .isPlayable)",
        "loadDeadlineSeconds": 20, "requestedDecodedFrames": 6,
        "productionJsExecuted": False, "expoPlayerExecuted": False, "productAcceptance": False,
        "networkUsed": False, "photosWritten": False, "movieExported": False, "elapsedMs": 122,
        "events": [{"phase": "asset_keys", "atUptimeMs": 100, "atUnixMs": 200, "mainThread": True}],
        "evidence": {
            "sourceBytes": PROBE.EXPECTED_BYTES, "copiedBytes": PROBE.EXPECTED_BYTES,
            "sourceSha256": PROBE.EXPECTED_HASH, "copiedSha256": PROBE.EXPECTED_HASH,
            "systemVersion": "18.5", "assetClass": "AVURLAsset", "avAssetOptions": "nil",
            "fileHandlesClosedBeforeLoad": True, "sourceIsFileURL": True, "copyIsFileURL": True,
            "mainActorEntry": True, "mainActorAfterLoad": True, "applicationActive": True,
            "playable": True, "stoppedAfterRequestedFrames": True, "assetLoadMs": 45,
            "durationSeconds": 3, "decodedFrameCount": 6, "readerStatusBeforeStop": "reading",
            "decodedFrames": [{"presentationSeconds": i / 30, "width": 360, "height": 640,
                               "pixelFormat": "32BGRA"} for i in range(6)],
        },
    }


class EvidenceGuards(unittest.TestCase):
    def test_exact_installed_fixture_identity(self):
        self.assertEqual(PROBE.file_identity(ROOT / PROBE.FIXTURE),
                         {"bytes": PROBE.EXPECTED_BYTES, "sha256": PROBE.EXPECTED_HASH})
        lock = json.loads((ROOT / "package-lock.json").read_text())
        self.assertEqual(lock["packages"]["node_modules/expo-video"]["version"], "3.0.16")

    def test_source_hash_rejects_symlinks_and_oversized_files(self):
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp) / "source"
            target.write_bytes(b"actual bytes")
            link = Path(temp) / "link"
            link.symlink_to(target)
            for file, maximum in [(link, 1024), (target, 1), (Path(temp) / "absent", 1024)]:
                with self.subTest(file=file.name), self.assertRaises(PROBE.ProbeFailure):
                    PROBE.file_identity(file, maximum)

    def test_runtime_selection_requires_the_exact_available_version(self):
        exact = {"identifier": PROBE.RUNTIME, "version": "18.5", "isAvailable": True, "buildversion": "22F77"}
        newer = {**exact, "identifier": "com.apple.CoreSimulator.SimRuntime.iOS-26-2", "version": "26.2"}
        self.assertEqual(PROBE.select_runtime({"runtimes": [newer, exact]})["identifier"], PROBE.RUNTIME)
        for values in [[newer], [{**exact, "isAvailable": False}], [exact, exact],
                       [{**exact, "buildversion": "22F76"}], [{**exact, "buildversion": "bad/path"}]]:
            with self.subTest(values=values), self.assertRaises(PROBE.ProbeFailure):
                PROBE.select_runtime({"runtimes": values})

    def test_receipt_accepts_only_bounded_actual_decode_evidence(self):
        self.assertTrue(PROBE.validate_receipt(receipt()))
        for key, value in [("copiedSha256", "0" * 64), ("copiedBytes", 1024), ("sourceSha256", "0" * 64),
                           ("fileHandlesClosedBeforeLoad", False), ("playable", False), ("durationSeconds", 0),
                           ("assetLoadMs", 20_000), ("assetLoadMs", float("nan")), ("decodedFrameCount", 5),
                           ("systemVersion", "26.2"), ("applicationActive", False), ("mainActorEntry", False),
                           ("readerStatusBeforeStop", "failed")]:
            value_receipt = receipt()
            value_receipt["evidence"][key] = value
            with self.subTest(key=key), self.assertRaises(PROBE.ProbeFailure):
                PROBE.validate_receipt(value_receipt)

    def test_reader_samples_require_real_dimensions_and_increasing_timestamps(self):
        for key, value in [("presentationSeconds", 0), ("width", 0), ("height", 9000), ("pixelFormat", "unknown")]:
            value_receipt = receipt()
            value_receipt["evidence"]["decodedFrames"][1][key] = value
            with self.subTest(key=key), self.assertRaises(PROBE.ProbeFailure):
                PROBE.validate_receipt(value_receipt)
        value_receipt = receipt()
        value_receipt["evidence"]["decodedFrames"].pop()
        with self.assertRaises(PROBE.ProbeFailure):
            PROBE.validate_receipt(value_receipt)

    def test_diagnostic_cannot_claim_product_or_network_acceptance(self):
        for key in ("productionJsExecuted", "expoPlayerExecuted", "productAcceptance", "networkUsed", "photosWritten", "movieExported"):
            value_receipt = receipt()
            value_receipt[key] = True
            with self.subTest(key=key), self.assertRaises(PROBE.ProbeFailure):
                PROBE.validate_receipt(value_receipt)

    def test_native_twenty_second_timeout_is_retained_as_failure(self):
        value = receipt()
        value.update(passed=False, reason="phase_deadline", phase="asset_keys", timedOutPhase="asset_keys",
                     deadlineSeconds=20, phaseElapsedMs=20_001)
        self.assertFalse(PROBE.validate_receipt(value))
        for field, wrong in [("phaseElapsedMs", 19_000), ("deadlineSeconds", 40), ("timedOutPhase", "decode_frames")]:
            invalid = copy.deepcopy(value)
            invalid[field] = wrong
            with self.subTest(field=field), self.assertRaises(PROBE.ProbeFailure):
                PROBE.validate_receipt(invalid)

    def test_host_timeout_kills_process_group_once_without_retry(self):
        with tempfile.TemporaryDirectory() as temp:
            driver = PROBE.Driver(Path(temp))
            process = mock.Mock(pid=12345)
            process.wait.side_effect = [PROBE.subprocess.TimeoutExpired("probe", .1), -9]
            with mock.patch.object(PROBE.subprocess, "Popen", return_value=process) as launch, mock.patch.object(PROBE.os, "killpg") as kill:
                with self.assertRaisesRegex(PROBE.ProbeFailure, "step_deadline_probe-console"):
                    driver.command(["standalone-probe"], "probe-console", .1)
                self.assertEqual(launch.call_count, 1)
                kill.assert_called_once_with(12345, PROBE.signal.SIGKILL)
            self.assertEqual(driver.steps[0]["timedOut"], True)
            self.assertEqual(process.wait.call_count, 2)

    def test_no_native_command_starts_after_driver_deadline(self):
        with tempfile.TemporaryDirectory() as temp:
            driver = PROBE.Driver(Path(temp))
            driver.deadline = 0
            with mock.patch.object(PROBE.subprocess, "Popen") as launch:
                with self.assertRaisesRegex(PROBE.ProbeFailure, "driver_deadline"):
                    driver.command(["standalone-probe"], "probe-console", 60)
                launch.assert_not_called()

    def test_setup_uses_only_remaining_shared_driver_budget(self):
        with tempfile.TemporaryDirectory() as temp, mock.patch.object(PROBE.time, "monotonic", return_value=1000):
            driver = PROBE.Driver(Path(temp))
            process = mock.Mock(pid=12345)
            process.wait.return_value = 0
            with mock.patch.object(PROBE.subprocess, "Popen", return_value=process):
                driver.command(["setup-command"], "setup")
                process.wait.assert_called_once_with(timeout=450)
                process.wait.reset_mock()
                driver.deadline = 1080
                driver.command(["another-setup-command"], "another-setup")
                process.wait.assert_called_once_with(timeout=80)

    def test_probe_process_keeps_sixty_second_cap_within_shared_budget(self):
        with tempfile.TemporaryDirectory() as temp, mock.patch.object(PROBE.time, "monotonic", return_value=1000):
            driver = PROBE.Driver(Path(temp))
            process = mock.Mock(pid=12345)
            process.wait.return_value = 0
            with mock.patch.object(PROBE.subprocess, "Popen", return_value=process):
                driver.command(["standalone-probe"], "probe-console", 60, allow_failure=True)
                process.wait.assert_called_once_with(timeout=60)
                process.wait.reset_mock()
                driver.deadline = 1020
                driver.command(["standalone-probe"], "probe-console-limited", 60, allow_failure=True)
                process.wait.assert_called_once_with(timeout=20)

    def test_native_and_workflow_scope_remain_disposable(self):
        swift = (ROOT / "scripts/quality/MemoryAssetLoadProbe.swift").read_text()
        self.assertIn("@MainActor func run() async", swift)
        self.assertIn("asset.load(.duration, .preferredTransform, .isPlayable)", swift)
        self.assertIn('begin("asset_keys", seconds: 20)', swift)
        self.assertIn("DispatchQueue.global(qos: .userInitiated).asyncAfter", swift)
        self.assertIn("exit(passed ? 0 : 1)", swift)
        self.assertNotIn("withThrowingTaskGroup", swift)
        self.assertNotIn("URLSession", swift)
        self.assertNotIn("localizedDescription", swift)
        workflow = (ROOT / ".github/workflows/ios-memory-asset-diagnostics.yml").read_text()
        self.assertIn("runs-on: macos-15-intel", workflow)
        self.assertIn("timeout-minutes: 12", workflow)
        self.assertIn("contents: read", workflow)
        self.assertNotIn("workflow_dispatch", workflow)
        self.assertNotIn("npm ci", workflow)
        self.assertNotIn("cocoapods", workflow)


if __name__ == "__main__":
    unittest.main()
