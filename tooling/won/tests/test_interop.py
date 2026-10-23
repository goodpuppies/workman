#!/usr/bin/env python3
"""Compile once; exchange WON between independent MLton and WM/JS processes."""
from pathlib import Path
import os
import random
import subprocess
import tempfile

WON = Path(__file__).resolve().parents[1]
ROOT = WON.parents[1]

def call(command, data=b"", success=True):
    result = subprocess.run(list(map(str, command)), input=data, capture_output=True, timeout=30)
    assert (result.returncode == 0) == success, (command, data[:100], result.returncode, result.stderr)
    if success:
        assert result.stderr == b"", result.stderr
    else:
        assert result.stdout == b"", result.stdout
    return result.stdout if success else result.stderr

with tempfile.TemporaryDirectory(prefix="won-interop-") as directory:
    out = Path(directory)
    subprocess.run(["python3", str(WON / "scripts/build.py"), str(out)], check=True, cwd=ROOT)
    subprocess.run(["deno", "test", "--allow-read", str(WON / "tests/interop_test.ts"),
                    "--", str(out / "won.mjs")], check=True, cwd=ROOT)
    # The Zig reader is written from the specification alone; it must agree
    # with the WM implementation on every accepted and rejected document.
    subprocess.run(["zig", "build", "-Doptimize=ReleaseSafe", "--prefix", str(out / "zig"),
                    "--cache-dir", str(out / "zig-cache"), "--global-cache-dir", str(out / "zig-global")],
                   check=True, cwd=WON / "zig")
    subprocess.run(["zig", "build", "test", "--cache-dir", str(out / "zig-cache"),
                    "--global-cache-dir", str(out / "zig-global")], check=True, cwd=WON / "zig")
    zig = [out / "zig/bin/won-zig"]
    # The Rust crate is a serde format; its edge tests pin how serde features meet WON.
    cargo = {"cwd": WON / "rust", "check": True, "env": {**os.environ, "CARGO_TARGET_DIR": str(out / "rust")}}
    subprocess.run(["cargo", "build", "--offline", "--quiet"], **cargo)
    subprocess.run(["cargo", "test", "--offline", "--quiet"], **cargo)
    rust = [out / "rust/debug/won-rust"]
    native = [out / "won-native"]
    js = ["deno", "run", "--allow-read", str(WON / "scripts/run-js.mjs"), out / "probe.mjs"]
    for backend in (native, js):
        assert call(backend + ["selftest"]) == b"ok\n"
    # Both directions: independently construct the request; recipient validates
    # its complete value, returns a different value; origin validates the reply.
    for sender, receiver in ((native, js), (js, native)):
        request = call(sender + ["emit"])
        reply = call(receiver + ["reply"], request)
        assert call(sender + ["check"], reply) == b"ok\n"
    assert call(native + ["emit"]) == call(js + ["emit"])
    example = (WON / "examples/app-config.won").read_bytes()
    cases = [example, b'null', b'true', b'false', b'[]', b'{}', b'Ready',
        b'[Ready [1 2] X{}]',
        b'{"arbitrary key" = "hello\\nworld" blob = x"00ff"}',
        b'/* /* nested */ comment */ Button<enabled = true>("Save") // end',
        b'[0 -0 123 -45 1.0 0.01 1e400 1e-400 9999999999999999999999999]',
        'Paragraph["Hei ä 😀" Em("bold") " tail"]'.encode(),
        b'Tag<name = Inner<version = 1>{key = [true false]}>[Child]',
        b'X(42)', b'X(true)', b'X("text")', b'X(x"00ff")', b'X(Inner[1])',
        b'[1// line comment\r2]', b'[1// line comment\r\n2]',
        b'X[]', b'X{}', b'X<id=1>', b'X<id=1>[1]', b'X<id=1>{a=1}',
        b'{""=0 "two words"=1 "a-b"=2 "a.b"=3}',
        '{"käyttäjä" = "Ellie"}'.encode(),
        b'"\\x00\\x01\\x7f\\n\\r\\t\\\\\\\""',
        b'[' + b' '.join([b'1'] * 1000) + b']',
        b'/*' * 1000 + b'*/' * 1000 + b' true',
        b'/* ok */ ' * 2000 + b'true',
        b'{' + b' '.join(f'key{i} = {i}'.encode() for i in range(1000)) + b'}',
        b'[' * 128 + b'null' + b']' * 128,
        # Commas are whitespace: optional, repeatable, and never required.
        b'[1,2]', b'[1, 2,]', b'[,]', b'{a = 1, b = 2,}', b'X<a = 1, b = 2>[1, 2]',
        b'[Ready,[1 2]]', b'{a=1,b=2}', b'[1,/* c */,2]']
    # Real Stageforge-style envelopes exercise the grammar without a live actor.
    cases.append((WON / "examples/stageforge.won").read_bytes())
    # Number values use JSON's grammar and preserve their token spelling exactly.
    exponent_spellings = [b'1e0', b'1e-0', b'1e00', b'1e-00', b'1e01', b'1e-01',
        b'1E2', b'1e+2', b'1E+02', b'-0.5E-3']
    cases += exponent_spellings
    for backend in (native, js, zig):
        for spelling in exponent_spellings:
            assert call(backend + ["normalize"], spelling) == spelling + b"\n"
    # Deterministic generated nested documents: syntax must retain every leaf.
    rng = random.Random(42)
    def generated(depth):
        if depth == 0:
            return rng.choice([b'null', b'true', b'-1.234e500', b'"a\\n\\x00"', b'x"00ff80"', b'Bare'])
        children = [generated(depth - 1) for _ in range(3)]
        return rng.choice([b'[' + b' '.join(children) + b']',
            b'{a = ' + children[0] + b' b = ' + children[1] + b'}',
            b'Node<id = 1>[' + children[0] + b']'])
    cases += [generated(4) for _ in range(30)]
    for source in cases:
        a = call(native + ["normalize"], source)
        b = call(js + ["normalize"], source)
        assert a == b, (source, a, b)
        assert call(native + ["normalize"], b) == a
        assert call(js + ["normalize"], a) == b
        assert call(zig + ["normalize"], source) == a, (source, a)
        assert call(rust, source) == a, (source, a)
    invalid = [b'', b'/*', b'/* /* */', b'[1 2', b'{x 1}', b',', b'1,2', b'X,(1)',
        b'{x=1 x=2}', b'X<a=1 a=2>', b'{"two words"=1 "two words"=2}', b'[01]', b'[-01]',
        b'1.', b'1e', b'1e+', b'1E', b'1E-', b'1e+-2', b'1ee2', b'1.e2', b'1e2.5', b'.5', b'+1', b'NaN()', b'X()', b'X(1 2)',
        b'x"0"', b'x"gg"', b'"\\q"', b'"\\xzz"', b'"\x00"', b'"\xff"',
        b'"\xc0\x80"', b'"\xed\xa0\x80"', b'"\xf4\x90\x80\x80"',
        b'"\\xff"', b'true false', b'[1true]', b'["a""b"]', b'{x=1y=2}',
        b'X<id=1> ("payload")',
        b'b"hello"', b'X(null)', b'X([1])', b'X({a=1})',
        b'X<>', b'X<>("text")', b'X<>[]', b'X<id=1>(null)',
        b'X<id=1>([1])', b'X<id=1>({a=1})',
        b'[Outer(Inner({}))]', b'{value = X(null)}', b'X<a = Y<>>',
        b'{"name" = "Alice"}', b'X<"id"=1>',
        b'x"FF"', b'"\\x0A"', b'"\\x0a"', b'"\\x41"', b'"\\xc3\\xa9"', b'[' * 130 + b'0' + b']' * 130]
    # NaN is an ordinary tag name, but empty parentheses are always invalid.
    for source in invalid:
        a = call(native + ["normalize"], source, success=False)
        b = call(js + ["normalize"], source, success=False)
        assert a == b, (source, a, b)
        call(zig + ["normalize"], source, success=False)
        call(rust, source, success=False)
    # Rust drives the Zig peer over pipes; every line either side wrote must
    # already be canonical by the WM implementation's standard.
    transcript = out / "ipc.won"
    subprocess.run([out / "rust/debug/ipc-driver", out / "zig/bin/won-zig-peer", transcript], check=True)
    lines = transcript.read_bytes().splitlines()
    malformed = b"{id = 12 body = "
    for line in lines:
        if line != malformed:
            assert call(native + ["normalize"], line) == line + b"\n", line[:200]
    assert malformed in lines
    for backend in (native, js):
        call(backend + ["reply"], b'Request{}', success=False)
        call(backend + ["check"], b'Response{}', success=False)
    print(f"PASS: bidirectional semantic exchange, {len(cases)} round trips, {len(invalid)} rejections, semantic selftests on both backends, Zig and Rust agreeing on all, {len(lines)} IPC lines canonical")
