#!/bin/sh
set -eu
test "$#" -eq 4 || { echo 'usage: builder SOURCE WORK IMAGE ENTRY' >&2; exit 2; }
source=$1 work=$2 image=$3 entry=$4
case "$entry" in *[!A-Za-z0-9_.]*|'') echo 'invalid SML entry' >&2; exit 2 ;; esac
tools=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
runtime=${PAKMAN_MLWORKS_RUNTIME:-$tools/../runtime}
mlworks=${PAKMAN_MLWORKS_HOME:-/home/ellie/testingstuff/mlworks-r5900}
mkdir -p "$work"
"${PAKMAN_SUBSETML:?set PAKMAN_SUBSETML}" sml-entry "$work" "$source"
# This first build adapter accepts one self-contained WM program. Keep the
# generated loader out of WM; it is part of the MLWorks target boundary.
set -- "$work"/*.sml
test "$#" -eq 1 || { echo 'wm-image currently requires a single-module program' >&2; exit 1; }
# Paths enter SML literals through environment variables, avoiding code quoting.
export PAKMAN_BUILD_SML=$1 PAKMAN_BUILD_IMAGE=$image
export LD_LIBRARY_PATH=$runtime${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}
cd "$mlworks/target-objects"
result=0
sh "$tools/run-memory-limited.sh" "$runtime/main" -MLWpass MLWargs \
  -gc-low-memory -limit 6 -load "$mlworks/tty-ps2-fixed.img" MLWargs >"$work/build.log" 2>&1 <<EOF || result=$?
Shell.Project.load "require_all";
use (valOf (OS.Process.getEnv "PAKMAN_BUILD_SML"));
val deliver : string * (unit -> unit) -> unit = MLWorks.Internal.Runtime.environment "application image deliver and exit";
val _ = MLWorks.Deliver.with_delivery_hook (fn _ => fn (name, main, _) => deliver (name, main)) MLWorks.Deliver.deliver (valOf (OS.Process.getEnv "PAKMAN_BUILD_IMAGE"), $entry, MLWorks.Deliver.CONSOLE);
EOF
if test "$result" -ne 0 || ! test -s "$image"; then
  tail -c 8192 "$work/build.log" >&2
  echo 'MLWorks did not save the application image' >&2
  exit 1
fi
