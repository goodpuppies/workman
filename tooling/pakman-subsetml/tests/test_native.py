#!/usr/bin/env python3
"""Real WM -> SubsetML -> MLton package lifecycle and refusal cases."""
from pathlib import Path
import hashlib
import os
import shutil
import subprocess
import tempfile

repo = Path(__file__).resolve().parents[1]
subset = repo.parents[2] / "SubsetML"

def call(args, env, success=True):
    result = subprocess.run([str(x) for x in args], env=env, capture_output=True,
                            text=True, timeout=90)
    if (result.returncode == 0) != success:
        raise AssertionError((args, result.returncode, result.stdout, result.stderr))
    return result

with tempfile.TemporaryDirectory(prefix="pakman-native-") as temporary:
    base = Path(temporary)
    stage = base / "stage"
    subprocess.run(["python3", str(repo / "scripts/stage.py"), str(stage)], check=True)
    env = dict(os.environ, PAKMAN_PKGS=str(stage / "paks"),
               PAKMAN_BUILD_WM=str(stage / "scripts/build-wm.sh"),
               PAKMAN_RUN_IMAGE=str(stage / "scripts/run-image.sh"),
               PAKMAN_SUBSETML=str(subset / "bin/subsetml"))
    root = base / "prefix ' with $ literal"
    state = base / "state space"
    command = [stage / "bin/pakman"]
    def cli(*args, good=True, prefix=root):
        return call([*command, *args, "--root", prefix, "--state", state], env, good)
    cli("install", "hello", "1.0")
    assert call([root / "bin/hello"], env).stdout == "hello from native pakman\n"
    assert cli("list").stdout == "hello 1.0\n"
    manifest = root / ".pakman/owned/hello"
    assert hashlib.sha256((root / "lib/hello/hello.img").read_bytes()).hexdigest() in manifest.read_text()
    cli("install", "hello", "1.0", good=False)
    launcher = root / "bin/hello"
    original = launcher.read_bytes()
    launcher.write_bytes(original + b"# user edit\n")
    assert "modified installed file" in cli("remove", "hello", good=False).stderr
    assert manifest.exists() and (root / "lib/hello/hello.img").exists()
    launcher.write_bytes(original)
    image = root / "lib/hello/hello.img"
    saved = image.with_suffix(".saved")
    image.rename(saved)
    image.symlink_to(saved)
    cli("remove", "hello", good=False)
    assert manifest.exists() and launcher.exists()
    image.unlink(); saved.rename(image)
    cli("remove", "hello")
    assert not launcher.exists() and not image.exists() and not manifest.exists()
    assert cli("list").stdout == ""

    # Operations keep a compact list spelling; `package` writes them as the WON plan.
    def quote(text):
        escapes = {'"': '\\"', "\\": "\\\\", "\n": "\\n", "\r": "\\r", "\t": "\\t"}
        return '"' + "".join(escapes.get(c, f"\\x{ord(c):02x}" if ord(c) < 32 or ord(c) == 127 else c)
                             for c in text) + '"'
    def argument(text):
        kind, _, value = text.partition(":")
        return kind.capitalize() + "(" + quote(value) + ")"
    def operation(op):
        kind, *rest = op
        if kind == "build":
            return f"Build{{program = {quote(rest[0])} args = [{' '.join(map(argument, rest[1:]))}]}}"
        if kind in ("install", "install-tree"):
            name = "Install" if kind == "install" else "InstallTree"
            return f"{name}{{source = {quote(rest[0])} dest = {quote(rest[1])} mode = {rest[2].capitalize()}}}"
        return f"Launcher{{image = {quote(rest[0])} dest = {quote(rest[1])}}}"
    def package(name, operations):
        directory = stage / "paks" / name; directory.mkdir()
        program = directory / "pak"
        sources = " ".join(f"{{file = {quote(op[1])} path = {quote(op[2])}}}" for op in operations if op[0] == "source")
        install = " ".join(operation(op) for op in operations if op[0] != "source")
        text = (f"Plan<protocol = 1>{{name = {quote(name)} version = \"1\" "
                f"sources = [{sources}] install = [{install}]}}\n")
        raw(name, text)
    def raw(name, text):
        directory = stage / "paks" / name; directory.mkdir(exist_ok=True)
        program = directory / "pak"
        program.write_text("#!/bin/sh\ncat <<'PAKMAN_TEST_PLAN'\n" + text + "PAKMAN_TEST_PLAN\n")
        program.chmod(0o755)
    # A stale package and an unknown operation are refused, naming where the problem is.
    raw("stale", 'Plan<protocol = 0>{name = "stale" version = "1" sources = [] install = []}\n')
    assert "Plan<protocol = 1>" in cli("install", "stale", "1", good=False).stderr
    raw("unknown", 'Plan<protocol = 1>{name = "unknown" version = "1" sources = [] install = [Explode]}\n')
    assert "install[0]" in cli("install", "unknown", "1", good=False).stderr
    # Trees use the same per-file ownership and all-or-nothing validation.
    tree_build = ["build", "/bin/sh", "literal:-c",
                  "literal:mkdir -p \"$1/tree/nested\"; printf alpha > \"$1/tree/a file\"; printf beta > \"$1/tree/nested/b\"",
                  "literal:tree-build", "out:tree-parent"]
    package("tree", [tree_build, ["install-tree", "tree-parent/tree", "share/tree", "data"]])
    cli("install", "tree", "1")
    assert (root / "share/tree/a file").read_text() == "alpha"
    tree_file = root / "share/tree/nested/b"
    tree_file.write_text("edited")
    cli("remove", "tree", good=False)
    assert (root / "share/tree/a file").exists()
    tree_file.write_text("beta")
    cli("remove", "tree")
    assert not tree_file.exists() and not (root / "share/tree/a file").exists()
    package("tree-link", [["build", "/bin/sh", "literal:-c",
        "literal:mkdir -p \"$1\"; ln -s /etc/passwd \"$1/link\"", "literal:tree-build", "out:tree"],
        ["install-tree", "tree", "share/refused", "data"]])
    cli("install", "tree-link", "1", good=False)
    assert not (root / "share/refused/link").exists()
    package("tree-overlap", [tree_build,
        ["install-tree", "tree-parent/tree", "share/tree", "data"],
        ["install", "tree-parent/tree/nested/b", "share/tree/nested/b", "data"]])
    assert "overlapping" in cli("install", "tree-overlap", "1", good=False).stderr

    package("broken", [["build", "/bin/sh", "literal:-c", "literal:printf deliberate-failure >&2; exit 7"],
                       ["install", "missing", "bin/broken", "exec"]])
    failure = cli("install", "broken", "1", good=False)
    assert "deliberate-failure" in failure.stderr, failure
    assert not (root / "bin/broken").exists() and not (root / ".pakman/lock").exists()
    before = set((state / "store").iterdir())
    env["PAKMAN_KEEP_FAILED_BUILDS"] = "1"
    retained = cli("install", "broken", "1", good=False)
    del env["PAKMAN_KEEP_FAILED_BUILDS"]
    saved_builds = set((state / "store").iterdir()) - before
    assert len(saved_builds) == 1 and "retained failed build:" in retained.stderr
    assert (next(iter(saved_builds)) / "work").is_dir()
    assert not (root / ".pakman/lock").exists()
    package("escape", [["install", "x", "../escaped", "data"]])
    cli("install", "escape", "1", good=False)
    package("source-escape", [["source", "x", "../hello/hello.wm"], ["install", "x", "bin/x", "data"]])
    cli("install", "source-escape", "1", good=False)
    package("arg-escape", [["build", "/bin/sh", "out:../escape"], ["install", "x", "bin/x", "data"]])
    cli("install", "arg-escape", "1", good=False)
    conflict = base / "conflict"; (conflict / "lib/hello").mkdir(parents=True)
    unowned = conflict / "lib/hello/hello.img"; unowned.write_bytes(b"not owned")
    cli("install", "hello", "1.0", good=False, prefix=conflict)
    assert unowned.read_bytes() == b"not owned" and not (conflict / "bin/hello").exists()
    linked = base / "linked"; linked.mkdir()
    outside = base / "outside"; outside.mkdir()
    (linked / "bin").symlink_to(outside, target_is_directory=True)
    cli("install", "hello", "1.0", good=False, prefix=linked)
    assert not list(outside.iterdir())
    (root / ".pakman/lock").mkdir()
    cli("install", "hello", "1.0", good=False)
    assert (root / ".pakman/lock").is_dir()
    (root / ".pakman/lock").rmdir()

    # Compile the actual adapter with a full SML contract harness.
    host_mlb = base / "host.mlb"
    host_mlb.write_text('$(SML_LIB)/basis/basis.mlb\n' + "\n".join(
        '"' + str(p) + '"' for p in [stage / "generated/pakman/subset_result.sml",
            subset / "lib/sml-basis/subset_host.sml", repo / "native/host.sml", repo / "tests/host.sml"]) + "\n")
    subprocess.run(["mlton", "-output", str(base / "host"), str(host_mlb)], check=True)
    assert "PAKMAN_HOST_OK" in call([base / "host"], env).stdout
    print("Native pakman: real package build/install/run/list/remove, ownership refusals, path checks, lock and host contract passed")
