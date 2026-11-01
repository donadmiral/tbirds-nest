#!/usr/bin/env python3
"""Analyze retained native timing without treating test-driver time as app time."""
import argparse
import json
import math
from pathlib import Path


def analyze_timing(value, started, finished, limit_ms=1000, expected_visits=3):
    if (type(value.get('schemaVersion')) is not int or value.get('schemaVersion') != 1 or value.get('mode') != 'synthetic-native-navigation-timing'
            or value.get('dropped') != 0 or not isinstance(value.get('events'), list)):
        raise ValueError('Missing, wrong-mode or truncated navigation observations')
    events = value['events']
    previous = -1
    for sequence, event in enumerate(events, 1):
        if (event.get('sequence') != sequence or type(event.get('atMs')) not in (int, float)
                or not math.isfinite(event['atMs']) or type(event.get('atUnixMs')) is not int
                or event['atMs'] < previous or not started <= event.get('atUnixMs', 0) <= finished):
            raise ValueError('Navigation observations are stale, out of order or malformed')
        previous = event['atMs']
    presses = [index for index, event in enumerate(events)
               if event.get('phase') == 'tab-press' and event.get('screen') == 'Messages']
    if type(expected_visits) is not int or expected_visits < 1 or len(presses) != expected_visits:
        raise ValueError('Every expected actual Messages tab visit must be observed exactly once')
    visits = []
    for cycle, index in enumerate(presses, 1):
        press = events[index]
        next_press = next((n for n in range(index + 1, len(events))
                           if events[n].get('phase') == 'tab-press'), len(events))
        visible_frames = [event for event in events[index + 1:next_press]
                          if event.get('phase') == 'inbox-frame' and event.get('screen') == 'Messages'
                          and type(event.get('rowCount')) is int and event['rowCount'] > 0]
        if not visible_frames:
            raise ValueError('A Messages visit has no populated focused-inbox frame before leaving')
        frame = visible_frames[0]
        visits.append({'visit': cycle, 'tabPressAtUnixMs': press['atUnixMs'],
                       'populatedFrameAtUnixMs': frame['atUnixMs'],
                       'tabPressToPopulatedFrameMs': round(frame['atMs'] - press['atMs'], 3)})
    return {'metric': 'JS tab-press to the second requested animation frame with a focused, populated inbox',
            'limitMs': limit_ms, 'visits': visits,
            'budgetReference': 'docs/quality/PERFORMANCE_AND_RELEASE.md: warm native cached content target within one second',
            'maxMs': max(visit['tabPressToPopulatedFrameMs'] for visit in visits),
            'withinLimit': all(visit['tabPressToPopulatedFrameMs'] <= limit_ms for visit in visits),
            'physicalDisplayLatencyMeasured': False,
            'realProviderLatencyMeasured': False,
            'nativeRowLayoutsObserved': sum(event.get('phase') == 'inbox-row-layout' for event in events),
            'visualAcceptance': 'Must also pass the separate actual conversation-content UI assertions.'}


def analyze_reader_commands(commands, started, finished):
    """Keep the original reader deadline observable even if a driver call overruns."""
    if not isinstance(commands, list):
        raise ValueError('Missing recorded reader commands')
    def one(kind, text):
        matches = []
        for row in commands:
            command = row.get('command', {}).get(kind, {})
            selector = command.get('selector', {}) if kind == 'tapOnElement' else command.get('condition', {}).get('visible', {})
            if selector.get('textRegex') == text:
                matches.append(row)
        if len(matches) != 1:
            raise ValueError('Expected exactly one original reader control: ' + text)
        row = matches[0]
        metadata = row.get('metadata', {})
        if (metadata.get('status') != 'COMPLETED' or type(metadata.get('timestamp')) is not int
                or type(metadata.get('duration')) is not int or metadata['duration'] < 0
                or not started <= metadata['timestamp'] <= metadata['timestamp'] + metadata['duration'] <= finished):
            raise ValueError('Reader control was incomplete, malformed or outside this run')
        return row
    controls = [one(kind, text) for kind, text in [
        ('tapOnElement', 'THE SMALL ADVENTURES, 2 memories'),
        ('assertConditionCommand', 'Edit memory book'),
        ('tapOnElement', 'Open book'),
        ('assertConditionCommand', 'Page 1 of 2'),
        ('assertConditionCommand', 'WE TOOK THE LONG WAY HOME'),
        ('tapOnElement', 'Next memory'),
        ('assertConditionCommand', 'Page 2 of 2'),
        ('assertConditionCommand', 'THE STORIES WE KEEP')]]
    if controls[1]['command']['assertConditionCommand'].get('timeout') != '15000':
        raise ValueError('The original reader readiness deadline changed')
    times = [row['metadata']['timestamp'] for row in controls]
    if any(left >= right for left, right in zip(times, times[1:])):
        raise ValueError('Original reader controls did not complete in order')
    ready = controls[1]['metadata']
    elapsed = ready['timestamp'] + ready['duration'] - times[0]
    return {'configuredReadyWaitMs': 15000, 'bookTapToReadyAssertionMs': elapsed,
            'withinOriginalDeadline': elapsed <= 15000, 'bothPagesAndCaptionsCompletedInOrder': True,
            'measurementScope': 'Inclusive test-driver wall time from the book tap through the completed reader-ready assertion; app render latency is not isolated.'}


def analyze_folder(folder, source):
    summary = json.loads((folder / 'summary.json').read_text())
    manifest = json.loads((folder / 'binary-manifest.json').read_text())
    if summary.get('applicationSourceCommit') != source or manifest.get('applicationSourceCommit') != source:
        raise ValueError('Retained app and executed case are not bound to the expected source')
    results = json.loads((folder / 'results.json').read_text())
    matches = [row for row in results if row.get('id') == 'navigation-warm-tabs']
    if len(matches) != 1 or matches[0].get('status') != 'passed':
        raise ValueError('The complete three-visit navigation case did not pass exactly once')
    case = matches[0]
    timing = json.loads((folder / 'navigation-warm-tabs/native-ui-navigation-timing.json').read_text())
    return {'sourceCommit': source, 'platform': summary['platform'], 'navigationCasePassed': True,
            'appTiming': analyze_timing(timing, case['startedAtEpochMs'], case['finishedAtEpochMs']),
            'allExecutedShardCasesPassed': all(row.get('status') == 'passed' for row in results),
            'executedCaseCount': len(results), 'hostedBackendAcceptance': False}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('folder', type=Path)
    parser.add_argument('--source', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = analyze_folder(args.folder, args.source)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))
    return int(not result['appTiming']['withinLimit'])


if __name__ == '__main__':
    raise SystemExit(main())
