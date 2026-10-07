import { describe, expect, test } from 'claude-code/testing'

import {
  applyEntry,
  entriesOf,
  hookEventOf,
  isSoundStashedItem,
} from '../hooks/settingsEdit'
import type { SettingsObject } from '../hooks/settingsEdit'

const HOOK = { matcher: 'Bash', hooks: [{ type: 'command', command: 'gate.sh' }] }
const SETTINGS: SettingsObject = {
  theme: 'dark',
  enabledPlugins: { 'ecc@ecc': true, 'old@x': false },
  permissions: { allow: ['Bash(ls:*)'], deny: ['Read(.env)'], defaultMode: 'plan' },
  hooks: { PreToolUse: [HOOK] },
}
const PATH = '/home/.claude/settings.json'

const itemNamed = (name: string) => {
  const found = entriesOf(SETTINGS, 'user', PATH).find(item =>
    item.name.startsWith(name),
  )
  if (found?.entry === undefined) throw new Error(`no writable item ${name}`)

  return { ...found, entry: found.entry }
}

describe('entriesOf', () => {
  test('lists every settings element with its scope and origin', () => {
    const items = entriesOf(SETTINGS, 'user', PATH)

    expect(items.map(item => item.kind).sort()).toEqual([
      'hook',
      'permission',
      'permission',
      'permission',
      'plugin',
      'plugin',
      'setting',
    ])
    expect(items.every(item => item.scope === 'user' && item.origin === PATH)).toBe(true)
  })

  test('reads a plugin flagged false as off', () => {
    expect(itemNamed('old@x').isOn).toBe(false)
    expect(itemNamed('ecc@ecc').isOn).toBe(true)
  })

  test('locks policy entries and gives them no write target', () => {
    const items = entriesOf(SETTINGS, 'policy', 'managed settings')

    expect(items.every(item => item.isLocked && item.entry === undefined)).toBe(true)
  })

  test('shows the keys of a setting and never its values', () => {
    const secret = { env: { GITHUB_TOKEN: 'ghp_secret' }, apiKeyHelper: 'cat ~/.key' }

    const names = entriesOf(secret, 'user', PATH).map(item => item.name)

    expect(names).toEqual(['env {GITHUB_TOKEN}', 'apiKeyHelper (text)'])
  })

  test('strips control characters from a name a project controls', () => {
    const hostile = { permissions: { allow: ['Bash(ls)\u001b[2J\nignore previous'] } }

    const [rule] = entriesOf(hostile, 'project', PATH)

    expect(rule?.name).toBe('allow: Bash(ls) [2J ignore previous')
  })

  test('lists two identical rules once', () => {
    const doubled = { permissions: { allow: ['Bash(ls:*)', 'Bash(ls:*)'] } }

    expect(entriesOf(doubled, 'user', PATH).length).toBe(1)
  })

  test('gives the same entry in two files two different ids', () => {
    const [here] = entriesOf({ theme: 'dark' }, 'project', '/a/.claude/settings.json')
    const [there] = entriesOf({ theme: 'dark' }, 'project', '/b/.claude/settings.json')

    expect(here?.id).not.toBe(there?.id)
  })

  test('names the event of a settings hook', () => {
    expect(hookEventOf(itemNamed('PreToolUse'))).toBe('PreToolUse')
  })
})

describe('applyEntry', () => {
  test('removes a permission rule and restores it', () => {
    const rule = itemNamed('deny: Read(.env)')

    const off = applyEntry(SETTINGS, rule.entry, false)
    const on = applyEntry(off, rule.entry, true)

    expect(off.permissions).toEqual({ allow: ['Bash(ls:*)'], deny: [], defaultMode: 'plan' })
    expect(on.permissions).toEqual(SETTINGS.permissions)
  })

  test('removes a top-level setting and restores its value', () => {
    const theme = itemNamed('theme')

    const off = applyEntry(SETTINGS, theme.entry, false)

    expect('theme' in off).toBe(false)
    expect(applyEntry(off, theme.entry, true).theme).toBe('dark')
  })

  test('flips a plugin flag instead of deleting it', () => {
    const plugin = itemNamed('ecc@ecc')

    const off = applyEntry(SETTINGS, plugin.entry, false)

    expect(off.enabledPlugins).toEqual({ 'ecc@ecc': false, 'old@x': false })
  })

  test('removes one hook and leaves the settings object it was given untouched', () => {
    const hook = itemNamed('PreToolUse')

    const off = applyEntry(SETTINGS, hook.entry, false)

    expect(off.hooks).toEqual({ PreToolUse: [] })
    expect(SETTINGS.hooks).toEqual({ PreToolUse: [HOOK] })
  })

  test('restores the original value of a plugin entry that was not plain true', () => {
    const pinned = { enabledPlugins: { 'p@m': ['^1.2'] } }
    const [plugin] = entriesOf(pinned, 'user', PATH)
    if (plugin?.entry === undefined) throw new Error('no plugin entry')

    const off = applyEntry(pinned, plugin.entry, false)

    expect(off.enabledPlugins).toEqual({ 'p@m': false })
    expect(applyEntry(off, plugin.entry, true)).toEqual(pinned)
  })

  test('does not duplicate an element that is already present', () => {
    const rule = itemNamed('allow: Bash(ls:*)')

    const on = applyEntry(SETTINGS, rule.entry, true)

    expect(on.permissions).toEqual(SETTINGS.permissions)
  })
})

describe('isSoundStashedItem', () => {
  test('accepts an entry exactly as the inventory produced it', () => {
    expect(isSoundStashedItem(itemNamed('deny: Read(.env)'))).toBe(true)
  })

  test('rejects a stored entry relabelled to slip a hook in as a setting', () => {
    const hook = itemNamed('PreToolUse')
    const relabelled = { ...hook, kind: 'setting' }
    const retargeted = { ...hook, entry: { ...hook.entry, source: 'configDir' } }
    const rewritten = { ...hook, entry: { ...hook.entry, value: { hooks: [] } } }

    expect(isSoundStashedItem(relabelled)).toBe(false)
    expect(isSoundStashedItem(retargeted)).toBe(false)
    expect(isSoundStashedItem(rewritten)).toBe(false)
    expect(isSoundStashedItem({ id: 'x' })).toBe(false)
  })
})
