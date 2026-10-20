#!/bin/sh
set -eu
image=$1
shift
tools=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
runtime=${PAKMAN_MLWORKS_RUNTIME:-$tools/../runtime}
export LD_LIBRARY_PATH=$runtime${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}
exec "$runtime/main" -MLWpass MLWargs -gc-low-memory -limit 6 -load "$image" MLWargs "$@"
