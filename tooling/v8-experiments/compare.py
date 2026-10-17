#!/usr/bin/env python3
"""Interleave unprofiled Deno executions and check complete parser-output hashes."""
import argparse
import json
from pathlib import Path
import re
import statistics
import subprocess
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--case', nargs=2, action='append', required=True)
parser.add_argument('--samples', type=int, default=5)
parser.add_argument('--iterations', type=int, default=2)
parser.add_argument('--corpus', choices=['small', 'large'], default='large')
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
report = {'deno': subprocess.check_output(['deno', '--version'], text=True), 'cases': {}}
reference = None
for sample in range(args.samples):
    cases = args.case if sample % 2 == 0 else list(reversed(args.case))
    for name, artifact in cases:
        command = ['deno', 'run', '-A', str(Path(__file__).with_name('benchmark_parser.ts')), artifact, str(args.iterations), args.corpus]
        start = time.monotonic()
        run = subprocess.run(command, capture_output=True, text=True, check=True, timeout=120)
        if reference is None:
            reference = run.stdout
        if run.stdout != reference:
            raise RuntimeError(f'{name}: parser output mismatch')
        ms = float(re.search(r'parser-ms=([0-9.]+)', run.stderr)[1])
        row = report['cases'].setdefault(name, {'command': command, 'samples': []})
        row['samples'].append({'milliseconds': ms, 'wall_seconds': time.monotonic() - start, 'stdout': run.stdout})
        row['median_ms'] = statistics.median(s['milliseconds'] for s in row['samples'])
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2) + '\n')
        print(f'{sample+1} {name}: {ms:.1f}ms', flush=True)
