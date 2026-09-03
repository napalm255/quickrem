#!/usr/bin/env bash
# Boot a throwaway headless gnome-shell with QuickRem installed and assert that
# it enables cleanly, disables cleanly, and can be enabled again without
# leaking.
#
# The enable/disable/enable cycle is the point. QuickRem connects to a
# Gio.Settings, a Gio.FileMonitor and its own store, and arms a GLib timeout on
# every file event; a connect that outlives its disconnect stacks a second
# handler on the second enable, and the Shell only complains about it later.
#
# This needs a real gnome-shell and so runs locally only; GitHub's runners have
# no GNOME 50.

set -euo pipefail

UUID="quickrem@napalm255.github.io"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TIMEOUT="${TIMEOUT:-60}"

# The private XDG directories must be exported BEFORE dbus-run-session starts,
# not after. D-Bus activates dconf as a child of the bus, so a service started
# by a bus that inherited the real XDG_CONFIG_HOME will read and write the
# developer's own dconf database — `gsettings set` then silently affects the
# real session and the shell under test loads the real extension list.
if [[ -z "${QUICKREM_HEADLESS:-}" ]]; then
    QUICKREM_WORK="$(mktemp -d)"
    export QUICKREM_HEADLESS=1
    export QUICKREM_WORK
    export XDG_CONFIG_HOME="$QUICKREM_WORK/config"
    export XDG_DATA_HOME="$QUICKREM_WORK/data"
    export XDG_CACHE_HOME="$QUICKREM_WORK/cache"
    export XDG_RUNTIME_DIR="$QUICKREM_WORK/run"
    mkdir -p "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_CACHE_HOME" "$XDG_RUNTIME_DIR"
    chmod 700 "$XDG_RUNTIME_DIR"

    exec dbus-run-session -- "${BASH_SOURCE[0]}" "$@"
fi

WORK="$QUICKREM_WORK"
LOG="$WORK/shell.log"

EXT_DIR="$XDG_DATA_HOME/gnome-shell/extensions/$UUID"
mkdir -p "$EXT_DIR"
cp -r "$REPO_ROOT"/metadata.json "$REPO_ROOT"/extension.js "$REPO_ROOT"/prefs.js \
      "$REPO_ROOT"/modules "$REPO_ROOT"/schemas "$REPO_ROOT"/icons "$EXT_DIR/"
glib-compile-schemas "$EXT_DIR/schemas"

# The isolated XDG_DATA_HOME has no Remmina, so this also exercises the
# "nothing found" path. A profile directory is planted as well, so the scan,
# the parse and the file monitor all run rather than being skipped.
PROFILE_DIR="$WORK/profiles"
mkdir -p "$PROFILE_DIR"
printf '[remmina]\nname=Headless Fixture\nprotocol=SSH\nserver=example.com\n' \
    >"$PROFILE_DIR/fixture.remmina"

gsettings set org.gnome.shell disable-user-extensions false
gsettings set org.gnome.shell enabled-extensions "['$UUID']"

# Guard against the isolation failing again: if dconf were leaking into the real
# session, this would come back holding the developer's extensions.
enabled="$(gsettings get org.gnome.shell enabled-extensions)"
if [[ "$enabled" != "['$UUID']" ]]; then
    echo "FAIL: dconf is not isolated; enabled-extensions = $enabled" >&2
    rm -rf "$WORK"
    exit 1
fi

gsettings --schemadir "$EXT_DIR/schemas" \
    set org.gnome.shell.extensions.quickrem profile-dir "$PROFILE_DIR"

# The enable marker is logged at debug level, which GLib drops unless asked
# for. Without this the shell starts perfectly and the check still fails.
export G_MESSAGES_DEBUG=all

gnome-shell --wayland --headless --virtual-monitor 3840x1600 >"$LOG" 2>&1 &
SHELL_PID=$!
# shellcheck disable=SC2317  # invoked via trap
cleanup() {
    # Captured first: this trap's own last command would otherwise become the
    # script's exit status, which is how a run that printed PASS still exited 1.
    local status=$?

    kill "$SHELL_PID" 2>/dev/null || true
    wait "$SHELL_PID" 2>/dev/null || true

    # D-Bus activates gvfs inside the throwaway XDG_RUNTIME_DIR, and its fuse
    # mount is not ours to unmount, so the directory may refuse to go. Leaving a
    # few files in /tmp must not turn a passing check into a failing one.
    rm -rf "$WORK" 2>/dev/null || true

    return "$status"
}
trap cleanup EXIT

fail() {
    echo "FAIL: $1" >&2
    echo "---- shell log (quickrem and errors only) ----" >&2
    grep -aiE 'quickrem|JS ERROR|Extension' "$LOG" >&2 || echo "(nothing matched)" >&2
    exit 1
}

# Counts occurrences rather than truncating between phases: gnome-shell keeps
# the log open, so truncating leaves its file offset intact and the next write
# pads the gap with NULs — grep then reports "binary file matches" and the
# failure diagnostics come out empty at exactly the wrong moment.
wait_for() {
    local pattern="$1" wanted="${2:-1}" waited=0
    while ((waited < TIMEOUT)); do
        (($(grep -ac "$pattern" "$LOG") >= wanted)) && return 0
        kill -0 "$SHELL_PID" 2>/dev/null || fail "gnome-shell exited early"
        sleep 1
        # Arithmetic form, not ((waited++)): the post-increment returns the old
        # value, so the first iteration would exit non-zero. It is survivable
        # here only because every call sits on the left of ||, which is the kind
        # of accident that stops being true the moment someone calls it bare.
        waited=$((waited + 1))
    done
    return 1
}

wait_for '\[quickrem\] enabled' || fail "extension never reported enabled within ${TIMEOUT}s"
echo "ok: enabled"

# Exercise the file monitor while the Shell is live: a profile appearing must
# not throw, and neither must one going away.
printf '[remmina]\nname=Added Later\nprotocol=RDP\nserver=rdp.example.com\n' \
    >"$PROFILE_DIR/added.remmina"
sleep 2
rm -f "$PROFILE_DIR/added.remmina"
sleep 2
echo "ok: file monitor survived an add and a remove"

# A second enable must be as clean as the first.
gnome-extensions disable "$UUID"
sleep 2
gnome-extensions enable "$UUID"
wait_for '\[quickrem\] enabled' 2 || fail "extension did not re-enable after disable"
echo "ok: re-enabled after disable"

if grep -qaE 'JS ERROR|Extension .* had error' "$LOG"; then
    fail "javascript errors in the shell log"
fi

if grep -qaiE 'No signal handler|instance with invalid|Object .* has been already deallocated' "$LOG"; then
    fail "signal or object lifetime warnings after re-enable"
fi

echo "ok: no errors or lifetime warnings"
echo "PASS"
