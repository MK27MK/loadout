import { describe, expect, test } from 'claude-code/testing'

import {
  BUILTIN_PROFILES,
  EMPTY_LEDGER,
  desiredState,
  findProfile,
  isEnabled,
  isValidProfileName,
  removeProfile,
  upsertProfile,
  withBuiltins,
  withOverride,
} from '../hooks/model'
import type { Item, Profile } from '../types'

const DEFAULT = BUILTIN_PROFILES[0]!
const PRISTINE = BUILTIN_PROFILES[1]!
const SKILL: Item = {
  id: 'skill:ecc:plan',
  kind: 'skill',
  name: 'ecc:plan',
  scope: 'plugin',
  origin: 'ecc',
  isLocked: false,
  isOn: true,
}
const PLUGIN_FLAG: Item = {
  id: 'plugin:user:enabledPlugins.ecc@ecc:',
  kind: 'plugin',
  name: 'ecc@ecc',
  scope: 'user',
  origin: '/home/.claude/settings.json',
  isLocked: false,
  isOn: true,
  entry: {
    mode: 'flag',
    source: 'user',
    path: ['enabledPlugins', 'ecc@ecc'],
    value: true,
  },
}
const DENY_RULE: Item = {
  ...PLUGIN_FLAG,
  id: 'permission:user:permissions.deny:"Bash(rm:*)"',
  kind: 'permission',
  entry: {
    mode: 'element',
    source: 'user',
    path: ['permissions', 'deny'],
    value: 'Bash(rm:*)',
  },
}

describe('isEnabled', () => {
  test('follows the profile base when no override exists', () => {
    expect(isEnabled(DEFAULT, SKILL)).toBe(true)
    expect(isEnabled(PRISTINE, SKILL)).toBe(false)
  })

  test('lets an override win over the base', () => {
    const composed = withOverride(PRISTINE, SKILL.id, true)

    expect(isEnabled(composed, SKILL)).toBe(true)
  })

  test('keeps a locked item on whatever the profile says', () => {
    const locked = { ...SKILL, isLocked: true }
    const forcedOff = withOverride(PRISTINE, SKILL.id, false)

    expect(isEnabled(forcedOff, locked)).toBe(true)
  })

  test('keeps permissions on under an all-off base', () => {
    expect(isEnabled(PRISTINE, DENY_RULE)).toBe(true)
  })
})

describe('desiredState', () => {
  test('turns a plugin off under an all-off base', () => {
    expect(desiredState(PRISTINE, PLUGIN_FLAG, EMPTY_LEDGER)).toBe(false)
  })

  test('restores under an all-on base only what pristine turned off', () => {
    const off = { ...PLUGIN_FLAG, isOn: false }

    const stashed = { stash: { [off.id]: off }, raised: [] }

    expect(desiredState(DEFAULT, off, stashed)).toBe(true)
    expect(desiredState(DEFAULT, off, EMPTY_LEDGER)).toBe(false)
  })

  test('turns back off under default what a profile had switched on', () => {
    const raised = { stash: {}, raised: [PLUGIN_FLAG.id] }

    expect(desiredState(DEFAULT, PLUGIN_FLAG, raised)).toBe(false)
  })

  test('never removes a permission rule without an explicit override', () => {
    expect(desiredState(PRISTINE, DENY_RULE, EMPTY_LEDGER)).toBe(true)
    expect(
      desiredState(withOverride(PRISTINE, DENY_RULE.id, false), DENY_RULE, EMPTY_LEDGER),
    ).toBe(false)
  })
})

describe('profiles', () => {
  test('withOverride returns a new profile and leaves the original alone', () => {
    const changed = withOverride(DEFAULT, SKILL.id, false)

    expect(changed.overrides[SKILL.id]).toBe(false)
    expect(DEFAULT.overrides[SKILL.id]).toBeUndefined()
  })

  test('upsertProfile replaces a profile of the same name', () => {
    const custom: Profile = { name: 'ecc-react', base: 'off', overrides: {} }
    const added = upsertProfile(BUILTIN_PROFILES, custom)
    const replaced = upsertProfile(added, { ...custom, base: 'on' })

    expect(added.length).toBe(3)
    expect(replaced.length).toBe(3)
    expect(findProfile(replaced, 'ecc-react').base).toBe('on')
  })

  test('findProfile falls back to default for an unknown name', () => {
    expect(findProfile(BUILTIN_PROFILES, 'missing').name).toBe('default')
  })

  test('removeProfile drops only the named profile', () => {
    const custom: Profile = { name: 'ecc-react', base: 'off', overrides: {} }

    expect(removeProfile([...BUILTIN_PROFILES, custom], 'ecc-react').length).toBe(2)
  })

  test('withBuiltins always carries default and pristine first', () => {
    const custom: Profile = { name: 'ecc-react', base: 'off', overrides: {} }

    expect(withBuiltins([custom]).map(profile => profile.name)).toEqual([
      'default',
      'pristine',
      'ecc-react',
    ])
  })

  test('rejects profile names with spaces or path characters', () => {
    expect(isValidProfileName('superpowers-ponytail')).toBe(true)
    expect(isValidProfileName('../etc')).toBe(false)
    expect(isValidProfileName('')).toBe(false)
  })
})
