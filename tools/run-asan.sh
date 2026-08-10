#!/bin/sh
# Launch the AddressSanitizer build with reliable report capture.
#
# Two things this fixes over a bare launch:
#
#   log_path    ASan writes its report to <log_path>.<pid> directly, so the
#               report survives even if the terminal is closed, the shell
#               pipeline is wrong, or the process is killed from the dock.
#               Piping to tee is easy to get wrong and loses everything.
#
#   abort_on_error=0
#               Exit instead of raising SIGABRT, so macOS does not open a
#               crash dialog and generate a full Apple crash report. The ASan
#               text is strictly more informative than the Apple report.
#
# detect_container_overflow is off because this build is ASan-instrumented but
# links the system libc++, which is not; the annotation mismatch produces false
# container-overflow reports inside std::string and std::vector. See
# tools/asan-suppressions.txt.
set -eu

APP="${APP:-build-cmake/SpaghettiKart.app/Contents/MacOS/SpaghettiKart}"
OUTDIR="${OUTDIR:-/tmp/mk64-asan}"
SUPP="$(cd "$(dirname "$0")" && pwd)/asan-suppressions.txt"

[ -x "$APP" ] || { echo "no executable at $APP" >&2; exit 1; }

rm -rf "$OUTDIR"
mkdir -p "$OUTDIR"

ASAN_OPTIONS="log_path=$OUTDIR/report\
:suppressions=$SUPP\
:detect_container_overflow=0\
:abort_on_error=0\
:halt_on_error=1\
:symbolize=1\
:print_legend=1\
:detect_leaks=0"
export ASAN_OPTIONS

echo "ASan reports -> $OUTDIR/report.<pid>"
echo "stdout/stderr -> $OUTDIR/stdout.log"
echo

set +e
"$APP" 2>&1 | tee "$OUTDIR/stdout.log"
status=$?
set -e

echo
echo "=== exit status: $status ==="
if ls "$OUTDIR"/report.* >/dev/null 2>&1; then
    echo "=== ASan report(s) written ==="
    ls -la "$OUTDIR"/report.*
else
    echo "=== no ASan report: nothing tripped the sanitizer ==="
fi
