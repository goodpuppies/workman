#!/usr/bin/env python3
"""Build WON's conformance probe natively (MLton) and as JS, from one SubsetML source. No downloads.

WON is the SubsetWon Basis module. The probe is SubsetML's tests/basis/won_probe.sml: it is
compiled with MLton directly, and translated to WM and compiled to JS. won.mjs is the
snapshot's generated subset_won.wm, the module WM programs import.
"""
import argparse
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[3]
BASIS = ROOT / "tooling/frontend-v3/lib/subsetml"
p = argparse.ArgumentParser(description=__doc__)
p.add_argument("output", type=Path)
p.add_argument("--subsetml", type=Path, default=ROOT.parent / "SubsetML/bin/subsetml")
a = p.parse_args()
out = a.output.resolve()
out.mkdir(parents=True, exist_ok=True)
subsetml = a.subsetml.resolve()
repository = subsetml.parents[1]
modules = subprocess.run(["python3", "scripts/basis-sources.py"], cwd=repository,
                         capture_output=True, text=True, check=True).stdout.split()
probe = "tests/basis/won_probe.sml"

wm = out / "wm"
wm.mkdir(exist_ok=True)
subprocess.run([str(subsetml), "wm", str(wm), *modules, probe], check=True, cwd=repository)
subprocess.run(["sh", "scripts/stage-text-host.sh", str(wm)], check=True, cwd=repository)

hosts = {"subset_host.sml": "lib/subset_host.sml", "subset_text_host.sml": "lib/subset_text_host.sml"}
native = out / "native"
native.mkdir(exist_ok=True)
(native / "main.sml").write_text('''val mode = case CommandLine.arguments () of [s] => s | _ => "normalize"
val input = TextIO.inputAll TextIO.stdIn
val (success, output) = WonProbe.run (mode, input)
val _ = if success then (TextIO.output (TextIO.stdOut, output ^ "\\n"); OS.Process.exit OS.Process.success)
        else (TextIO.output (TextIO.stdErr, output ^ "\\n"); OS.Process.exit OS.Process.failure)
''')
(native / "run.mlb").write_text("\n".join(["$(SML_LIB)/basis/basis.mlb",
    *[str(repository / hosts.get(Path(m).name, m)) for m in modules],
    str(repository / probe), "main.sml", ""]))
subprocess.run(["mlton", "-output", str(out / "won-native"), str(native / "run.mlb")], check=True)
subprocess.run(["deno", "run", "-A", "src/main.ts", "compile-library",
    str(wm / "won_probe.wm"), str(out / "probe.mjs")], check=True, cwd=ROOT)
subprocess.run(["deno", "run", "-A", "src/main.ts", "compile-library",
    str(BASIS / "subset_won.wm"), str(out / "won.mjs")], check=True, cwd=ROOT)
print(out)
