#!/usr/bin/env python3
"""Interleave fresh-process reflection runs using a saved baseline host import map."""
import argparse
import json
from pathlib import Path
import statistics
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--baseline-map', type=Path, required=True)
parser.add_argument('--project', type=Path, default=ROOT.parent / 'wmthree')
parser.add_argument('--entry', default='src/scripts/play.wm')
parser.add_argument('--samples', type=int, default=3)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
args.project = args.project.resolve()
args.output = args.output.resolve()
args.output.mkdir(parents=True, exist_ok=True)
report = {'versions': subprocess.check_output(['deno', '--version'], text=True),
          'project': str(args.project), 'entry': args.entry, 'cases': {}}
for sample in range(args.samples):
    labels = ['baseline', 'candidate'] if sample % 2 == 0 else ['candidate', 'baseline']
    for label in labels:
        prefix = args.output / f'{label}-{sample + 1}'
        command = ['deno', 'run', '--config=' + str(ROOT / 'deno.json')]
        if label == 'baseline':
            command.append('--import-map=' + str(args.baseline_map.resolve()))
        command += ['-A', str(ROOT / 'scripts/profile_reflection.ts'), args.entry,
                    '--json=' + str(prefix) + '.json']
        start = time.monotonic()
        result = subprocess.run(command, cwd=args.project, capture_output=True, text=True, timeout=180)
        wall = time.monotonic() - start
        prefix.with_suffix('.log').write_text(result.stdout + '\n' + result.stderr)
        if result.returncode:
            raise RuntimeError(f'{label}: exit {result.returncode}; see {prefix}.log')
        data = json.loads(prefix.with_suffix('.json').read_text())
        if not data['completed']:
            raise RuntimeError(f'{label}: incomplete analysis')
        batches = [e for e in data['events'] if e['kind'] == 'batch']
        info = [e for e in data['events'] if e['kind'] == 'deno-info']
        reads = [e for e in data['events'] if e['kind'] == 'read']
        measurements = {'command': command, 'wall_ms': wall * 1000,
                        'analysis_ms': data['totalMs'], 'phases': data['phases'],
                        'batches': len(batches), 'deno_info_count': len(info),
                        'deno_info_ms': sum(e['milliseconds'] for e in info),
                        'reflection_ms': sum(e['totalMs'] for e in batches),
                        'program_ms': sum(e['programMs'] for e in batches),
                        'diagnostics_ms': sum(e['diagnosticsMs'] for e in batches),
                        'read_ms': sum(e['readMs'] for e in reads)}
        row = report['cases'].setdefault(label, {'samples': []})
        row['samples'].append(measurements)
        row['medians'] = {key: statistics.median(s[key] for s in row['samples']) for key in [
            'wall_ms', 'analysis_ms', 'deno_info_count', 'deno_info_ms', 'reflection_ms',
            'program_ms', 'diagnostics_ms', 'read_ms']}
        (args.output / 'comparison.json').write_text(json.dumps(report, indent=2) + '\n')
        print(f'{sample+1} {label}: {data["totalMs"]:.1f}ms, {len(info)} Deno info calls', flush=True)
