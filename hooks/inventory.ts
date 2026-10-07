import type { CommandInfo, InstructionFile, ToolInfo } from 'claude-code'

import type { Item, Ledger, Scope } from '../types'
import type { SettingsPaths } from './files'
import { KINDS, PLUGIN } from './model'
import { entriesOf, hookEventOf, isObject } from './settingsEdit'
import type { SettingsObject, SettingsSourceName } from './settingsEdit'

type Found = { items: Item[]; warnings: string[] }
export type SettingsReading =
  | { source: SettingsSourceName; origin: string; value: SettingsObject }
  | { warning: string }
export type HookSource = { event: string; origin: string; scope: Scope }
export type PluginScopes = Readonly<Record<string, string[]>>

const PATH_TAIL_SEGMENTS = 2
const AGENT_SCOPES = ['policy', 'flag', 'local', 'project', 'user'] as const
const INSTRUCTION_SCOPES: Readonly<Record<InstructionFile['kind'], Scope>> = {
  managed: 'policy',
  user: 'user',
  project: 'project',
  local: 'local',
  memory: 'memory',
}

const runtimeItem = (
  item: Pick<Item, 'id' | 'kind' | 'name' | 'scope' | 'origin'>,
  isLocked = false,
): Item => ({ ...item, isLocked, isOn: true })

const MCP_TOOL = /^mcp__(.+?)__/

export const mcpServerOf = (tool: string) => MCP_TOOL.exec(tool)?.[1]

export const instructionItem = (file: InstructionFile): Item => {
  const kind =
    file.kind === 'memory'
      ? 'memory'
      : file.path.includes('/rules/')
        ? 'rule'
        : 'instruction'
  const imported = file.parent === undefined ? '' : ` (@import from ${file.parent})`

  return runtimeItem(
    {
      id: `${kind}:${file.path}`,
      kind,
      name: file.path.split('/').slice(-PATH_TAIL_SEGMENTS).join('/'),
      scope: INSTRUCTION_SCOPES[file.kind],
      origin: `${file.path}${imported}`,
    },
    file.kind === 'managed',
  )
}

export const agentItem = (agent: string, source: string, plugin: string): Item => {
  const scope =
    AGENT_SCOPES.find(one => source.toLowerCase().includes(one)) ?? 'plugin'

  return runtimeItem(
    {
      id: `agent:${agent}`,
      kind: 'agent',
      name: agent,
      scope,
      origin: scope === 'plugin' ? `plugin ${plugin}` : source,
    },
    scope === 'policy',
  )
}

const isOwnPlugin = (item: Item) =>
  item.kind === 'plugin' && item.name.split('@')[0] === PLUGIN

const lockedCopy = ({ entry, ...item }: Item): Item => ({ ...item, isLocked: true })

export const settingsFound = (
  readings: readonly SettingsReading[],
  ledger: Ledger,
): Found => {
  const live = readings
    .flatMap(reading =>
      'warning' in reading
        ? []
        : entriesOf(reading.value, reading.source, reading.origin),
    )
    .map(item => (isOwnPlugin(item) ? lockedCopy(item) : item))
  const liveIds = new Set(live.map(item => item.id))
  const readOrigins = readings.flatMap(reading =>
    'warning' in reading ? [] : [reading.origin],
  )
  const stashed = Object.values(ledger.stash)
    .filter(item => !liveIds.has(item.id) && readOrigins.includes(item.origin))
    .map(item => ({ ...item, isOn: false }))

  return {
    items: [...live, ...stashed],
    warnings: readings.flatMap(reading =>
      'warning' in reading ? [reading.warning] : [],
    ),
  }
}

export const pluginScopes = (settings: readonly Item[]): PluginScopes =>
  settings
    .filter(item => item.kind === 'plugin')
    .reduce<Record<string, string[]>>((scopes, item) => {
      const name = item.name.split('@')[0] ?? item.name

      return { ...scopes, [name]: [...(scopes[name] ?? []), item.scope] }
    }, {})

const UNSAFE_NAME = /[\\/]|\.\./

const isManagedCommand = (command: CommandInfo) =>
  command.source !== 'builtin' && command.plugin !== PLUGIN

const projectPathsOf = (name: string, paths: SettingsPaths) => [
  `${paths.root}/.claude/skills/${name}`,
  `${paths.root}/.claude/commands/${name}.md`,
]

export const projectCandidates = (
  commands: readonly CommandInfo[],
  paths: SettingsPaths,
) =>
  commands
    .filter(
      command =>
        isManagedCommand(command) &&
        command.source === 'user' &&
        !UNSAFE_NAME.test(command.name),
    )
    .flatMap(command => projectPathsOf(command.name, paths))

const commandPlace = (
  command: CommandInfo,
  paths: SettingsPaths,
  scopes: PluginScopes,
  existing: readonly string[],
): Pick<Item, 'scope' | 'origin'> => {
  if (command.source === 'mcp') return { scope: 'user', origin: 'MCP server prompt' }
  if (command.source === 'plugin') {
    const plugin = command.plugin ?? 'unknown plugin'
    const installed = (scopes[plugin] ?? []).join(', ')

    return {
      scope: 'plugin',
      origin: `plugin ${plugin}${installed === '' ? '' : ` (${installed})`}`,
    }
  }
  const inProject = projectPathsOf(command.name, paths).find(path =>
    existing.includes(path),
  )

  return inProject === undefined
    ? { scope: 'user', origin: `${paths.configDir}/skills or commands` }
    : { scope: 'project', origin: inProject }
}

export const commandItems = (
  commands: readonly CommandInfo[],
  paths: SettingsPaths,
  scopes: PluginScopes,
  existing: readonly string[],
): Item[] =>
  commands.filter(isManagedCommand).map(command =>
    runtimeItem({
      id: `skill:${command.name}`,
      kind: 'skill',
      name: command.name,
      ...commandPlace(command, paths, scopes, existing),
    }),
  )

const mcpPlace = (
  server: string,
  projectServers: readonly string[],
  paths: SettingsPaths,
): Pick<Item, 'scope' | 'origin'> => {
  if (projectServers.includes(server))
    return { scope: 'project', origin: `${paths.root}/.mcp.json` }
  if (server.startsWith('claude_ai_'))
    return { scope: 'account', origin: 'claude.ai connector' }

  return server.startsWith('plugin_')
    ? { scope: 'plugin', origin: `plugin ${server.split('_')[1] ?? ''}` }
    : { scope: 'user', origin: `${paths.configDir}/.claude.json` }
}

export const mcpItems = (
  tools: readonly ToolInfo[],
  projectServers: readonly string[],
  paths: SettingsPaths,
): Item[] => {
  const counts = tools
    .filter(tool => tool.mcp)
    .reduce<Record<string, number>>((byServer, tool) => {
      const server = mcpServerOf(tool.name)

      return server === undefined
        ? byServer
        : { ...byServer, [server]: (byServer[server] ?? 0) + 1 }
    }, {})

  return Object.entries(counts).map(([server, count]) =>
    runtimeItem({
      id: `mcp:${server}`,
      kind: 'mcp',
      name: `${server} (${count} tools)`,
      ...mcpPlace(server, projectServers, paths),
    }),
  )
}

export const mcpServerNames = (mcpFile: SettingsObject) =>
  Object.keys(isObject(mcpFile.mcpServers) ? mcpFile.mcpServers : {})

export const enabledPluginHookFiles = (
  registry: SettingsObject,
  scopes: PluginScopes,
) =>
  Object.entries(isObject(registry.plugins) ? registry.plugins : {}).flatMap(
    ([key, installs]) => {
      const first = Array.isArray(installs) ? installs[0] : undefined
      const installPath = isObject(first) ? first.installPath : undefined
      const name = key.split('@')[0] ?? key

      return typeof installPath === 'string' && scopes[name] !== undefined
        ? [{ key, path: `${installPath}/hooks/hooks.json` }]
        : []
    },
  )

export const pluginHookSources = (
  key: string,
  hooksFile: SettingsObject,
  scopes: PluginScopes,
): HookSource[] => {
  const isForcedByPolicy = (scopes[key.split('@')[0] ?? key] ?? []).includes('policy')

  return Object.entries(isObject(hooksFile.hooks) ? hooksFile.hooks : {}).flatMap(
    ([event, list]) =>
      (Array.isArray(list) ? list : []).map(() => ({
        event,
        origin: key,
        scope: isForcedByPolicy ? ('policy' as const) : ('plugin' as const),
      })),
  )
}

const countLabel = (origins: readonly string[]) =>
  Object.entries(
    origins.reduce<Record<string, number>>(
      (counts, origin) => ({ ...counts, [origin]: (counts[origin] ?? 0) + 1 }),
      {},
    ),
  )
    .map(([origin, count]) => `${origin} ×${count}`)
    .join(', ')

export const hookEventItems = (
  settings: readonly Item[],
  fromPlugins: readonly HookSource[],
  isPolicyKnown = true,
): Item[] => {
  const fromSettings = settings.flatMap(item => {
    const event = hookEventOf(item)

    return event === undefined || !item.isOn
      ? []
      : [{ event, origin: `${item.scope} settings`, scope: item.scope }]
  })
  const sources = [...fromSettings, ...fromPlugins]

  return [...new Set(sources.map(source => source.event))].map(event => {
    const mine = sources.filter(source => source.event === event)
    const scopes = [...new Set(mine.map(source => source.scope))]

    return runtimeItem(
      {
        id: `hook-event:${event}`,
        kind: 'hook-event',
        name: `${event} (${mine.length} hooks, muted together)`,
        scope: scopes.length === 1 && scopes[0] !== undefined ? scopes[0] : 'mixed',
        origin: countLabel(mine.map(source => source.origin)),
      },
      !isPolicyKnown || scopes.includes('policy'),
    )
  })
}

export const sorted = (items: readonly Item[]): Item[] =>
  [...items].sort(
    (left, right) =>
      KINDS.indexOf(left.kind) - KINDS.indexOf(right.kind) ||
      left.name.localeCompare(right.name),
  )
