"""Check parser-facing modules and build the WM lexer through canonical SubsetML graphs."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess

repository = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--subsetml', type=Path, default=repository.parent / 'SubsetML')
parser.add_argument('--output', type=Path, default=repository / '_scratch/frontend-v3-native')
parser.add_argument('--type-driver', action='store_true', help='also build the type-parser snapshot driver')
args = parser.parse_args()
subsetml = args.subsetml.resolve()
output = args.output.resolve()
source = output / 'source'
lowered = output / 'sml'
source.mkdir(parents=True, exist_ok=True)
lowered.mkdir(parents=True, exist_ok=True)
frontend = repository / 'tooling/frontend-v3'
for directory in ['src', 'adapters/portable']:
    shutil.copytree(frontend / directory, source / directory, dirs_exist_ok=True)
(source / 'tools').mkdir(exist_ok=True)
shutil.copy2(frontend / 'tools/native-lex.wm', source / 'tools/native-lex.wm')
shutil.copy2(frontend / 'tools/native-type.wm', source / 'tools/native-type.wm')
basis = source / 'lib/subsetml'
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
    '--panic-runtime', basis / 'subset_process.wm',
    '--native-adapter', basis / 'subset_host.wm', subsetml / 'lib/subset_host.sml', 'SubsetHost',
    '--native-adapter', basis / 'subset_text_host.wm', subsetml / 'lib/subset_text_host.sml', 'SubsetTextHost',
    source / 'tools/native-lex.wm',
], check=True)
# The lexer does not depend on the surface AST. Check its actual independent closure too,
# so the default frontend build cannot silently leave parser-facing types untranslatable.
surface = output / 'surface-sml'
surface.mkdir(parents=True, exist_ok=True)
subprocess.run([
    subsetml / 'bin/subsetml', 'sml-entry', surface,
    '--native-adapter', basis / 'subset_text_host.wm', subsetml / 'lib/subset_text_host.sml', 'SubsetTextHost',
    source / 'src/surface/ast.wm',
], check=True)
subprocess.run(['mlton', '-stop', 'tc', surface / 'project.mlb'], check=True)
# The type parser consumes the cursor and AST. Its invariant assertions use the same
# selected panic runtime and native adapters as the lexer.
parser_graph = output / 'parser-sml'
parser_graph.mkdir(parents=True, exist_ok=True)
subprocess.run([
    subsetml / 'bin/subsetml', 'sml-entry', parser_graph,
    '--panic-runtime', basis / 'subset_process.wm',
    '--native-adapter', basis / 'subset_host.wm', subsetml / 'lib/subset_host.sml', 'SubsetHost',
    '--native-adapter', basis / 'subset_text_host.wm', subsetml / 'lib/subset_text_host.sml', 'SubsetTextHost',
    source / 'src/parser/type.wm',
], check=True)
subprocess.run(['mlton', '-stop', 'tc', parser_graph / 'project.mlb'], check=True)
if args.type_driver:
    type_driver = output / 'type-driver-sml'
    type_driver.mkdir(parents=True, exist_ok=True)
    subprocess.run([
        subsetml / 'bin/subsetml', 'sml-entry', type_driver,
        '--panic-runtime', basis / 'subset_process.wm',
        '--native-adapter', basis / 'subset_host.wm', subsetml / 'lib/subset_host.sml', 'SubsetHost',
        '--native-adapter', basis / 'subset_text_host.wm', subsetml / 'lib/subset_text_host.sml', 'SubsetTextHost',
        source / 'tools/native-type.wm',
    ], check=True)
    subprocess.run(['mlton', '-output', output / 'native-type', type_driver / 'project.mlb'], check=True)
subprocess.run(['mlton', '-output', output / 'native-lex', lowered / 'project.mlb'], check=True)
print(output / 'native-lex')
