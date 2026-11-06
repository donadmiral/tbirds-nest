#!/usr/bin/env python3
"""Observe one existing Xvfb launch for at most 30 seconds of setup time.

This never launches/restarts a display, changes its settings or tests the app.
The caller's original cleanup owns the process and preserves the gate status.
"""
import argparse
import json
import os
from pathlib import Path
import re
import stat
import sys
import time

SETUP_BUDGET_SECONDS = 30.0
POLL_SECONDS = 0.1
MAX_LINE_BYTES = 64


def process_alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False


def display_line(path):
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        return "missing", None
    with os.fdopen(fd, "rb") as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode):
            return "invalid-file", None
        data = source.read(MAX_LINE_BYTES + 1)
    if len(data) > MAX_LINE_BYTES:
        return "oversized", None
    if not data:
        return "empty", None
    if b"\n" not in data:
        return "incomplete", None
    if re.fullmatch(rb"[0-9]+\n", data):
        return "valid", data[:-1].decode("ascii")
    return "invalid", None


def wait_for_display(pid, path, *, clock=time.monotonic, sleep=time.sleep,
                     alive=process_alive, read=display_line):
    started = clock()
    deadline = started + SETUP_BUDGET_SECONDS
    result = {"schema": 1, "budgetMs": 30000, "pollIntervalMs": 100,
              "maximumLineBytes": MAX_LINE_BYTES, "outcome": "pending",
              "processAlive": None, "displayLineState": "not-read", "displayNumber": None}
    while True:
        try:
            result["processAlive"] = alive(pid)
        except (OSError, ValueError, IndexError):
            result["outcome"] = "process-check-failed"
            break
        try:
            state, number = read(path)
            result["displayLineState"] = state
        except OSError:
            result["displayLineState"] = "unreadable"
            result["outcome"] = "display-read-failed"
            break
        if not result["processAlive"]:
            result["outcome"] = "process-exited"
            break
        if state in ("invalid", "invalid-file", "oversized"):
            result["outcome"] = "invalid-display-line"
            break
        if state == "valid":
            try:
                result["processAlive"] = alive(pid)
            except (OSError, ValueError, IndexError):
                result["outcome"] = "process-check-failed"
                break
            if not result["processAlive"]:
                result["outcome"] = "process-exited"
                break
            if clock() <= deadline:
                result["outcome"] = "ready"
                result["displayNumber"] = number
                break
        remaining = deadline - clock()
        if remaining <= 0:
            result["outcome"] = "timeout"
            break
        sleep(min(POLL_SECONDS, remaining))
    result["elapsedMs"] = max(0, round((clock() - started) * 1000))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pid", type=int, required=True)
    parser.add_argument("--display-file", type=Path, required=True)
    args = parser.parse_args()
    if args.pid < 1:
        parser.error("Expected the PID of the single existing Xvfb launch.")
    result = wait_for_display(args.pid, args.display_file)
    try:
        evidence = Path("native-ui-logs/xvfb-readiness.json")
        evidence.parent.mkdir(exist_ok=True)
        evidence.write_text(json.dumps(result, indent=2) + "\n")
    except OSError:
        print("Xvfb readiness evidence could not be retained.", file=sys.stderr)
        return 1
    if result["outcome"] == "ready":
        print(result["displayNumber"])
        return 0
    print("Xvfb setup did not become ready: " + result["outcome"] + ".", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
