"""Build the WM lexer through canonical SubsetML graphs."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess

repository = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--subsetml', type=Path, default=repository.parent / 'SubsetML')
parser.add_argument('--output', type=Path, default=repository / '_scratch/frontend-v3-native')
args = parser.parse_args()
subsetml = args.subsetml.resolve()
output = args.output.resolve()
source = output / 'source'
lowered = output / 'sml'
# This script owns only the staged source tree. Remove stale files from prior graphs.
if source.exists():
    shutil.rmtree(source)
source.mkdir(parents=True, exist_ok=True)
lowered.mkdir(parents=True, exist_ok=True)
frontend = repository / 'tooling/frontend-v3'
for directory in ['src', 'adapters/portable']:
    shutil.copytree(frontend / directory, source / directory, dirs_exist_ok=True)
(source / 'tools').mkdir(exist_ok=True)
shutil.copy2(frontend / 'tools/native-lex.wm', source / 'tools/native-lex.wm')
# The frontend imports the Basis as "basis/x.wm"; sml-entry resolves those to this generated graph.
basis = source / 'basis'
basis.mkdir(parents=True, exist_ok=True)
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
    source / 'tools/native-lex.wm',
], check=True)
subprocess.run(['mlton', '-output', output / 'native-lex', lowered / 'project.mlb'], check=True)
print(output / 'native-lex')
