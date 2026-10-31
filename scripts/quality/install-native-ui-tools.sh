#!/usr/bin/env bash
set -euo pipefail
if [[ "${CI:-}" != true ]]; then
  printf '%s\n' 'Install these pinned UI tools only in the disposable CI runner.' >&2
  exit 2
fi
tool_dir="${RUNNER_TEMP:?}/platinum-maestro-2.11.0"
mkdir -p "$tool_dir"
curl --fail --silent --show-error --location --retry 2 \
  https://github.com/mobile-dev-inc/Maestro/releases/download/cli-2.11.0/maestro.zip \
  --output "$tool_dir/maestro.zip"
python3 - "$tool_dir" <<'PY'
from pathlib import Path
import hashlib, sys, zipfile
root=Path(sys.argv[1]); archive=root/'maestro.zip'
if hashlib.sha256(archive.read_bytes()).hexdigest() != '5384593cb4e7a106489e75a821d157dd43f4e438df6bc308b72e82c685e1283a':
    raise SystemExit('The pinned official Maestro release checksum did not match.')
with zipfile.ZipFile(archive) as z:
    for member in z.infolist():
        target=(root/member.filename).resolve()
        if root.resolve() not in target.parents:
            raise SystemExit('Unsafe release archive path')
    z.extractall(root)
    for member in z.infolist():
        target=root/member.filename
        mode=(member.external_attr >> 16) & 0o777
        if mode and target.exists(): target.chmod(mode)
archive.unlink()
executables=list(root.rglob('bin/maestro'))
if len(executables)!=1: raise SystemExit('Expected one Maestro executable.')
executables[0].chmod(0o755)
with open(__import__('os').environ['GITHUB_PATH'],'a') as out: out.write(str(executables[0].parent)+'\n')
PY
