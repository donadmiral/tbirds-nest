#!/usr/bin/env python3
"""Fail closed unless this disposable QA run actually uses Mesa LLVMpipe GLES."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile


MAX_LOG_BYTES = 1024 * 1024
EVIDENCE = Path("native-ui-logs")


def read_log(name):
    path = EVIDENCE / name
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as source:
        before = os.fstat(source.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size > MAX_LOG_BYTES:
            raise ValueError(f"{name}: expected a bounded regular log")
        # The emulator continues appending after boot. Verify the bounded
        # prefix present at open; appends alone must not make startup flaky.
        data = source.read(before.st_size)
        after = os.fstat(source.fileno())
        if len(data) != before.st_size or after.st_size < before.st_size or os.pread(source.fileno(), before.st_size, 0) != data:
            raise ValueError(f"{name}: captured log prefix changed during verification")
    if not data or len(data) > MAX_LOG_BYTES:
        raise ValueError(f"{name}: empty or oversized log")
    return data.decode("utf-8", errors="strict"), {
        "path": str(path), "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "scope": "prefix present at open", "sizeAfterRead": after.st_size,
    }


def single_field(text, pattern, label):
    values = re.findall(pattern, text, flags=re.MULTILINE)
    if len(values) != 1 or not values[0].strip():
        raise ValueError(f"Expected one {label} field")
    return values[0].strip()


def require_mesa_llvmpipe(vendor, renderer):
    if not re.search(r"\bmesa\b", vendor, re.IGNORECASE):
        raise ValueError("The observed vendor is not Mesa")
    if not re.search(r"\bllvmpipe\b", renderer, re.IGNORECASE):
        raise ValueError("The observed renderer is not LLVMpipe")
    if re.search(r"swiftshader", vendor + " " + renderer, re.IGNORECASE):
        raise ValueError("The observed renderer still includes SwiftShader")


def host_fields(text):
    vendor = single_field(text, r"^OpenGL vendor string:[ \t]*(.+)$", "host GL vendor")
    renderer = single_field(text, r"^OpenGL renderer string:[ \t]*(.+)$", "host GL renderer")
    require_mesa_llvmpipe(vendor, renderer)
    return {"vendor": vendor, "renderer": renderer}


def emulator_fields(text):
    modes = re.findall(r"^INFO[ \t]*\|[ \t]*emuglConfig_init:[ \t]+vulkan_mode_selected:(\S+)[ \t]+gles_mode_selected:(\S+)[ \t]*$", text, flags=re.MULTILINE)
    if len(modes) != 1 or modes[0][1] != "host":
        raise ValueError("Expected one explicit host GLES selection")
    vendor = single_field(text, r"^INFO[ \t]*\|[ \t]*Graphics Adapter Vendor[ \t]+(.+)$", "emulator GL vendor")
    renderer = single_field(text, r"^INFO[ \t]*\|[ \t]*Graphics Adapter (?!Vendor\b)(.+)$", "emulator GL renderer")
    version = single_field(text, r"^INFO[ \t]*\|[ \t]*Graphics API Version[ \t]+(.+)$", "emulator GL version")
    require_mesa_llvmpipe(vendor, renderer)
    match = re.match(r"OpenGL ES (\d+)\.(\d+)\b", version)
    if not match or (int(match[1]), int(match[2])) < (3, 0):
        raise ValueError("The emulator did not expose the required GLES 3.0 or newer context")
    if re.search(r"swiftshader", version, re.IGNORECASE):
        raise ValueError("The observed GLES version still includes SwiftShader")
    return {"vendor": vendor, "renderer": renderer, "version": version,
            "selectedGlesMode": modes[0][1], "selectedVulkanMode": modes[0][0]}


def write_receipt(name, receipt):
    EVIDENCE.mkdir(exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".graphics-", dir=EVIDENCE)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as target:
            json.dump(receipt, target, indent=2)
            target.write("\n")
        os.replace(temporary, EVIDENCE / name)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=("host", "emulator"))
    phase = parser.parse_args().phase
    receipt = {"schemaVersion": 1, "phase": phase, "passed": False,
               "requested": {"glesMode": "host", "hostSoftwareDriver": "llvmpipe", "guestVulkan": False},
               "inputs": [], "limits": ["Renderer identity only; this does not establish UI, movie, physical-device or Vulkan acceptance."]}
    try:
        host, provenance = read_log("host-graphics.log")
        receipt["inputs"].append(provenance)
        receipt["host"] = host_fields(host)
        if phase == "emulator":
            emulator, provenance = read_log("emulator.log")
            receipt["inputs"].append(provenance)
            receipt["emulator"] = emulator_fields(emulator)
        receipt["passed"] = True
    except (OSError, UnicodeError, ValueError) as error:
        receipt["failure"] = str(error)
    write_receipt("host-graphics.json" if phase == "host" else "emulator-graphics.json", receipt)
    print("Mesa LLVMpipe " + phase + " renderer identity " + ("verified." if receipt["passed"] else "not verified."))
    return 0 if receipt["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
