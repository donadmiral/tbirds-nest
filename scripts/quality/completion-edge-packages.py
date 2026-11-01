#!/usr/bin/env python3
"""Materialize exact QA deploy_edge_function arguments; never call a provider.

First verify the recursive import graph with build-music-candidate.mjs --check.
Then run this script to prepare, or pass --check to verify, the review files.
"""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CANDIDATE = ROOT / 'docs/quality/music-operations-20261030/candidate.json'
OUTPUT = ROOT / 'docs/quality/completion-20261101/backend/edge-deployment-packages'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + '\n').encode()


def checked_source(record):
    relative = Path(record['path'])
    if relative.is_absolute() or '..' in relative.parts:
        raise ValueError('Invalid source path: ' + str(relative))
    absolute = (ROOT / relative).resolve(strict=True)
    if ROOT not in absolute.parents or not absolute.is_file():
        raise ValueError('Source escapes repository: ' + str(relative))
    data = absolute.read_bytes()
    if len(data) != record['bytes'] or digest(data) != record['sha256']:
        raise ValueError('Source changed after candidate generation: ' + str(relative))
    return data.decode('utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    candidate_bytes = CANDIDATE.read_bytes()
    candidate = json.loads(candidate_bytes)
    if candidate['projects']['qa'] != 'uaulhuelcfkjwojtymmw':
        raise ValueError('Unexpected QA project')
    checked_source(candidate['functionConfiguration'])
    bundles = candidate['affectedEdgeBundles'] + candidate['existingMediaPrerequisiteBundles']
    expected = {
        'business-signin', 'business-owner-access', 'daily-get-token', 'crisp-bridge',
        'link-preview', 'apple-music', 'replicate-proxy', 'create-business',
        'music-asset-finalize', 'content-media-sign', 'media-content',
        'account-storage-erasure', 'music-maintenance', 'music-catalogue-ingest',
        'limited-media-file', 'chat-media-sign',
    }
    if len(bundles) != len(expected) or {x['name'] for x in bundles} != expected:
        raise ValueError('Unexpected deployment bundle membership')
    generated = {}
    records = []
    prerequisites = {x['name'] for x in candidate['existingMediaPrerequisiteBundles']}
    for bundle in bundles:
        names = [x['path'] for x in bundle['files']]
        if len(names) != len(set(names)) or bundle['entrypointPath'] not in names:
            raise ValueError('Invalid file set: ' + bundle['name'])
        if type(bundle['verifyJwt']) is not bool:
            raise ValueError('JWT verification must be explicit')
        payload = {
            'project_id': candidate['projects']['qa'],
            'name': bundle['name'],
            'entrypoint_path': bundle['entrypointPath'],
            'verify_jwt': bundle['verifyJwt'],
            'files': [{'name': item['path'], 'content': checked_source(item)} for item in bundle['files']],
        }
        if 'importMapPath' in bundle:
            if bundle['importMapPath'] not in names:
                raise ValueError('Import map missing from files')
            payload['import_map_path'] = bundle['importMapPath']
        data = encoded(payload)
        filename = bundle['name'] + '.json'
        generated[filename] = data
        records.append({
            'name': bundle['name'], 'file': filename, 'bytes': len(data), 'sha256': digest(data),
            'purpose': bundle['purpose'], 'existingPrerequisite': bundle['name'] in prerequisites,
            'entrypointPath': bundle['entrypointPath'], 'verifyJwt': bundle['verifyJwt'],
            **({'importMapPath': bundle['importMapPath']} if 'importMapPath' in bundle else {}),
            'sourceFiles': bundle['files'], 'externalImports': bundle['externalImports'],
        })
    index = {
        'formatVersion': 1,
        'scope': 'Offline exact QA tool arguments. No provider call, activation, or production argument is generated.',
        'tool': 'mcp__codex_apps__supabase_deploy_edge_function',
        'projectRef': candidate['projects']['qa'],
        'sourceHeadAtGeneration': candidate['sourceHeadAtGeneration'],
        'candidate': {'path': str(CANDIDATE.relative_to(ROOT)), 'sha256': digest(candidate_bytes)},
        'builder': {'path': str(Path(__file__).resolve().relative_to(ROOT)), 'sha256': digest(Path(__file__).read_bytes())},
        'deployGroupsInOrder': candidate['deployGroupsInOrder'],
        'existingPrerequisiteRule': 'Read back the existing limited-media-file and chat-media-sign bundles first; deploy only if absent or differing and after their separate private-media prerequisites.',
        'requiredBeforeDeployment': 'Current business Auth activation and exact postflight, then all three music contracts and postflight. No dependent function may be replaced while the target remains at private stage 3.',
        'requiredAfterEachDeployment': 'Require terminal success, ACTIVE version, exact verify_jwt and entrypoint/import map, then retrieve every bundled source file and compare its bytes to sourceFiles. Retain rejection probes and the real authorized journey separately.',
        'originalReadiness': 'Keep production off. Enable only disposable QA after all required contracts and bundles pass, run upload/finalization/delivery/revocation/cleanup/erasure acceptance, and disable QA on failure.',
        'licensedCatalogue': 'Keep ingestion and playback disabled; these files grant no commercial rights or provider credentials.',
        'unknownRequestRule': 'A nonterminal provider result stays unknown. Do not duplicate it, route DDL through SQL, or claim local packages are hosted acceptance.',
        'uniqueSourceFiles': len({x['path'] for b in bundles for x in b['files']}),
        'requests': records,
    }
    generated['index.json'] = encoded(index)
    if args.check:
        actual = {p.name for p in OUTPUT.glob('*.json')}
        if actual != set(generated):
            raise ValueError('Package file membership changed')
        for name, data in generated.items():
            if (OUTPUT / name).read_bytes() != data:
                raise ValueError('Package changed: ' + name)
    else:
        OUTPUT.mkdir(parents=True, exist_ok=True)
        for name, data in generated.items():
            (OUTPUT / name).write_bytes(data)
    print(json.dumps({'result': 'verified' if args.check else 'prepared', 'requests': len(records), 'uniqueSourceFiles': index['uniqueSourceFiles'], 'bytes': sum(len(x) for x in generated.values()), 'providerCalls': 0}))


if __name__ == '__main__':
    main()
