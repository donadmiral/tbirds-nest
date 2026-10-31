#!/usr/bin/env python3
"""Require both once-only Maestro flows and their actual executed JUnit cases."""
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

FLOWS = (
    ('navigation', 'Full native app navigation'),
    ('memory-capture', 'Actual native memory capture and encoding'),
)


def validate(directory):
    root = Path(directory)
    result = json.loads((root / 'flow-results.json').read_text())
    if not isinstance(result, dict) or type(result.get('schemaVersion')) is not int or result['schemaVersion'] != 1 or result.get('mode') != 'same-app-required-flows':
        raise ValueError('Missing required native flow result schema.')
    flows = result.get('flows')
    if not isinstance(flows, list) or len(flows) != len(FLOWS):
        raise ValueError('Exactly two required native flow results are needed.')
    verified = []
    for actual, (name, title) in zip(flows, FLOWS):
        flow = f'tests/native/flows/{name}.yaml'
        junit = f'maestro-{name}.xml'
        if not isinstance(actual, dict) or actual.get('name') != name or actual.get('flow') != flow or actual.get('junit') != junit:
            raise ValueError(f'The {name} flow result does not identify the required report.')
        if type(actual.get('attempts')) is not int or actual['attempts'] != 1:
            raise ValueError(f'The {name} flow must run exactly once.')
        if type(actual.get('exitCode')) is not int or actual['exitCode'] != 0:
            raise ValueError(f'The {name} Maestro pipeline did not exit successfully.')
        report = root / junit
        if not report.is_file() or not 1 <= report.stat().st_size <= 2 * 1024 * 1024:
            raise ValueError(f'The {name} JUnit report is missing, empty or oversized.')
        data = report.read_bytes()
        if b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper():
            raise ValueError('JUnit declarations cannot define external or expanded entities.')
        document = ET.fromstring(data)
        if document.tag != 'testsuites':
            raise ValueError(f'The {name} JUnit report has an unexpected root.')
        suites = list(document.iter('testsuite'))
        cases = list(document.iter('testcase'))
        if len(suites) != 1 or len(cases) != 1:
            raise ValueError(f'The {name} JUnit report must contain exactly one executed case.')
        suite, case = suites[0], cases[0]
        if suite.get('tests') != '1' or suite.get('failures') != '0':
            raise ValueError(f'The {name} JUnit suite did not pass its required case.')
        for element in document.iter():
            if element.tag in ('failure', 'error', 'skipped'):
                raise ValueError(f'The {name} JUnit report contains a failed or skipped case.')
            for attribute in ('failures', 'errors', 'skipped', 'disabled'):
                if attribute in element.attrib and element.get(attribute) != '0':
                    raise ValueError(f'The {name} JUnit report has nonzero {attribute}.')
        # Maestro 2.11.0 serializes FlowStatus.SUCCESS directly. Require that
        # actual terminal status as well as the suite counts and case identity.
        if case.get('status') != 'SUCCESS' or case.get('name') != title or case.get('file') != flow:
            raise ValueError(f'The {name} JUnit case is missing its expected successful execution.')
        if case not in list(suite):
            raise ValueError(f'The {name} JUnit case is outside the declared suite.')
        verified.append({'name': name, 'flow': flow, 'attempts': 1, 'exitCode': 0,
                         'junit': junit, 'executedCases': 1, 'status': 'SUCCESS'})
    return {'passed': True, 'flows': verified}


if __name__ == '__main__':
    try:
        if len(sys.argv) != 2:
            raise ValueError('Pass the existing native UI evidence directory.')
        proof = validate(sys.argv[1])
    except (OSError, ValueError, TypeError, ET.ParseError) as error:
        print(json.dumps({'passed': False, 'error': str(error)}))
        raise SystemExit(1)
    print(json.dumps(proof, indent=2))
