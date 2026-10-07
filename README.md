# pristine

A Claude Code mod that manages your harness: every skill, rule, memory, MCP server, hook, plugin, permission and setting, with one switch each and profiles to swap whole setups.

## Install

```
/plugin install pristine --marketplace <owner>/<repo>
```

To run it from a local folder instead:

```
claude --plugin-dir ~/Documents/code/pristine
```

## The pane

`/pristine` opens the pane. Each row is one harness element:

```
● on   ecc:plan              plugin   plugin ecc (user)
○ off  rules/testing.md      user     ~/.claude/rules/ecc/testing.md
locked hooks.Stop            policy   managed settings
```

- Press the toggle to turn an element on or off.
- `Show` filters by kind, `Scope` filters by scope.
- `Profile` switches profile. The input below it creates a new profile from the current one.
- `Restore all` turns back on everything pristine turned off.

Keys: Tab moves between controls, Enter presses, Esc returns to the prompt.

## What it manages

| Kind | Off means | Writes a file |
|---|---|---|
| CLAUDE.md, rules, memories | The file is left out of the context | No |
| Skills and commands | The command is hidden and refuses to run | No |
| Agents | The agent is not offered to the model | No |
| MCP servers | Every call to the server is denied | No |
| Hook events | All hooks of that event are skipped | No |
| Hooks in settings | The hook is removed from its `settings.json` | Yes |
| Plugins | `enabledPlugins` is set to `false` | Yes |
| Permissions | The rule is removed from its `settings.json` | Yes |
| Settings | The key is removed from its `settings.json` | Yes |

Plugin hooks can only be skipped per event, not one by one. After a plugin toggle, run `/reload-plugins`.

## Scopes

Every row shows where the element comes from:

| Scope | Source |
|---|---|
| `policy` | Managed settings of your organization. Always locked. |
| `flag` | Command-line flags. Always locked. |
| `user` | Your config directory (`~/.claude`, or `CLAUDE_CONFIG_DIR`) |
| `project` | `.claude/` and `.mcp.json` in the project |
| `local` | `.claude/settings.local.json` |
| `plugin` | An installed plugin, with the scope it was installed in |
| `account` | A claude.ai connector |
| `memory` | A memory file |
| `mixed` | A hook event with hooks from more than one scope |

## Profiles

A profile is a base (`on` or `off`) plus the elements you toggled.

- `default`: your harness as it is.
- `pristine`: everything off. Permissions and settings stay on unless you toggle them yourself.

To compose a setup from several harnesses, create a profile with base `off` and switch on the pieces you want:

```
/pristine new ecc-react off
```

## Commands

| Command | Does |
|---|---|
| `/pristine` | Opens the pane |
| `/pristine status` | Lists what is off in the active profile |
| `/pristine list` | Lists the profiles |
| `/pristine use <profile>` | Switches profile |
| `/pristine new <profile> [on\|off]` | Creates a profile. Without a base, copies the active one. |
| `/pristine delete <profile>` | Deletes a profile |
| `/pristine restore` | Turns everything back on and switches to `default` |

Only you can change profiles. A `/pristine use` that you did not type is refused.

## Safety

- Before the first change to a settings file, pristine copies it to `<config dir>/pristine-backups/`.
- A removed entry is stored and restored only into the file it came from.
- Setting values are never shown, only their keys.
- Project settings behind a symbolic link are not written.

## Development

```
claude plugin validate .
claude plugin test .
```

The engine does not allow `$` to cross an import, so every engine call is in `hooks/register.tsx`. The other files in `hooks/` are pure functions.
