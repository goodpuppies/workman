#!/bin/sh
set -eu
test "$#" -eq 4 || { echo 'usage: builder SOURCE WORK IMAGE ENTRY' >&2; exit 2; }
source=$1 work=$2 image=$3 entry=$4
case "$entry" in *[!A-Za-z0-9_.]*|'') echo 'invalid SML entry' >&2; exit 2 ;; esac
mkdir -p "$work"
"${PAKMAN_SUBSETML:?set PAKMAN_SUBSETML}" sml-entry "$work" "$source"
printf 'val _ = %s ()\n' "$entry" > "$work/driver.sml"
printf '"project.mlb"\n"driver.sml"\n' > "$work/run.mlb"
cd "$work"
mlton -output "$image" run.mlb
