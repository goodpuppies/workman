"""Build frontend-v2's format tool natively: translate it through SubsetML and compile with MLton.

The frontend reaches the host through two modules, host/memo.wm and host/text.wm, which call
JavaScript. The staged copy replaces them with their checker interfaces in native/, and the
build links the native SML implementations from native/ in their place.
"""
import argparse
import json
from pathlib import Path
import shutil
import subprocess

repository = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--subsetml', type=Path, default=repository / 'subm/SubsetML')
parser.add_argument('--output', type=Path, default=repository / '_scratch/frontend-v2-native')
args = parser.parse_args()
subsetml = args.subsetml.resolve()
output = args.output.resolve()
frontend = repository / 'tooling/frontend-v2'
source = output / 'source'
lowered = output / 'sml'
# This script owns only the staged source tree and lowered output. Remove stale graphs.
for directory in [source, lowered]:
    if directory.exists():
        shutil.rmtree(directory)
    directory.mkdir(parents=True)
shutil.copytree(frontend, source / 'frontend-v2', dirs_exist_ok=True,
                ignore=shutil.ignore_patterns('generator', 'native', '*.mjs', '*.md', '*.json'))
staged = source / 'frontend-v2'
adapters = []
for name, structure in [('memo', 'FrontendMemo'), ('text', 'FrontendText')]:
    checker = staged / 'host' / f'{name}.wm'
    shutil.copy2(frontend / 'native' / f'{name}.wm', checker)
    adapters += ['--native-adapter', checker, frontend / 'native' / f'{name}.sml', structure]

# The frontend imports the Basis as "basis/x.wm"; sml-entry resolves those to this generated graph.
basis = source / 'basis'
basis.mkdir()
inventory = json.loads((subsetml / 'docs/basis-dependencies.json').read_text())['modules']
files = ['src/subset_text_host.sml']
for name, module in inventory.items():
    files.append(module['source'])
    if name == 'SubsetResult':
        files.append('src/subset_host.sml')
subprocess.run([subsetml / 'bin/subsetml', 'wm', basis, *files], cwd=subsetml, check=True)
subprocess.run([
    subsetml / 'bin/subsetml', 'sml-entry', lowered,
    '--basis', basis,
    '--panic-runtime', basis / 'subset_process.wm',
    '--native-adapter', basis / 'subset_host.wm', subsetml / 'lib/subset_host.sml', 'SubsetHost',
    '--native-adapter', basis / 'subset_text_host.wm', subsetml / 'lib/subset_text_host.sml', 'SubsetTextHost',
    *adapters,
    staged / 'tools/format.wm',
], check=True)
subprocess.run(['mlton', '-output', output / 'frontend-v2-format', lowered / 'project.mlb'], check=True)
print(output / 'frontend-v2-format')
