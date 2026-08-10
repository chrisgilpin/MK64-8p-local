#!/bin/sh
# Make an AddressSanitizer build launchable.
#
# The macOS bundle rules (cmake/macos/apple_bundle.cmake) codesign the .app
# with --options runtime. The hardened runtime enforces library validation,
# which requires every loaded dylib to share the main binary's Team ID.
#
# The entitlements file grants com.apple.security.cs.disable-library-validation,
# which is what lets the bundled Homebrew dylibs load -- but that entitlement is
# restricted, and macOS only honors it for code signed with a real Developer ID.
# This build is ad-hoc signed, so the entitlement is ignored, and two ad-hoc
# signatures do NOT satisfy the Team ID check: neither has a team, and "no team"
# fails to match rather than matching trivially. dyld then refuses the ASan
# runtime at launch with:
#
#   Library not loaded: @executable_path/../Frameworks/libclang_rt.asan_osx_dynamic.dylib
#   ... mapping process and mapped file (non-platform) have different Team IDs
#
# Dropping --options runtime removes library validation entirely, which is fine
# for a local debug build and is the only fix available without a signing
# identity. Re-run this after every ASan rebuild, since the build re-signs.
set -eu

APP="${1:-build-cmake/SpaghettiKart.app}"
FRAMEWORKS="$APP/Contents/Frameworks"
RUNTIME_NAME=libclang_rt.asan_osx_dynamic.dylib

[ -d "$APP" ] || { echo "no bundle at $APP" >&2; exit 1; }

# Copy the ASan runtime in if the build didn't (it lives with the toolchain).
if [ ! -f "$FRAMEWORKS/$RUNTIME_NAME" ]; then
    SRC=$(find "$(dirname "$(xcrun --find clang)")/../lib/clang" -name "$RUNTIME_NAME" 2>/dev/null | head -1)
    [ -n "$SRC" ] || { echo "cannot locate $RUNTIME_NAME in the toolchain" >&2; exit 1; }
    mkdir -p "$FRAMEWORKS"
    cp "$SRC" "$FRAMEWORKS/$RUNTIME_NAME"
    echo "copied runtime from $SRC"
fi

# Re-sign ad-hoc WITHOUT --options runtime. Nested code first, then the bundle.
codesign --force --sign - "$FRAMEWORKS/$RUNTIME_NAME"
codesign --force --deep --sign - "$APP"

# Fail loudly here rather than at launch: 0x10000 is the hardened runtime flag.
flags=$(codesign -d --verbose=2 "$APP" 2>&1 | sed -n 's/.*flags=\([0-9a-fx]*\).*/\1/p')
case "$flags" in
    *0x2\(adhoc\)*|0x2) ;;
    *) printf 'warning: unexpected signing flags %s (0x10000 means hardened runtime is still on)\n' "$flags" >&2 ;;
esac

echo "$APP ready for ASan (flags=$flags)"
