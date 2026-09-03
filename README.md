# QuickRem

Remmina connections in the GNOME Shell Quick Settings panel.

Open the system menu, click the Remmina tile, pick a saved connection. The list
is read from Remmina's own profile directory and follows it as it changes, so a
connection saved in Remmina shows up here without a reload.

**[Documentation →](https://begibson.com/quickrem/)** — profiles, launching,
secrets, architecture, testing, packaging and releasing.

## What it does

- Lists every saved `.remmina` profile, sorted by name, with an icon per
  protocol.
- Watches the profile directory, so adding, editing or removing a profile
  updates the menu straight away.
- Scrolls the list once it outgrows the screen, capped at half the work area.
  Short lists are untouched — no scrollbar appears until there is something to
  scroll.
- Opens a profile through the application registered for
  `application/x-remmina` — Remmina's own connect action. That works the same
  for a Flatpak and a distribution package, reuses an already-running Remmina,
  and lets the portal map the path into the Flatpak sandbox.
- Finds the profile directory on its own, honouring `datadir_path` in
  `remmina.pref`, and falls back to the Flatpak or native data directory.

It never reads Remmina's stored passwords. `password`, `ssh_passphrase` and the
rest are encrypted with a key in `remmina.pref`, and `modules/profiles.js` drops
them while parsing rather than filtering them later.

## Install

Needs GNOME 49 or newer, and Remmina. From the latest release, with no clone and
no toolchain — `gnome-extensions` ships with GNOME Shell itself:

```
curl -LO 'https://github.com/napalm255/quickrem/releases/latest/download/quickrem@napalm255.github.io.shell-extension.zip'
gnome-extensions install --force 'quickrem@napalm255.github.io.shell-extension.zip'
```

That unpacks the extension and compiles its settings schema, so there is no
separate `glib-compile-schemas` step. Log out and back in — Wayland cannot
reload the Shell in place — then turn it on:

```
gnome-extensions enable quickrem@napalm255.github.io
```

From a clone:

```
just setup
just install
just enable
```

A brand-new extension is not visible to a running Shell on Wayland, so the
first `just enable` after a fresh `just install` will say the extension does not
exist. Log out and back in, then run it.

## Preferences

`just prefs`, or the Settings entry at the bottom of the menu. The first row
shows which directory QuickRem resolved and how, so a wrong guess is visible
rather than silent.

| Setting           | Empty means                                                        |
| ----------------- | ------------------------------------------------------------------ |
| Profile directory | Detect it: `datadir_path`, then a native install, then the Flatpak |
| Launch command    | Use the handler registered for `application/x-remmina`             |

`Launch command` is the escape hatch for an unusual install. The profile path is
appended as a separate argument, never interpolated into the string.

## Develop

```
just              # list every recipe
just test         # unit suite, runs on Node
just lint         # eslint, prettier, gschema and shellcheck
just ci           # everything CI runs
just fixtures 5   # write throwaway profiles to exercise the menu and watcher
just fixtures-clean
just test-live    # headless Shell smoke test, then the packer check
just logs         # follow the extension's output
```

`modules/profiles.js` and `modules/paths.js` import nothing at all, so Vitest
runs them on plain Node. `modules/store.js` is unit-tested against an in-memory
Gio in `tests/stubs/`, which is what makes the debounce, the generation guard
and the watch re-attach reachable from a test.

`prefs.js` is unit-tested too, mostly to pin one trap: `_()` may not be called
while a module is being evaluated, and a translated string in a module-level
table stops the preferences window opening at all — silently, because nothing
else in the extension imports `prefs.js`.

`modules/panel.js` and `extension.js` are widget construction and lifecycle
wiring; asserting those against stubs would test the stubs, so they are covered
by `scripts/headless-check.sh` instead, which enables, disables and re-enables
the real extension in a real headless gnome-shell and fails on a leaked
handler.

## Architecture

| File                  | Imports            | Job                                                 |
| --------------------- | ------------------ | --------------------------------------------------- |
| `extension.js`        | Shell              | Pair construction with teardown, nothing else       |
| `modules/profiles.js` | nothing            | Parse a `.remmina` file, sort, map protocol to icon |
| `modules/paths.js`    | nothing            | Decide which directory to read                      |
| `modules/store.js`    | Gio, GLib, GObject | Scan and watch it; publish `profiles`               |
| `modules/panel.js`    | Shell, St          | The tile, its menu, and launching                   |
| `prefs.js`            | Adw, Gtk           | Preferences, in its own process                     |

The store owns the data and the panel owns the widgets; the panel rebuilds from
`notify::profiles` and holds no profile state of its own.

### Why the list scrolls

`QuickToggleMenu` has no scrolling of its own. Measured on a 1080p screen, 30
profiles want 1296px of a 1048px work area and the surplus is simply clipped.
GNOME's own Wi-Fi menu answers this by showing eight networks and sending you to
Settings for the rest, which suits a list you skim but not one you pick from.

So `modules/panel.js` subclasses `PopupMenuSection` and swaps its `actor` for an
`St.ScrollView` around the same box. `PopupMenuBase.addMenuItem()` adds
`section.actor` and does its bookkeeping against the section object, so key
navigation, open-state propagation and activation all survive the swap. The cap
is recomputed on every rebuild and every menu open, which picks up a monitor or
text-scaling change without watching for either.

## Releasing

Set the version in `metadata.json` and `package.json`, commit, then tag and
push. CI checks the tag against both files before it builds anything.

## Licence

GPL-3.0-or-later.
