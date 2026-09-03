# Security policy

## Supported versions

The most recent release is supported. QuickRem runs inside the GNOME Shell
process, so it is only ever supported on the Shell versions named in
`metadata.json`.

## Reporting a vulnerability

Report privately through GitHub's
[security advisory form](https://github.com/napalm255/quickrem/security/advisories/new)
rather than opening a public issue.

Please include the Shell version, the extension version from `metadata.json`,
and the steps to reproduce. You should get an acknowledgement within a week.

## Scope

QuickRem has no network access and stores no credentials of its own. It reads
files the user already owns and asks another application to open one. The
realistic security surface is:

- **Profile contents.** `.remmina` files are parsed in the Shell process.
  `modules/profiles.js` drops every `password`, `passphrase` and `secret` key
  while parsing, so Remmina's encrypted values are never held, displayed or
  logged. Anything that gets one of them into a menu label, a subtitle or the
  journal is in scope.
- **Launching.** A profile is opened by handing its _path_ to the application
  registered for `application/x-remmina`. Paths come from the directory
  enumerator, never from a parsed field, so profile content cannot reach an
  argument vector. The `launch-command` setting is parsed with
  `GLib.shell_parse_argv` and the profile path is appended as a separate
  element, never interpolated. Anything that makes profile content execute is
  in scope.
- **The profile directory.** `profile-dir` is read from GSettings and used as a
  directory to enumerate. It is the user's own setting, but anything that turns
  it into more than a read is in scope.
- **Shell stability.** Anything that crashes or hangs the Shell, or that leaks
  a signal handler or timeout across an enable/disable cycle, is in scope.

`remmina.pref` is read for one key, `datadir_path`. The `secret=` beside it —
the key Remmina encrypts stored passwords with — is never returned by
`parseDatadirPath` and never kept.
