import type { Item, Kind, Ledger, Profile, Scope } from '../types'

export const PLUGIN = 'pristine'
export const DEFAULT_PROFILE_NAME = 'default'
export const VANILLA_PROFILE_NAME = 'vanilla'
export const DEFAULT_PROFILE: Profile = {
  name: DEFAULT_PROFILE_NAME,
  base: 'on',
  overrides: {},
}
export const VANILLA_PROFILE: Profile = {
  name: VANILLA_PROFILE_NAME,
  base: 'off',
  overrides: {},
}
export const INITIAL_PROFILES: readonly Profile[] = [DEFAULT_PROFILE, VANILLA_PROFILE]

const LEGACY_VANILLA_PROFILE_NAME = 'pristine'

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

export const nameProblem = (profiles: readonly Profile[], name: string) => {
  if (name === '') return 'A profile name is required.'
  if (!isValidProfileName(name))
    return 'A profile name is 1-40 letters, digits, "-" or "_".'
  if (profiles.some(profile => profile.name === name))
    return `Profile "${name}" already exists.`

  return undefined
}

export const isFixedProfile = (name: string) => name === VANILLA_PROFILE_NAME

export const fallbackProfile = (profiles: readonly Profile[]) =>
  profiles.find(profile => !isFixedProfile(profile.name)) ?? VANILLA_PROFILE

export const findProfile = (profiles: readonly Profile[], name: string) =>
  profiles.find(profile => profile.name === name) ?? fallbackProfile(profiles)

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

export const renameProfile = (
  profiles: readonly Profile[],
  from: string,
  to: string,
): Profile[] =>
  profiles.map(profile => (profile.name === from ? { ...profile, name: to } : profile))

const currentNameOf = (name: string) =>
  name === LEGACY_VANILLA_PROFILE_NAME ? VANILLA_PROFILE_NAME : name

export const withoutLegacyNames = (profiles: readonly Profile[]): Profile[] =>
  profiles.some(profile => profile.name === VANILLA_PROFILE_NAME)
    ? [...profiles]
    : renameProfile(profiles, LEGACY_VANILLA_PROFILE_NAME, VANILLA_PROFILE_NAME)

export const withVanilla = (profiles: readonly Profile[]): Profile[] =>
  profiles.some(profile => isFixedProfile(profile.name))
    ? profiles.map(profile => (isFixedProfile(profile.name) ? VANILLA_PROFILE : profile))
    : [...profiles, VANILLA_PROFILE]

export const restoredProfiles = (
  stored: readonly Profile[] | undefined,
  wanted: unknown,
) => {
  const profiles = withVanilla(withoutLegacyNames(stored ?? INITIAL_PROFILES))
  const isNamed = (name: unknown) => profiles.some(profile => profile.name === name)
  const carried = isNamed(wanted) ? String(wanted) : currentNameOf(String(wanted))

  return {
    profiles,
    active: isNamed(carried) ? carried : fallbackProfile(profiles).name,
  }
}
