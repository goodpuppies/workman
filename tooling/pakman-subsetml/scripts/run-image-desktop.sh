#!/bin/sh
set -eu
image=$1
shift
exec "$image" "$@"

