#!/usr/bin/env python3
"""Materialize only the two evidence-backed iOS interaction corrections."""
import hashlib
from pathlib import Path
import shutil

PREFIX = 'tests/native/audit/'
SIGNIN = PREFIX + 'flows/_signin.yaml'
SIGNIN_SHA = '847857016d5651ef0cfe7d57747c5ef3a08ad3e837492aa4b2f7fa250125993a'
BODY = 'Write the piece. Paragraphs are preserved exactly as you write them. Use the toolbar for headings, emphasis, quotes, links and images.'
PARAGRAPH = 'A synthetic article paragraph kept inside the audit.'
CORRECTIONS = {
    'jobs-application-entry.yaml': {
        'before': '4b32d33b23a4c43260bcf2cb841209f5f7e9479540ab42350ebffa9564521ef3',
        'after': 'cf022f31991d07d8e2a3298674ce537c26f6fb6a06eb08849fcf4fd851063c78',
        'changes': [('    centerElement: true\n- tapOn: Apply now\n',
                     '    # The application button stays in the fixed footer; it cannot be centered.\n    centerElement: false\n- tapOn: Apply now\n')],
    },
    'feed-article-draft.yaml': {
        'before': '87af3111e5d879c1a760e0469a831f438a213b96391c8ac6aadfde9fe86be540',
        'after': '1fd283b617325b75aa8b967b98dc746a4aa4edd796b25e3d7b4e56f60e0f70e7',
        'changes': [('- tapOn: ' + BODY + '\n',
                     '- tapOn:\n    text: ' + BODY + '\n    # The multiline field\'s center can be covered by the iOS keyboard.\n    point: "50%,10%"\n'),
                    ('- inputText: ' + PARAGRAPH + '\n',
                     '- inputText: ' + PARAGRAPH + '\n- assertVisible: ' + PARAGRAPH + '\n'),
                    ('    element: An audit article\n    direction: UP\n    centerElement: true\n',
                     '    element: An audit article\n    direction: UP\n    centerElement: false\n')],
    },
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def transform(name, original):
    if name not in CORRECTIONS or digest(original) != CORRECTIONS[name]['before']:
        raise ValueError('Only the exact reviewed original interaction flow may be adapted')
    value = original.decode('utf-8')
    for before, after in CORRECTIONS[name]['changes']:
        if value.count(before) != 1:
            raise ValueError('A reviewed interaction anchor is missing or duplicated')
        value = value.replace(before, after, 1)
    changed = value.encode('utf-8')
    if digest(changed) != CORRECTIONS[name]['after'] or reverse(name, changed) != original:
        raise ValueError('The complete adapted flow differs from the independently reviewed bytes')
    return changed


def reverse(name, changed):
    if name not in CORRECTIONS or digest(changed) != CORRECTIONS[name]['after']:
        raise ValueError('Only the exact reviewed adapted interaction flow may be reversed')
    value = changed.decode('utf-8')
    for before, after in reversed(CORRECTIONS[name]['changes']):
        if value.count(after) != 1:
            raise ValueError('The executed interaction adaptation is incomplete')
        value = value.replace(after, before, 1)
    original = value.encode('utf-8')
    if digest(original) != CORRECTIONS[name]['before']:
        raise ValueError('The executed flow cannot be restored to its original bytes')
    return original


def verify_execution(execution, proof):
    actual = {p.relative_to(execution).as_posix(): p for p in (execution / PREFIX).rglob('*') if p.is_file()}
    if set(actual) != set(proof['executedFileHashes']):
        raise ValueError('The disposable flow tree gained or lost an execution input')
    for name, expected in proof['executedFileHashes'].items():
        relative = Path(name)
        if any((execution / Path(*relative.parts[:length])).is_symlink() for length in range(1, len(relative.parts) + 1)):
            raise ValueError('A disposable execution input was replaced by an alias')
        if digest(actual[name].read_bytes()) != expected:
            raise ValueError('An executed original or adapted flow changed: ' + name)
    if proof['executedFileHashes'].get(SIGNIN) != SIGNIN_SHA:
        raise ValueError('The original iOS/Android sign-in resets must remain unchanged')
    for name, contract in CORRECTIONS.items():
        path = PREFIX + 'flows/' + name
        if digest(reverse(name, actual[path].read_bytes())) != contract['before']:
            raise ValueError('An executed correction does not exactly restore its original flow')


def materialize(baseline, execution, source):
    baseline = Path(baseline).resolve(strict=True)
    execution = Path(execution).resolve()
    if execution == baseline or baseline in execution.parents or execution.exists():
        raise ValueError('The disposable execution tree must be fresh and outside the canonical checkout')
    originals = {name: expected for name, expected in source['hashes'].items() if name.startswith(PREFIX + 'flows/')}
    if originals.get(SIGNIN) != SIGNIN_SHA:
        raise ValueError('The exact producer sign-in flow is required')
    for name, contract in CORRECTIONS.items():
        if originals.get(PREFIX + 'flows/' + name) != contract['before']:
            raise ValueError('The exact producer interaction flow is required')
    for name, expected in originals.items():
        relative = Path(name)
        if relative.is_absolute() or '..' in relative.parts:
            raise ValueError('A declared flow input escapes its source checkout')
        original = baseline / relative
        if (any((baseline / Path(*relative.parts[:length])).is_symlink() for length in range(1, len(relative.parts) + 1))
                or not original.is_file() or digest(original.read_bytes()) != expected):
            raise ValueError('A producer flow input was changed before adaptation')
    execution.mkdir()
    executed = {}
    for name, expected in originals.items():
        original = baseline / name
        target = execution / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(original, target)
        if target.name in CORRECTIONS:
            target.write_bytes(transform(target.name, target.read_bytes()))
        executed[name] = digest(target.read_bytes())
    proof = {'kind': 'two-reviewed-ios-interaction-corrections',
             'sourceFileHashes': originals, 'executedFileHashes': executed,
             'corrections': [{'path': PREFIX + 'flows/' + name, 'beforeSha256': contract['before'],
                              'executedSha256': contract['after'], 'exactReversalVerified': True}
                             for name, contract in CORRECTIONS.items()],
             'originalSignInSha256': SIGNIN_SHA, 'resetsUnchanged': True,
             'uiReadinessAndCommandDeadlinesUnchanged': True,
             'allOriginalApplicationAssertionsRetained': True,
             'exactArticleBodyAssertionRequired': True, 'canonicalCheckoutEdited': False,
             'appRebuiltRebundledOrResigned': False}
    verify_execution(execution, proof)
    return proof
