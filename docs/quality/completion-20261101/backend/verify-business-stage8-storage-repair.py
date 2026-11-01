#!/usr/bin/env python3
"""Verify a saved hosted read-only observation against the exact source fixture."""
import argparse
import hashlib
import json
from pathlib import Path

BASE = Path(__file__).resolve().parent
SUFFIX = '.business_session_required'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def exact_json(actual, expected):
    if type(actual) is not type(expected):
        return False
    if isinstance(expected, dict):
        return actual.keys() == expected.keys() and all(exact_json(actual[k], v) for k, v in expected.items())
    if isinstance(expected, list):
        return len(actual) == len(expected) and all(exact_json(a, b) for a, b in zip(actual, expected))
    return actual == expected


def verify(observation, expected):
    require(observation.get('readOnly') is True and observation.get('executor') == 'postgres',
            'Expected the read-only postgres observation')
    require(observation.get('marker') is None, 'Private stage marker was not removed')
    catalog = observation['catalog']
    keys = [(row['k'], row['n']) for row in catalog]
    require(len(keys) == len(set(keys)), 'Duplicate catalog identities')
    is_policy = lambda row: row['k'] == 'policy' and row['n'].endswith(SUFFIX)
    normal = lambda rows: sorted(rows, key=lambda row: (row['k'], row['n']))
    require(exact_json(normal([row for row in catalog if not is_policy(row)]),
            normal([row for row in expected['rows'] if not is_policy(row)])),
            'Static catalog differs from the exact activated source')
    eligible = observation['eligiblePolicyTables']
    require(eligible and len(eligible) == len(set(eligible)), 'Invalid eligible-table enumeration')
    policies = [row for row in catalog if is_policy(row)]
    require(sorted(row['n'][:-len(SUFFIX)] for row in policies) == sorted(eligible),
            'Business policy coverage differs from the complete hosted eligible-table set')
    require(all(exact_json(row['v'], expected['expectedBusinessPolicyValue']) for row in policies),
            'A hosted business policy has a different mode, role, command or expression')
    for name in ['privateTableAccess', 'privateFunctionAccess', 'privateSchemaAccess',
                 'businessAuthSessions', 'otherPrivateRows']:
        require(type(observation.get(name)) is int and observation.get(name) == 0, f'Unexpected {name}')
    require(observation.get('accountSeedMatchesCurrentBusinessProfiles') is True and
            type(observation.get('accountSeedCount')) is int and type(observation.get('businessProfileCount')) is int and
            observation.get('accountSeedCount') == observation.get('businessProfileCount'),
            'Business account seed does not exactly match the target profile set')
    require(exact_json(observation.get('excludedProviderMetadata'), expected['excludedProviderMetadata']), 'Excluded provider metadata differs from its exact reviewed owner/ACL/RLS/column state')
    require(type(observation.get('excludedProviderMetadataPolicyCount')) is int and observation['excludedProviderMetadataPolicyCount'] == 0, 'Excluded provider metadata is no longer default-deny')
    require(type(observation.get('policyAuthorityMissing')) is int and observation['policyAuthorityMissing'] == 0, 'Required policy surface lost supported owner/provider authority')
    journals = observation['journal']
    source = expected['source']
    require(len(journals) == 1, 'Expected exactly one stage-8 provider journal entry')
    journal = journals[0]
    require(journal['name'] == expected['source']['name'] and
            type(journal['statementCount']) is int and journal['statementCount'] == 1 and type(journal['queryBytes']) is int and journal['queryBytes'] == source['bytes'] and
            journal['querySha256'] == source['sha256'], 'Provider journal differs from source')
    return {
        'formatVersion': 1,
        'projectRef': 'uaulhuelcfkjwojtymmw',
        'allGatesPassed': True,
        'observedAtUtc': observation['observedAt'],
        'sourceSha256': source['sha256'],
        'providerMigrationVersion': journal['version'],
        'actualFingerprint': observation['fingerprint'],
        'staticCatalogRowsVerified': len(catalog) - len(policies),
        'eligibleHostedTables': len(eligible),
        'exactRestrictivePoliciesVerified': len(policies),
        'privateAccessClosed': True,
        'excludedProviderMetadataRetainedClosed': [row['name'] for row in expected['excludedProviderMetadata']],
        'supportedPolicyAuthorityVerified': True,
        'exactAccountSeedVerified': True,
        'scope': 'Exact installed activation and actual policy coverage; no Auth issuance or provider acceptance inferred.',
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('observation', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    raw = args.observation.read_bytes()
    data = json.loads(raw)
    observation = data.get('postflight', data)
    expected_path = BASE / 'business-stage8-storage-repair-expected.json'
    expected_raw = expected_path.read_bytes()
    result = verify(observation, json.loads(expected_raw))
    if data.get('sourceBoundIsolatedFixture') is True:
        result['sourceBoundIsolatedFixture'] = True
        result['fixtureJournalVersion'] = result.pop('providerMigrationVersion')
        result['eligibleFixtureTables'] = result.pop('eligibleHostedTables')
        result['scope'] = 'Actual isolated repaired SQL and read-only projection only. This is not hosted activation, Auth issuance or provider acceptance.'
    result['observationSha256'] = hashlib.sha256(raw).hexdigest()
    result['expectedCatalogSha256'] = hashlib.sha256(expected_raw).hexdigest()
    output = json.dumps(result, indent=2) + '\n'
    if args.output:
        args.output.write_text(output)
    print(output, end='')


if __name__ == '__main__':
    main()
