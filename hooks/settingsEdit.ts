import type {
  Item,
  Json,
  Scope,
  SettingsEntry,
  WritableSource,
} from '../types'

export type SettingsObject = { [key: string]: Json }
export type SettingsSourceName = WritableSource | 'policy' | 'flag'

const PERMISSION_LISTS = ['allow', 'deny', 'ask'] as const
const SPECIAL_KEYS = ['enabledPlugins', 'permissions', 'hooks']
const NAME_LIMIT = 70
const WRITABLE: readonly string[] = ['user', 'project', 'local']

export const isObject = (value: unknown): value is SettingsObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g

const clip = (raw: string) => {
  const text = raw.replace(CONTROL_CHARACTERS, ' ')

  return text.length > NAME_LIMIT ? `${text.slice(0, NAME_LIMIT - 1)}…` : text
}

const describeValue = (key: string, value: Json) => {
  if (typeof value === 'boolean' || typeof value === 'number' || value === null)
    return `${key} = ${String(value)}`
  if (typeof value === 'string') return `${key} (text)`
  if (Array.isArray(value)) return `${key} (list of ${value.length})`

  return `${key} {${Object.keys(value).join(', ')}}`
}

const isSame = (left: Json, right: Json) =>
  JSON.stringify(left) === JSON.stringify(right)

const getAt = (root: Json, path: readonly string[]): Json | undefined =>
  path.reduce<Json | undefined>(
    (node, key) => (isObject(node) ? node[key] : undefined),
    root,
  )

const setAt = (
  root: SettingsObject,
  path: readonly string[],
  value: Json | undefined,
): SettingsObject => {
  const [head, ...rest] = path
  if (head === undefined) return root
  if (rest.length > 0) {
    const child = root[head]

    return { ...root, [head]: setAt(isObject(child) ? child : {}, rest, value) }
  }
  if (value !== undefined) return { ...root, [head]: value }
  const { [head]: removed, ...kept } = root

  return kept
}

export const applyEntry = (
  settings: SettingsObject,
  entry: SettingsEntry,
  isOn: boolean,
): SettingsObject => {
  if (entry.mode === 'flag')
    return setAt(
      settings,
      entry.path,
      isOn && entry.value !== false ? entry.value : isOn,
    )
  if (entry.mode === 'key')
    return setAt(settings, entry.path, isOn ? entry.value : undefined)
  const current = getAt(settings, entry.path)
  const list = Array.isArray(current) ? current : []
  const others = list.filter(one => !isSame(one, entry.value))

  return setAt(settings, entry.path, isOn ? [...others, entry.value] : others)
}

const hookName = (event: string, hook: Json) => {
  if (!isObject(hook)) return `${event}: ${clip(JSON.stringify(hook))}`
  const matcher = typeof hook.matcher === 'string' ? hook.matcher : '*'
  const first = Array.isArray(hook.hooks) ? hook.hooks[0] : undefined
  const command =
    isObject(first) && typeof first.command === 'string'
      ? first.command
      : JSON.stringify(first ?? null)

  return clip(`${event} [${matcher}] ${command}`)
}

type Draft = Pick<Item, 'kind' | 'name' | 'isOn' | 'event'> & {
  mode: SettingsEntry['mode']
  path: string[]
  value: Json
}

const pluginDrafts = (settings: SettingsObject): Draft[] =>
  Object.entries(isObject(settings.enabledPlugins) ? settings.enabledPlugins : {})
    .map(([name, value]) => ({
      kind: 'plugin' as const,
      name,
      isOn: value !== false,
      mode: 'flag' as const,
      path: ['enabledPlugins', name],
      value,
    }))

const permissionDrafts = (settings: SettingsObject): Draft[] => {
  const permissions = isObject(settings.permissions) ? settings.permissions : {}
  const rules = PERMISSION_LISTS.flatMap(list => {
    const values = permissions[list]

    return (Array.isArray(values) ? values : []).map(rule => ({
      kind: 'permission' as const,
      name: clip(`${list}: ${typeof rule === 'string' ? rule : JSON.stringify(rule)}`),
      isOn: true,
      mode: 'element' as const,
      path: ['permissions', list],
      value: rule,
    }))
  })
  const others = Object.entries(permissions)
    .filter(([key]) => !PERMISSION_LISTS.some(list => list === key))
    .map(([key, value]) => ({
      kind: 'permission' as const,
      name: clip(`${key} = ${JSON.stringify(value)}`),
      isOn: true,
      mode: 'key' as const,
      path: ['permissions', key],
      value,
    }))

  return [...rules, ...others]
}

const hookDrafts = (settings: SettingsObject): Draft[] =>
  Object.entries(isObject(settings.hooks) ? settings.hooks : {}).flatMap(
    ([event, hooks]) =>
      (Array.isArray(hooks) ? hooks : []).map(hook => ({
        kind: 'hook' as const,
        event,
        name: hookName(event, hook),
        isOn: true,
        mode: 'element' as const,
        path: ['hooks', event],
        value: hook,
      })),
  )

const settingDrafts = (settings: SettingsObject): Draft[] =>
  Object.entries(settings)
    .filter(([key]) => !SPECIAL_KEYS.includes(key))
    .map(([key, value]) => ({
      kind: 'setting' as const,
      name: clip(describeValue(key, value)),
      isOn: true,
      mode: 'key' as const,
      path: [key],
      value,
    }))

export const entryIdOf = (
  kind: string,
  origin: string,
  entry: Pick<SettingsEntry, 'mode' | 'path' | 'value'>,
) =>
  [
    kind,
    origin,
    entry.path.join('.'),
    entry.mode === 'element' ? JSON.stringify(entry.value) : '',
  ].join(':')

const uniqueById = (items: readonly Item[]) =>
  items.filter((item, index) => items.findIndex(one => one.id === item.id) === index)

export const entriesOf = (
  settings: SettingsObject,
  source: SettingsSourceName,
  origin: string,
): Item[] =>
  uniqueById(
    [
      ...pluginDrafts(settings),
      ...permissionDrafts(settings),
      ...hookDrafts(settings),
      ...settingDrafts(settings),
    ].map(({ mode, path, value, ...shown }) => {
      const base = {
        ...shown,
        id: entryIdOf(shown.kind, origin, { mode, path, value }),
        scope: source as Scope,
        origin,
      }

      return WRITABLE.includes(source)
        ? {
            ...base,
            isLocked: false,
            entry: { mode, source: source as WritableSource, path, value },
          }
        : { ...base, isLocked: true }
    }),
  )

const ROOT_KEY_OF_KIND: Readonly<Record<string, string>> = {
  plugin: 'enabledPlugins',
  permission: 'permissions',
  hook: 'hooks',
}
const MODES: readonly string[] = ['flag', 'key', 'element']

export const isSoundStashedItem = (value: unknown): value is Item => {
  if (!isObject(value) || !isObject(value.entry)) return false
  const { id, kind, name, origin, entry } = value
  const { mode, source, path } = entry
  if (typeof id !== 'string' || typeof kind !== 'string') return false
  if (typeof name !== 'string' || typeof origin !== 'string') return false
  if (typeof mode !== 'string' || !MODES.includes(mode)) return false
  if (typeof source !== 'string' || !WRITABLE.includes(source)) return false
  if (!Array.isArray(path) || path.length === 0) return false
  if (!path.every((key): key is string => typeof key === 'string')) return false
  if (entry.value === undefined) return false
  const rootKey = ROOT_KEY_OF_KIND[kind]
  const isRootRight =
    kind === 'setting'
      ? !SPECIAL_KEYS.includes(path[0] ?? '')
      : rootKey !== undefined && path[0] === rootKey

  return (
    isRootRight &&
    id === entryIdOf(kind, origin, { mode: mode as SettingsEntry['mode'], path, value: entry.value })
  )
}

export const hookEventOf = (item: Item) =>
  item.kind === 'hook' ? item.event : undefined
