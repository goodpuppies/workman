#!/usr/bin/env python3
"""Stage the WM port and independent package programs for MLton or MLWorks.

The desktop compiler translates WM; no WM/JS compiler is invoked. MLWorks
staging emits ordinary SML and projects, not MIPS objects. Build those on PS2.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import re
import shlex
import shutil
import subprocess

repo = Path(__file__).resolve().parents[1]
git_root = repo.parents[2]
subset = git_root / "SubsetML"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("output", type=Path)
parser.add_argument("--target", choices=("mlton", "mlworks"), default="mlton")
parser.add_argument("--subsetml", type=Path, default=subset / "bin/subsetml")
parser.add_argument("--prefix", help="installation path on the target machine")
parser.add_argument("--packages-prefix", help="target package catalog (defaults to PREFIX/paks)")
parser.add_argument("--package", action="append", default=[], metavar="NAME=PAK_WM",
                    help="include an external package alongside hello")
parser.add_argument("--library-path", default="/home/ellie/testingstuff/mlworks-r5900/target-objects")
args = parser.parse_args()
output = args.output.resolve()
prefix = args.prefix or str(output)
packages_prefix = args.packages_prefix or prefix + "/paks"
packages = {"hello": repo / "paks/hello/pak.wm"}
for specification in args.package:
    name, separator, source = specification.partition("=")
    if not separator or not re.fullmatch(r"[A-Za-z0-9_-][A-Za-z0-9_.-]*", name) or name == "pakman" or name in packages:
        parser.error("--package requires a unique safe NAME=PAK_WM")
    entry = Path(source).resolve()
    if not entry.is_file() or entry.name != "pak.wm":
        parser.error("external package entry must be an existing pak.wm")
    packages[name] = entry
output.mkdir(parents=True, exist_ok=True)
for directory in ("bin", "scripts", "generated", *("paks/" + name for name in packages)):
    (output / directory).mkdir(parents=True, exist_ok=True)

# Keep a portable source layout for a later local WM retranslation on PS2.
sources = output / "sources"
port_sources = sources / "wm-mini/tooling/pakman-subsetml"
for directory in ("src", "native", "paks"):
    shutil.copytree(repo / directory, port_sources / directory, dirs_exist_ok=True)
shutil.copy2(repo / "pakman.wm", port_sources / "pakman.wm")
for name in ("lib/mlworks/checker/subset_host.wm", "lib/sml-basis/subset_host.sml"):
    target = sources / "SubsetML" / name
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(subset / name, target)

# "basis/x.wm" imports resolve to this generated Basis graph, staged with the sources.
basis = sources / "basis"
basis.mkdir(parents=True, exist_ok=True)
inventory = json.loads((subset / "docs/basis-dependencies.json").read_text())["modules"]
basis_files = ["src/subset_text_host.sml"]
for module_name, module in inventory.items():
    basis_files.append(module["source"])
    if module_name == "SubsetResult":
        basis_files.append("src/subset_host.sml")
subprocess.run([str(args.subsetml.resolve()), "wm", str(basis), *basis_files], cwd=subset, check=True)

spec = importlib.util.spec_from_file_location("mlworks_project", subset / "scripts/mlworks_project.py")
project = importlib.util.module_from_spec(spec)
spec.loader.exec_module(project)

def stage(name, entry, structure):
    directory = output / "generated" / name
    directory.mkdir(parents=True, exist_ok=True)
    # This is generated output. Stale current-directory .mo links can make
    # MLWorks resolve an old object instead of rebuilding changed source.
    for old in directory.glob("*.mo"):
        if old.is_symlink():
            old.unlink()
    shutil.rmtree(directory / "objects", ignore_errors=True)
    shutil.rmtree(directory / "DEPEND", ignore_errors=True)
    for old in directory.glob("*.sml"):
        old.unlink()
    subprocess.run([str(args.subsetml.resolve()), "sml-entry", str(directory),
                    "--basis", str(basis),
                    "--native-adapter", str(subset / "lib/mlworks/checker/subset_host.wm"),
                    str(subset / "lib/sml-basis/subset_host.sml"), "SubsetHost",
                    "--native-adapter", str(basis / "subset_text_host.wm"),
                    str(subset / "lib/subset_text_host.sml"), "SubsetTextHost",
                    "--native-adapter", str(repo / "src/host.wm"),
                    str(repo / "native/host.sml"), "PakmanHost", str(entry)], check=True)
    if args.target == "mlton":
        (directory / "driver.sml").write_text(f"val _ = {structure}.main ()\n")
        (directory / "run.mlb").write_text(
            f'"{directory / "project.mlb"}"\n"{directory / "driver.sml"}"\n')
        executable = output / ("bin/pakman" if name == "pakman" else f"paks/{name}/pak")
        subprocess.run(["mlton", "-output", str(executable), str(directory / "run.mlb")], check=True)
    else:
        # Generated dependency metadata is the authority for the flat object graph.
        texts = {p.name: p.read_text() for p in directory.glob("*.sml")}
        dependencies = {n: re.findall(r'^from "\./([^"/]+\.sml)" import', t, re.M)
                        for n, t in texts.items()}
        ordered = []
        visiting = set()
        def visit(n):
            if n in ordered:
                return
            if n in visiting:
                raise ValueError("module cycle: " + n)
            visiting.add(n)
            for dep in dependencies[n]:
                visit(dep)
            visiting.remove(n)
            ordered.append(n)
        for n in texts:
            visit(n)
        for n in ordered:
            requires = ['require "require_all";']
            requires += [f'require "pkm_{Path(dep).stem}";' for dep in dependencies[n]]
            body = texts[n]
            if n == "subset_host.sml":
                body = (subset / "lib/sml-basis/subset_host.sml").read_text()
            elif n == "subset_text_host.sml":
                body = (subset / "lib/subset_text_host.sml").read_text()
            elif n == "host.sml":
                requires.append('require "__unix";')
                body = (repo / "native/host.sml").read_text() + "\nstructure Host = PakmanHost\n"
            (directory / ("pkm_" + n)).write_text("\n".join(requires) + "\n" + body)
            (directory / n).unlink()
        (directory / "pkm_app_entry.sml").write_text(
            f'require "require_all";\nrequire "pkm_{entry.stem}";\n'
            'val deliver : string * (unit -> unit) -> unit =\n'
            '  MLWorks.Internal.Runtime.environment "application image deliver and exit"\n'
            'val _ = MLWorks.Deliver.with_delivery_hook\n'
            '  (fn _ => fn (name, main, _) => deliver (name, main))\n'
            '  MLWorks.Deliver.deliver\n'
            f'  (valOf (OS.Process.getEnv "PAKMAN_DELIVERY_IMAGE"), {structure}.main, MLWorks.Deliver.CONSOLE)\n')
        names = [*("pkm_" + n for n in ordered), "pkm_app_entry.sml"]
        (directory / "project.mlp").write_text(
            project.project_text("project.mlp", names, "pkm_app_entry.sml", args.library_path))
        (directory / "project.mlb").unlink()
        destination = output / ("bin/pakman" if name == "pakman" else f"paks/{name}/pak")
        base = ('base=$(CDPATH= cd -- "$(dirname -- "$0")/../" && pwd)\n'
                if name == "pakman" else f'base={shlex.quote(prefix)}\n')
        destination.write_text(
            '#!/bin/sh\nset -eu\n'
            + base +
            f'exec "$base/scripts/run-image.sh" "$base/generated/{name}/program.img" "$@"\n')
        destination.chmod(0o755)

stage("pakman", repo / "pakman.wm", "Pakman")
for name, entry in packages.items():
    shutil.copytree(entry.parent, output / "paks" / name, dirs_exist_ok=True,
                    ignore=shutil.ignore_patterns("pak", ".git", ".build", "__pycache__"))
    stage(name, entry, "Pak")
selected = "desktop" if args.target == "mlton" else "mlworks"
for source, destination in [(f"build-wm-{selected}.sh", "build-wm.sh"),
                            (f"run-image-{selected}.sh", "run-image.sh")]:
    shutil.copy2(repo / "scripts" / source, output / "scripts" / destination)
    (output / "scripts" / destination).chmod(0o755)
if args.target == "mlworks":
    for name in ("build-project-mlworks.sh", "subsetml-mlworks.sh", "deliver-compiler-mlworks.sh"):
        shutil.copy2(repo / "scripts" / name, output / "scripts" / name)
        (output / "scripts" / name).chmod(0o755)
    shutil.copy2(git_root / "mlworks/tools/scripts/run-memory-limited.sh",
                 output / "scripts/run-memory-limited.sh")
(output / "env.sh").write_text("\n".join(
    f"export {key}={shlex.quote(value)}" for key, value in {
        "PAKMAN_PKGS": packages_prefix,
        "PAKMAN_BUILD_WM": prefix + "/scripts/build-wm.sh",
        "PAKMAN_RUN_IMAGE": prefix + "/scripts/run-image.sh",
        "PAKMAN_SUBSETML": str(args.subsetml.resolve()) if args.target == "mlton" else
            prefix + "/scripts/subsetml-mlworks.sh",
    }.items()) + "\n")
print(output)
