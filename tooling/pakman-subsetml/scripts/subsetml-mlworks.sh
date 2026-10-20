#!/bin/sh
set -eu
tools=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
image=${PAKMAN_COMPILER_IMAGE:-$tools/../subsetml.img}
exec "$tools/run-image.sh" "$image" "$@"
