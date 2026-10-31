#!/usr/bin/env python3
"""Best-effort, bounded collection of this CI emulator's advertised Crashpad store."""
import argparse
import contextlib
import hashlib
import json
import os
import pwd
import re
import stat
import sys
import time

MAX_LOG_BYTES = 1024 * 1024
MAX_FILE_BYTES = 16 * 1024 * 1024
MAX_TOTAL_BYTES = 32 * 1024 * 1024
MAX_ENTRIES = 128
MAX_DEPTH = 6
MAX_SECONDS = 5
DIRECTORY_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
FILE_FLAGS = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK


def collect(pid, started_ns, gate_exit):
    uid = os.getuid()
    now_ns = time.time_ns()
    deadline = time.monotonic() + MAX_SECONDS
    manifest = {
        "schemaVersion": 1,
        "mode": "current-run-emulator-crashpad",
        "runId": os.environ.get("GITHUB_RUN_ID"),
        "emulatorPid": pid,
        "gateExitCode": gate_exit,
        "runStartedUnixNs": str(started_ns),
        "collectionStartedUnixNs": str(now_ns),
        "limits": {"logBytes": MAX_LOG_BYTES, "fileBytes": MAX_FILE_BYTES,
                   "totalReadBytes": MAX_TOTAL_BYTES, "entries": MAX_ENTRIES,
                   "depth": MAX_DEPTH, "seconds": MAX_SECONDS},
        "status": "unavailable", "entries": [], "limitsHit": [],
        "entriesExamined": 0, "bytesRead": 0, "bytesCopied": 0, "filesCopied": 0,
    }
    with contextlib.ExitStack() as stack:
        def opened(name, flags, parent=None):
            fd = os.open(name, flags, dir_fd=parent)
            stack.callback(os.close, fd)
            return fd

        cwd_fd = opened(".", DIRECTORY_FLAGS)
        logs_fd = opened("native-ui-logs", DIRECTORY_FLAGS, cwd_fd)
        # A prior output directory (including a symlink) must never be reused.
        os.mkdir("emulator-crashpad", mode=0o700, dir_fd=logs_fd)
        output_fd = opened("emulator-crashpad", DIRECTORY_FLAGS, logs_fd)
        os.mkdir("files", mode=0o700, dir_fd=output_fd)
        payload_fd = opened("files", DIRECTORY_FLAGS, output_fd)
        manifest["filesDirectory"] = "files"

        def skipped(path, reason, **details):
            manifest["entries"].append({"path": path, "status": "skipped", "reason": reason, **details})

        def limit(name):
            if name not in manifest["limitsHit"]:
                manifest["limitsHit"].append(name)

        def same_file(a, b):
            return (a.st_dev, a.st_ino, a.st_size, a.st_mtime_ns, a.st_ctime_ns) == (
                b.st_dev, b.st_ino, b.st_size, b.st_mtime_ns, b.st_ctime_ns)

        def write_all(fd, data):
            view = memoryview(data)
            while view:
                count = os.write(fd, view)
                if count <= 0:
                    raise OSError("Short diagnostic write")
                view = view[count:]

        def copy_file(parent_fd, target_fd, name, relative, before):
            if before.st_uid != uid or before.st_nlink != 1:
                skipped(relative, "foreign-owner-or-hardlink")
                return
            if not started_ns <= before.st_mtime_ns <= time.time_ns():
                skipped(relative, "outside-current-run-time", bytes=before.st_size)
                return
            if before.st_size > MAX_FILE_BYTES:
                skipped(relative, "file-size-limit", bytes=before.st_size)
                limit("fileBytes")
                return
            if before.st_size > MAX_TOTAL_BYTES - manifest["bytesRead"]:
                skipped(relative, "total-read-limit", bytes=before.st_size)
                limit("totalReadBytes")
                return
            temporary = ".native-copy-" + str(manifest["entriesExamined"])
            source_fd = target_file_fd = None
            try:
                source_fd = os.open(name, FILE_FLAGS, dir_fd=parent_fd)
                if not same_file(before, os.fstat(source_fd)):
                    skipped(relative, "changed-before-copy")
                    return
                target_file_fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                                         0o600, dir_fd=target_fd)
                digest = hashlib.sha256()
                copied = 0
                while copied < before.st_size:
                    if time.monotonic() >= deadline:
                        limit("seconds")
                        raise TimeoutError("Diagnostic deadline")
                    remaining = min(before.st_size - copied,
                                    MAX_TOTAL_BYTES - manifest["bytesRead"])
                    if remaining <= 0:
                        raise ValueError("Source grew or read budget exhausted")
                    chunk = os.read(source_fd, min(256 * 1024, remaining))
                    if not chunk:
                        break
                    manifest["bytesRead"] += len(chunk)
                    copied += len(chunk)
                    digest.update(chunk)
                    write_all(target_file_fd, chunk)
                if copied != before.st_size or not same_file(before, os.fstat(source_fd)):
                    raise ValueError("Source changed during copy")
                os.close(target_file_fd)
                target_file_fd = None
                os.rename(temporary, name, src_dir_fd=target_fd, dst_dir_fd=target_fd)
                manifest["filesCopied"] += 1
                manifest["bytesCopied"] += copied
                manifest["entries"].append({"path": relative, "status": "copied", "bytes": copied,
                                            "sha256": digest.hexdigest(), "sourceMtimeNs": str(before.st_mtime_ns)})
            except (OSError, ValueError) as error:
                skipped(relative, "copy-incomplete-or-changed", errorType=type(error).__name__)
            finally:
                if target_file_fd is not None:
                    os.close(target_file_fd)
                if source_fd is not None:
                    os.close(source_fd)
                try:
                    os.unlink(temporary, dir_fd=target_fd)
                except FileNotFoundError:
                    pass

        def walk(source_fd, target_fd, relative="", depth=0):
            with os.scandir(source_fd) as entries:
                for entry in entries:
                    if manifest["entriesExamined"] >= MAX_ENTRIES:
                        limit("entries")
                        return
                    if time.monotonic() >= deadline:
                        limit("seconds")
                        return
                    manifest["entriesExamined"] += 1
                    name = entry.name
                    path = relative + "/" + name if relative else name
                    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", name) or name in (".", "..") or name.startswith(".native-copy-"):
                        skipped(path, "unsupported-name")
                        continue
                    try:
                        info = os.stat(name, dir_fd=source_fd, follow_symlinks=False)
                        if stat.S_ISLNK(info.st_mode):
                            skipped(path, "symlink")
                        elif stat.S_ISDIR(info.st_mode):
                            if depth >= MAX_DEPTH or info.st_uid != uid:
                                skipped(path, "depth-limit-or-foreign-directory")
                                if depth >= MAX_DEPTH:
                                    limit("depth")
                                continue
                            child_fd = os.open(name, DIRECTORY_FLAGS, dir_fd=source_fd)
                            try:
                                actual = os.fstat(child_fd)
                                if (actual.st_dev, actual.st_ino, actual.st_uid) != (info.st_dev, info.st_ino, uid):
                                    skipped(path, "directory-changed")
                                    continue
                                os.mkdir(name, mode=0o700, dir_fd=target_fd)
                                child_target_fd = os.open(name, DIRECTORY_FLAGS, dir_fd=target_fd)
                                try:
                                    walk(child_fd, child_target_fd, path, depth + 1)
                                finally:
                                    os.close(child_target_fd)
                            finally:
                                os.close(child_fd)
                        elif stat.S_ISREG(info.st_mode):
                            copy_file(source_fd, target_fd, name, path, info)
                        else:
                            skipped(path, "not-regular-file")
                    except OSError as error:
                        skipped(path, "unavailable-entry", errorType=type(error).__name__)

        try:
            if sys.platform != "linux" or os.environ.get("CI") != "true" or os.environ.get("EXPO_PUBLIC_APP_ENV") != "qa":
                raise ValueError("Requires the disposable Linux QA CI environment")
            if not re.fullmatch(r"[1-9][0-9]{0,19}", manifest["runId"] or ""):
                raise ValueError("Missing current workflow run identity")
            if pid <= 0 or not 0 <= gate_exit <= 255 or not now_ns - 2 * 60 * 60 * 10**9 <= started_ns <= now_ns:
                raise ValueError("Invalid current emulator launch marker")
            log_fd = opened("emulator.log", FILE_FLAGS, logs_fd)
            log_info = os.fstat(log_fd)
            if not stat.S_ISREG(log_info.st_mode) or log_info.st_uid != uid or log_info.st_nlink != 1 or log_info.st_size > MAX_LOG_BYTES:
                raise ValueError("Unsafe or oversized emulator log")
            if not started_ns <= log_info.st_mtime_ns <= now_ns:
                raise ValueError("Emulator log is outside the current launch boundary")
            log = os.read(log_fd, MAX_LOG_BYTES + 1)
            if len(log) != log_info.st_size or not same_file(log_info, os.fstat(log_fd)):
                raise ValueError("Emulator log changed during inspection")
            text = log.decode("utf-8", errors="replace")
            versions = re.findall(r"^INFO\s+\|\s+Android emulator version ([0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,9})(?:\.[0-9]{1,4})?\b", text, re.M)
            stores = re.findall(r"^INFO\s+\|\s+Storing crashdata in: (.+), detection is enabled for process: ([0-9]+)\s*$", text, re.M)
            if len(versions) != 1 or len(stores) != 1 or int(stores[0][1]) != pid:
                raise ValueError("Emulator log does not identify this exact process and version")
            user = pwd.getpwuid(uid).pw_name
            if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", user):
                raise ValueError("Unsupported runner username")
            parent_name = "android-" + user
            store_name = "emu-crash-" + versions[0] + ".db"
            expected_path = "/tmp/" + parent_name + "/" + store_name
            if stores[0][0] != expected_path:
                raise ValueError("Advertised store is outside the exact runner/version path")
            manifest["source"] = {"path": expected_path, "version": versions[0],
                                  "logSHA256": hashlib.sha256(log).hexdigest(), "logBytes": len(log)}
            filesystem_fd = opened("/", DIRECTORY_FLAGS)
            temp_fd = opened("tmp", DIRECTORY_FLAGS, filesystem_fd)
            user_fd = opened(parent_name, DIRECTORY_FLAGS, temp_fd)
            store_fd = opened(store_name, DIRECTORY_FLAGS, user_fd)
            if os.fstat(user_fd).st_uid != uid or os.fstat(store_fd).st_uid != uid:
                raise ValueError("Crash store owner does not match this runner")
            walk(store_fd, payload_fd)
            manifest["status"] = "partial" if manifest["limitsHit"] or any(e["status"] == "skipped" for e in manifest["entries"]) else "collected"
        except (OSError, ValueError) as error:
            manifest["status"] = "rejected" if isinstance(error, ValueError) else "unavailable"
            manifest["error"] = {"type": type(error).__name__, "message": str(error)}
        data = (json.dumps(manifest, indent=2) + "\n").encode()
        manifest_fd = os.open("manifest.json", os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=output_fd)
        try:
            write_all(manifest_fd, data)
        finally:
            os.close(manifest_fd)
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pid", type=int, required=True)
    parser.add_argument("--started-ns", type=int, required=True)
    parser.add_argument("--gate-exit", type=int, required=True)
    args = parser.parse_args(argv)
    try:
        return collect(args.pid, args.started_ns, args.gate_exit)
    except OSError as error:
        print("Cannot retain emulator diagnostic manifest: " + type(error).__name__, file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
