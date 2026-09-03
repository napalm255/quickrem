#!/usr/bin/env bash
# Write throwaway .remmina profiles into the directory QuickRem reads, so the
# menu and the file monitor can be exercised on a machine where Remmina has
# nothing saved yet.
#
# Every file is named quickrem-fixture-*.remmina and `clean` removes only that
# pattern, so a real profile can never be caught by it.

set -euo pipefail

PREFIX="quickrem-fixture"
UUID="quickrem@napalm255.github.io"
SCHEMA="org.gnome.shell.extensions.quickrem"
PROTOCOLS=(SSH RDP VNC SPICE SFTP WWW)

usage() {
    echo "usage: ${0##*/} add [count] | clean" >&2
    exit 2
}

# Same precedence the extension uses, minus datadir_path: the override first,
# then a native install, then the flatpak.
profile_dir() {
    if [[ -n "${QUICKREM_DIR:-}" ]]; then
        echo "$QUICKREM_DIR"
        return
    fi

    local schemadir="$HOME/.local/share/gnome-shell/extensions/$UUID/schemas"
    if [[ -d "$schemadir" ]]; then
        local override
        override="$(gsettings --schemadir "$schemadir" get "$SCHEMA" profile-dir)"
        override="${override%\'}"
        override="${override#\'}"
        if [[ -n "$override" ]]; then
            echo "$override"
            return
        fi
    fi

    if command -v remmina >/dev/null; then
        echo "${XDG_DATA_HOME:-$HOME/.local/share}/remmina"
        return
    fi

    echo "$HOME/.var/app/org.remmina.Remmina/data/remmina"
}

DIR="$(profile_dir)"

case "${1:-}" in
add)
    count="${2:-3}"
    [[ "$count" =~ ^[0-9]+$ ]] || usage

    mkdir -p "$DIR"
    for ((i = 1; i <= count; i++)); do
        protocol="${PROTOCOLS[$(((i - 1) % ${#PROTOCOLS[@]}))]}"
        cat >"$DIR/$PREFIX-$i.remmina" <<PROFILE
[remmina]
name=Fixture $i ($protocol)
group=QuickRem fixtures
protocol=$protocol
server=host$i.example.com
username=tester
PROFILE
    done
    echo "wrote $count fixtures to $DIR"
    ;;
clean)
    removed=0
    for file in "$DIR/$PREFIX"-*.remmina; do
        [[ -e "$file" ]] || continue
        rm -f "$file"
        ((removed++))
    done
    echo "removed $removed fixtures from $DIR"
    ;;
*)
    usage
    ;;
esac
