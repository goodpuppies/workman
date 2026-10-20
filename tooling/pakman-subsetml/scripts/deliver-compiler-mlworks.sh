#!/bin/sh
set -eu
test "$#" -eq 2 || { echo 'usage: deliver-compiler-mlworks.sh FLAT_NATIVE_OBJECT_DIRECTORY OUTPUT_IMAGE' >&2; exit 2; }
objects=$(CDPATH= cd -- "$1" && pwd)
image=$2
case "$image" in /*) ;; *) echo 'output image must be absolute' >&2; exit 2 ;; esac
tools=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
runtime=${PAKMAN_MLWORKS_RUNTIME:-$tools/../runtime}
mlworks=${PAKMAN_MLWORKS_HOME:-/home/ellie/testingstuff/mlworks-r5900}
export LD_LIBRARY_PATH=$runtime${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}
export PAKMAN_COMPILER_DELIVERY_IMAGE=$image.new.$$
cd "$objects"
sh "$tools/run-memory-limited.sh" "$runtime/main" -MLWpass MLWargs \
  -gc-low-memory -limit 6 -load "$mlworks/tty-ps2-fixed.img" MLWargs <<'SML'
Shell.Project.load "main";
val getenv : string -> string option = MLWorks.Internal.Runtime.environment "system os getenv";
val deliver : string * (unit -> unit) -> unit = MLWorks.Internal.Runtime.environment "application image deliver and exit";
val _ = MLWorks.Deliver.with_delivery_hook (fn _ => fn (name, main, _) => deliver (name, main)) MLWorks.Deliver.deliver (valOf (getenv "PAKMAN_COMPILER_DELIVERY_IMAGE"), Main.main, MLWorks.Deliver.CONSOLE);
SML
test -s "$PAKMAN_COMPILER_DELIVERY_IMAGE" || { echo 'MLWorks did not deliver the compiler image' >&2; exit 1; }
mv -f "$PAKMAN_COMPILER_DELIVERY_IMAGE" "$image"
