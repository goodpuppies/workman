#!/bin/sh
set -eu
test "$#" -eq 1 || { echo 'usage: build-project-mlworks.sh GRAPH_DIRECTORY' >&2; exit 2; }
graph=$(CDPATH= cd -- "$1" && pwd)
tools=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
runtime=${PAKMAN_MLWORKS_RUNTIME:-$tools/../runtime}
mlworks=${PAKMAN_MLWORKS_HOME:-/home/ellie/testingstuff/mlworks-r5900}
export LD_LIBRARY_PATH=$runtime${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}
cd "$graph"
# MLWorks can print dependency-analysis errors yet return status zero.
# Never deliver an older cached application after such a failed build.
result=0
sh "$tools/run-memory-limited.sh" "$runtime/main" -MLWpass MLWargs \
  -gc-low-memory -limit 6 -load "$mlworks/batch-ps2-native.img" MLWargs \
  -pervasive-dir "$mlworks/pervasive-target" -project project.mlp -verbose -build \
  > "$graph/batch-build.log" 2>&1 || result=$?
cat "$graph/batch-build.log"
# The old dependency scanner cannot enumerate Basis structures exported by
# the precompiled require_all library. Actual compilation resolves them.
# Exempt only these known Basis hints; real source/type errors remain fatal.
if test "$result" -ne 0; then
  echo 'MLWorks project build failed; refusing application delivery' >&2
  exit 1
fi
basis='Array|Array2|BinIO|BinPrimIO|Bool|Byte|Char|CharArray|CharVector|CommandLine|Date|General|IEEEReal|INetSock|IO|Int|Int16|Int32|Int8|LargeInt|LargeReal|LargeWord|List|ListPair|MLWorks|Math|NetDB|NetHostDB|NetProtDB|NetServDB|OS|Option|Pack16Big|Pack16Little|Pack32Big|Pack32Little|Pack8Big|Pack8Little|Position|Real|RealArray|RealArray2|RealVector|SML90|Socket|String|StringCvt|Substring|SysWord|TextIO|TextPrimIO|Time|Timer|Unix|UnixSock|Vector|Word|Word16|Word16Array|Word16Array2|Word16Vector|Word32|Word32Array|Word32Array2|Word32Vector|Word8|Word8Array|Word8Array2|Word8Vector'
if grep ': error:' "$graph/batch-build.log" | grep -Ev "Cannot find structure ($basis) during dependency analysis of unit "; then
  echo 'MLWorks project build failed; refusing application delivery' >&2
  exit 1
fi
mkdir -p run-objects
cd run-objects
for object in "$mlworks/target-objects/"*.mo "$graph/objects/Release/"*.mo; do
  # Rewriting hundreds of unchanged links is expensive on the PS2 NFS root.
  test "$object" -ef "./${object##*/}" || ln -sf "$object" .
done
rm -f "$graph/program.img"
export PAKMAN_DELIVERY_IMAGE=$graph/program.img
sh "$tools/run-memory-limited.sh" "$runtime/main" -MLWpass MLWargs \
  -gc-low-memory -limit 6 -load "$mlworks/tty-ps2-fixed.img" MLWargs <<'EOF'
Shell.Project.load "pkm_app_entry";
EOF
test -s "$graph/program.img" || { echo 'MLWorks did not save the program image' >&2; exit 1; }
