import type { Item, Kind, Ledger, Profile, Scope } from '../types'

export const PLUGIN = 'pristine'
export const DEFAULT_PROFILE_NAME = 'default'
export const PRISTINE_PROFILE_NAME = 'pristine'
export const BUILTIN_PROFILES: readonly Profile[] = [
  { name: DEFAULT_PROFILE_NAME, base: 'on', overrides: {} },
  { name: PRISTINE_PROFILE_NAME, base: 'off', overrides: {} },
]

const PROFILE_NAME = /^[A-Za-z0-9_-]{1,40}$/
const KINDS_KEPT_BY_BASE: readonly Kind[] = ['permission', 'setting']

export const KIND_LABELS: Readonly<Record<Kind, string>> = {
  instruction: 'CLAUDE.md',
  rule: 'Rules',
  memory: 'Memories',
  skill: 'Skills & commands',
  agent: 'Agents',
  mcp: 'MCP servers',
  'hook-event': 'Hook events',
  hook: 'Hooks',
  plugin: 'Plugins',
  permission: 'Permissions',
  setting: 'Settings',
}

export const KINDS = Object.keys(KIND_LABELS) as Kind[]

export const SCOPES: readonly Scope[] = [
  'policy',
  'flag',
  'local',
  'project',
  'user',
  'plugin',
  'account',
  'memory',
  'mixed',
]

export const isValidProfileName = (name: string) => PROFILE_NAME.test(name)

export const isBuiltinProfile = (name: string) =>
  BUILTIN_PROFILES.some(profile => profile.name === name)

export const findProfile = (profiles: readonly Profile[], name: string) =>
  profiles.find(profile => profile.name === name) ?? BUILTIN_PROFILES[0]!

export const isEnabled = (profile: Profile, item: Item) => {
  if (item.isLocked) return true
  const override = profile.overrides[item.id]
  if (override !== undefined) return override
  if (KINDS_KEPT_BY_BASE.includes(item.kind)) return true

  return profile.base === 'on'
}

export const EMPTY_LEDGER: Ledger = { stash: {}, raised: [] }

export const desiredState = (profile: Profile, item: Item, ledger: Ledger) => {
  if (item.entry === undefined) return isEnabled(profile, item)
  if (item.isLocked) return item.isOn
  const override = profile.overrides[item.id]
  if (override !== undefined) return override
  const wasOnBeforePristine =
    !ledger.raised.includes(item.id) &&
    (item.isOn || ledger.stash[item.id] !== undefined)
  if (KINDS_KEPT_BY_BASE.includes(item.kind)) return wasOnBeforePristine

  return profile.base === 'on' && wasOnBeforePristine
}

export const isShownOn = (profile: Profile, item: Item) =>
  item.entry === undefined ? isEnabled(profile, item) : item.isOn

export const withOverride = (
  profile: Profile,
  id: string,
  isOn: boolean,
): Profile => ({
  ...profile,
  overrides: { ...profile.overrides, [id]: isOn },
})

export const upsertProfile = (
  profiles: readonly Profile[],
  profile: Profile,
): Profile[] =>
  profiles.some(one => one.name === profile.name)
    ? profiles.map(one => (one.name === profile.name ? profile : one))
    : [...profiles, profile]

export const removeProfile = (
  profiles: readonly Profile[],
  name: string,
): Profile[] => profiles.filter(profile => profile.name !== name)

export const withBuiltins = (profiles: readonly Profile[]): Profile[] => [
  ...BUILTIN_PROFILES.map(
    builtin => profiles.find(one => one.name === builtin.name) ?? builtin,
  ),
  ...profiles.filter(profile => !isBuiltinProfile(profile.name)),
]
