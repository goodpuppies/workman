#!/usr/bin/env python3
"""Make a local import-map baseline that restores eager Deno graph discovery."""
import argparse
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('output', type=Path)
args = parser.parse_args()
output = args.output.resolve()
host = ROOT / 'src/ffi/reflect/host.ts'
source = host.read_text()
start_marker = '      const resolveModule = () => {'
end_marker = '      let resolved = resolveModule();'
if source.count(start_marker) != 1 or source.count(end_marker) != 1:
    raise RuntimeError('resolver shape changed; inspect and update this baseline generator')
start, end = source.index(start_marker), source.index(end_marker)
if end <= start or 'const deferDiscovery = isPackageDeclarationFile(containingFile);' not in source[start:end]:
    raise RuntimeError('expected deferred-discovery resolver not found')
source = source[:start] + '''      const resolveModule = () =>
        denoResolvedModule(denoGraphs, moduleName, containingFile) ??
        ts.resolveModuleName(
          moduleName, containingFile, compilerOptions, host, moduleResolutionCache(),
        ).resolvedModule;
''' + source[end:]
source = re.sub(r'(from\s+")(\.[^"]+)(")',
                lambda match: match[1] + (host.parent / match[2]).resolve().as_uri() + match[3], source)
imports = json.loads((ROOT / 'deno.json').read_text())['imports']
imports = {key: (ROOT / value).resolve().as_uri() if value.startswith('.') else value
           for key, value in imports.items()}
output.mkdir(parents=True, exist_ok=True)
snapshot = output / 'host-baseline.ts'
mapping = output / 'baseline-import-map.json'
if snapshot.exists() or mapping.exists():
    raise RuntimeError('baseline files already exist; choose a new output directory')
snapshot.write_text(source)
imports[host.as_uri()] = snapshot.as_uri()
mapping.write_text(json.dumps({'imports': imports}, indent=2) + '\n')
print(mapping)
