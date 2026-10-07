import { describe, expect, test } from 'claude-code/testing'

import {
  EMPTY_LEDGER,
  INITIAL_PROFILES,
  desiredState,
  findProfile,
  isEnabled,
  isValidProfileName,
  nameProblem,
  removeProfile,
  renameProfile,
  restoredProfiles,
  upsertProfile,
  withVanilla,
  withoutLegacyNames,
  withOverride,
} from '../hooks/model'
import type { Item, Profile } from '../types'

const DEFAULT = INITIAL_PROFILES[0]!
const VANILLA = INITIAL_PROFILES[1]!
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
    expect(isEnabled(VANILLA, SKILL)).toBe(false)
  })

  test('lets an override win over the base', () => {
    const composed = withOverride(VANILLA, SKILL.id, true)

    expect(isEnabled(composed, SKILL)).toBe(true)
  })

  test('keeps a locked item on whatever the profile says', () => {
    const locked = { ...SKILL, isLocked: true }
    const forcedOff = withOverride(VANILLA, SKILL.id, false)

    expect(isEnabled(forcedOff, locked)).toBe(true)
  })

  test('keeps permissions on under an all-off base', () => {
    expect(isEnabled(VANILLA, DENY_RULE)).toBe(true)
  })
})

describe('desiredState', () => {
  test('turns a plugin off under an all-off base', () => {
    expect(desiredState(VANILLA, PLUGIN_FLAG, EMPTY_LEDGER)).toBe(false)
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
    expect(desiredState(VANILLA, DENY_RULE, EMPTY_LEDGER)).toBe(true)
    expect(
      desiredState(withOverride(VANILLA, DENY_RULE.id, false), DENY_RULE, EMPTY_LEDGER),
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
    const added = upsertProfile(INITIAL_PROFILES, custom)
    const replaced = upsertProfile(added, { ...custom, base: 'on' })

    expect(added.length).toBe(3)
    expect(replaced.length).toBe(3)
    expect(findProfile(replaced, 'ecc-react').base).toBe('on')
  })

  test('findProfile falls back to default for an unknown name', () => {
    expect(findProfile(INITIAL_PROFILES, 'missing').name).toBe('default')
  })

  test('removeProfile drops only the named profile', () => {
    const custom: Profile = { name: 'ecc-react', base: 'off', overrides: {} }

    expect(removeProfile([...INITIAL_PROFILES, custom], 'ecc-react').length).toBe(2)
  })

  test('withVanilla adds vanilla and never brings a deleted default back', () => {
    const custom: Profile = { name: 'ecc-react', base: 'off', overrides: {} }

    expect(withVanilla([custom])).toEqual([custom, VANILLA])
  })

  test('withVanilla undoes any change stored on vanilla and keeps its place', () => {
    const changed = withOverride(VANILLA, SKILL.id, true)

    expect(withVanilla([changed, DEFAULT])).toEqual([VANILLA, DEFAULT])
  })

  test('findProfile falls back to vanilla once no other profile is left', () => {
    expect(findProfile([VANILLA], 'missing')).toEqual(VANILLA)
  })

  test('renameProfile renames only the named profile and keeps its place', () => {
    const custom: Profile = { name: 'temp', base: 'off', overrides: { [SKILL.id]: true } }
    const profiles = [DEFAULT, custom, VANILLA]

    const renamed = renameProfile(profiles, 'temp', 'ecc-react')

    expect(renamed).toEqual([DEFAULT, { ...custom, name: 'ecc-react' }, VANILLA])
    expect(custom.name).toBe('temp')
  })

  test('withoutLegacyNames turns a stored pristine profile into vanilla', () => {
    const legacy: Profile = { name: 'pristine', base: 'off', overrides: { [SKILL.id]: true } }

    expect(withoutLegacyNames([legacy])).toEqual([{ ...legacy, name: 'vanilla' }])
  })

  test('withoutLegacyNames leaves the profiles alone once vanilla is stored', () => {
    const legacy: Profile = { name: 'pristine', base: 'off', overrides: {} }
    const profiles = [legacy, VANILLA]

    expect(withoutLegacyNames(profiles)).toEqual(profiles)
  })

  test('restoredProfiles carries a stored pristine profile and its selection to vanilla', () => {
    const legacy: Profile = { name: 'pristine', base: 'off', overrides: { [SKILL.id]: true } }

    const restored = restoredProfiles([legacy], 'pristine')

    expect(restored).toEqual({ profiles: [VANILLA], active: 'vanilla' })
  })

  test('restoredProfiles starts a fresh install with default and vanilla only', () => {
    expect(restoredProfiles(undefined, undefined)).toEqual({
      profiles: [DEFAULT, VANILLA],
      active: 'default',
    })
  })

  test('restoredProfiles keeps a renamed default and does not add another', () => {
    const renamed: Profile = { ...DEFAULT, name: 'mine' }

    expect(restoredProfiles([renamed, VANILLA], 'mine')).toEqual({
      profiles: [renamed, VANILLA],
      active: 'mine',
    })
  })

  test('restoredProfiles falls back to another profile when the stored selection is gone', () => {
    const custom: Profile = { name: 'ecc-react', base: 'on', overrides: {} }

    expect(restoredProfiles([VANILLA, custom], 'deleted').active).toBe('ecc-react')
    expect(restoredProfiles([], undefined).active).toBe('vanilla')
  })

  test('nameProblem asks for a name, a valid one, and one not taken', () => {
    expect(nameProblem(INITIAL_PROFILES, '')).toBe('A profile name is required.')
    expect(nameProblem(INITIAL_PROFILES, '../etc')).toContain('A profile name is 1-40')
    expect(nameProblem(INITIAL_PROFILES, 'vanilla')).toBe('Profile "vanilla" already exists.')
    expect(nameProblem(INITIAL_PROFILES, 'ecc-react')).toBeUndefined()
  })

  test('rejects profile names with spaces or path characters', () => {
    expect(isValidProfileName('superpowers-ponytail')).toBe(true)
    expect(isValidProfileName('../etc')).toBe(false)
    expect(isValidProfileName('')).toBe(false)
  })
})
