#!/usr/bin/env python3
"""Package reviewed publisher sources only; no credentials, hosted calls or repository discovery."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[2]
FILES = ['workers/live-social/Dockerfile', 'workers/live-social/package.json',
         'workers/live-social/adapters.mjs', 'workers/live-social/pull.mjs', 'workers/live-social/health.mjs',
         'workers/live-social/runtime-policy.mjs', 'workers/live-social/acceptance.mjs',
         'workers/live-social/test/publishing.test.mjs', 'workers/live-social/test/runtime-policy.test.mjs',
         'infrastructure/live-social/verify-source.mjs', 'infrastructure/live-social/image-receipt.mjs',
         'infrastructure/live-social/resolve-base.mjs', 'infrastructure/live-social/buildspec.yml']

def package(directory=None):
    output = Path(tempfile.mkdtemp(prefix='platinum-social-source-', dir=directory))
    contents = {}
    for name in sorted(FILES):
        target = ROOT / name
        if target.is_symlink() or not target.is_file() or target.resolve() != target:
            raise ValueError('source_file_invalid')
        data = target.read_bytes()
        if not data or len(data) > 1048576:
            raise ValueError('source_file_invalid')
        contents[name] = data
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    manifest = {'schema_version': 1, 'repository_head': revision, 'source_of_truth': 'exact_file_hashes',
                'files': [{'path': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
                          for name, data in contents.items()]}
    manifest_bytes = (json.dumps(manifest, sort_keys=True, indent=2) + '\n').encode()
    contents['social-source-manifest.json'] = manifest_bytes
    archive = output / 'social-source.zip'
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as zipped:
        for name, data in contents.items():
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            zipped.writestr(info, data)
    receipt = {'schema_version': 1, 'archive_path': str(archive), 'bytes': archive.stat().st_size,
               'archive_sha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
               'manifest_sha256': hashlib.sha256(manifest_bytes).hexdigest(), 'file_count': len(FILES),
               'repository_head': revision, 'contains_credentials': False}
    (output / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    return receipt

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory')
    args = parser.parse_args()
    try:
        print(json.dumps(package(args.directory), indent=2))
    except Exception:
        print('{"ok":false,"error":"social_source_packaging_failed"}')
        raise SystemExit(1)
