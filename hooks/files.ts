import type { Item, Ledger, WritableSource } from '../types'
import { applyEntry, isObject } from './settingsEdit'
import type { SettingsObject } from './settingsEdit'

export type SettingsPaths = Record<WritableSource, string> & {
  configDir: string
  root: string
}

const BACKUP_FOLDER = 'pristine-backups'
const JSON_INDENT = 2
const UNSAFE_FILE_CHARACTERS = /[^A-Za-z0-9]+/g

const isAbsolute = (path: string | undefined): path is string =>
  path !== undefined && path.startsWith('/')

export const pathsFrom = (
  home: string | undefined,
  configDirOverride: string | undefined,
  root: string,
): SettingsPaths => {
  if (!isAbsolute(root)) throw new Error('the session has no absolute project root')
  if (!isAbsolute(configDirOverride) && !isAbsolute(home))
    throw new Error('neither CLAUDE_CONFIG_DIR nor HOME is an absolute path')
  const configDir = isAbsolute(configDirOverride) ? configDirOverride : `${home}/.claude`

  return {
    configDir,
    root,
    user: `${configDir}/settings.json`,
    project: `${root}/.claude/settings.json`,
    local: `${root}/.claude/settings.local.json`,
  }
}

export const backupPathOf = (configDir: string, path: string) =>
  `${configDir}/${BACKUP_FOLDER}/${path.replace(UNSAFE_FILE_CHARACTERS, '_')}.json`

export const parseJsonObject = (text: string, path: string): SettingsObject => {
  try {
    const parsed: unknown = JSON.parse(text)
    if (isObject(parsed)) return parsed
  } catch {
    throw new Error(`${path} is not valid JSON`)
  }
  throw new Error(`${path} does not hold a JSON object`)
}

export const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

export const rewrittenSettings = (
  settings: SettingsObject,
  item: Item,
  isOn: boolean,
) => {
  if (item.entry === undefined || item.isLocked)
    throw new Error(`${item.name} is not a writable settings entry`)

  return `${JSON.stringify(applyEntry(settings, item.entry, isOn), null, JSON_INDENT)}\n`
}

const withoutId = <Value>(record: Readonly<Record<string, Value>>, id: string) =>
  Object.fromEntries(Object.entries(record).filter(([key]) => key !== id))

export const ledgerAfter = (ledger: Ledger, item: Item, isOn: boolean): Ledger => {
  const isRaised = ledger.raised.includes(item.id)
  const isStashed = ledger.stash[item.id] !== undefined
  if (!isOn && isRaised)
    return { ...ledger, raised: ledger.raised.filter(id => id !== item.id) }
  if (!isOn)
    return { ...ledger, stash: { ...ledger.stash, [item.id]: { ...item, isOn: false } } }
  if (isStashed) return { ...ledger, stash: withoutId(ledger.stash, item.id) }

  return isRaised ? ledger : { ...ledger, raised: [...ledger.raised, item.id] }
}
