# Integer support: MLWorks PS2 investigation

Investigated on 2026-10-17. This records evidence and design options, not an
adopted WM or SubsetML language change.

## Representation and operations

MLWorks represents ordinary `int` as a signed 30-bit value in a 32-bit tagged
word. `MLINT(i)` shifts left by two; `CINT(i)` arithmetically shifts right by
two. Values range from -536,870,912 through 536,870,911. These immediate values
do not require an individual heap allocation. See the sibling checkout's
`src/rts/src/values.h:307` and `:647`, and
`src/basis/__pre_int.sml:132`.

The MIPS backend emits native integer instructions for arithmetic, including
checked addition/subtraction and signed multiplication/division paths.
Checked overflow raises `Overflow`; zero divisors raise `Div`. Signed `div`
rounds toward negative infinity, and nonzero `mod` has the divisor's sign:
`~7 div 3 = ~3`, `~7 mod 3 = 2`, `7 div ~3 = ~3`, `7 mod ~3 = ~2`.
JS `/`, `%`, and bitwise coercion cannot be used unchanged for this contract.

There is also a distinct signed `Int32.int`, internally
`MLWorks.Internal.Types.int32`, ranging from -2,147,483,648 through
2,147,483,647. It uses boxed storage shared with the Word32 representation;
ordinary `int` and `Int32.int` require conversions. Some Int32 runtime
operations allocate results. `int32_mul` currently computes its intermediate
product as a C double, so a full-width integer type is not automatically a
floating-point-free path. See `src/rts/src/integers.c:158` and
`src/basis/__pre_int32.sml`.

## Live PS2 checks

The retained probe is at
`../../psx-pi-smbshare/research/probes/mlworks-int/probe.sml`.
It was fed to `/home/ellie/testingstuff/mlworks-r5900/run-ps2-tty.sh`, which
loads `tty-ps2-fixed.img` with `tty-fixed-runtime` and a 12 MiB heap limit.

The full probe failed at the first addition-overflow check. The listener
terminated with SIGFPE (exit 136), rather than catching `Overflow`. Normal
addition, subtraction, multiplication and both int boundaries passed first.

Repeating with the four addition/subtraction/negation overflow checks omitted
completed all 24 remaining checks. These covered signed division/modulo,
division/modulo by zero, multiplication and division overflow, both Int32
boundaries, Int32 values above the ordinary int range, and Int32 addition
overflow. The PS2 remained reachable after both runs.

The failing diagnostic reported `jr ra` at PC (`0x03e00008`) and a trapping
integer `add` at PC+4 (`0x02532020`). This suggests a branch-delay-slot case:
the source signal handler only classifies the instruction at saved PC.
This is a hypothesis to verify against the kernel's delivered context and
the exact runtime build, not a confirmed repair. Existing notes reporting
successful checked overflow do not establish this particular path works.

## Implications for WM and SubsetML

- Ordinary MLWorks `int` is a useful target for counters and indexing without
  double-precision arithmetic or boxing each integer.
- Choose the range explicitly: a fixed signed 30-bit contract is cheap on
  MLWorks and exactly representable using JS Number; signed 32-bit needs the
  boxed Int32 path or a different representation. Target-dependent machine
  int bounds are another option, with weaker cross-target consistency.
- Thirty bits do not cover current Unix epoch seconds or arbitrary file
  sizes. Larger integer needs should remain explicit rather than narrowing
  these values silently.
- Keep existing WM Number/SubsetML real behavior while adding a distinct
  integer type. Literal inference, overflow reporting, conversions and
  integer division must be specified together. No implicit wrapping.
- SubsetML already lexes/parses integer constants and has `SInt` AST nodes;
  its elaborator explicitly rejects them. WM reverse parsing currently
  rewrites integer-looking literals to real literals. These existing paths
  provide starting points, but adding a primitive name alone is insufficient.
- SubsetML excludes exceptions in authored code. How checked integer errors
  surface through its portable Basis remains a language/library design
  decision; it should not accidentally inherit backend-specific failures.

## Follow-up: signed 32-bit target verified

The agreed direction is a signed 32-bit WM/SubsetML integer, independently of
the target's ordinary `int` width. The candidate MLWorks mapping is
`MLWorks.Internal.Types.int32` / `Int32.int`.

The separate `int32.sml` probe in the same probe directory passed all 41 checks
on the real PS2 through the existing TTY launcher. Its transcript is retained
as `int32-ps2.log`. Checks cover both signed 32-bit endpoints, values outside
the ordinary int range, addition/subtraction/multiplication/negation/absolute
value and their overflow cases, signed ordering, all division/modulo sign
combinations, zero divisors, minimum divided by -1, minimum modulo -1, and
widening/narrowing through the existing runtime conversion functions. A
60,000-step recursive sum with boxed Int32 accumulation returned exactly
1,800,030,000. Functions receive operands as arguments to exercise generated
arithmetic rather than only literal declarations.

Unlike ordinary-int addition overflow in the earlier probe, all tested Int32
overflow paths raised catchable `Overflow` without killing the listener.
This verifies a practical primitive arithmetic target; it does not establish
full Basis parsing/formatting support, exhaustive numeric correctness or
performance. The ordinary-int signal/delay-slot issue remains separate.

The subsequent language task is agreeing on literals and error behavior
before implementing both backends. The 32-bit range is no longer an open
design question.
