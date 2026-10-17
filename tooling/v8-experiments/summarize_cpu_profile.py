#!/usr/bin/env python3
"""Aggregate Deno/V8 CPU samples across recursive calling contexts.

Use timeDeltas rather than node hitCount. Inclusive times count a source frame
only once per sample, so recursive occurrences do not inflate percentages.
"""
import argparse
from collections import Counter
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('profile', type=Path)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
profile = json.loads(args.profile.read_text())
nodes = {node['id']: node for node in profile['nodes']}
parents = {child: node['id'] for node in nodes.values() for child in node.get('children', [])}
frames = {node_id: (node['callFrame']['functionName'], node['callFrame']['url'], node['callFrame']['lineNumber'] + 1, node['callFrame']['columnNumber'] + 1) for node_id, node in nodes.items()}
self_time = Counter()
inclusive = Counter()
for node_id, delta in zip(profile['samples'], profile['timeDeltas']):
    self_time[frames[node_id]] += delta
    seen = set()
    while node_id in nodes:
        seen.add(frames[node_id])
        node_id = parents.get(node_id, -1)
    for frame in seen:
        inclusive[frame] += delta
total = sum(self_time.values())
def rows(counter):
    return [{'function': key[0], 'url': key[1], 'line': key[2], 'column': key[3], 'milliseconds': delta / 1000, 'percent': delta * 100 / total} for key, delta in counter.most_common()]
report = {'profile': str(args.profile), 'total_sampled_ms': total / 1000, 'samples': len(profile['samples']), 'self': rows(self_time), 'inclusive': rows(inclusive)}
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(report, indent=2) + '\n')
for key in ['self', 'inclusive']:
    print(key.upper())
    for row in report[key][:25]:
        print(f'{row["percent"]:6.2f}% {row["milliseconds"]:8.1f}ms {row["function"]} {row["url"][-70:]}:{row["line"]}')
