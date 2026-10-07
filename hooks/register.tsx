import { atom, read, update } from 'claude-code'
import type { EngineInterface, PromptOrigin, Register } from 'claude-code'

import type { Item, Kind, Ledger, Profile, ProfileAction, View } from '../types'
import {
  backupPathOf,
  ledgerAfter,
  messageOf,
  parseJsonObject,
  pathsFrom,
  rewrittenSettings,
} from './files'
import {
  agentItem,
  commandItems,
  enabledPluginHookFiles,
  hookEventItems,
  instructionItem,
  mcpItems,
  mcpServerNames,
  mcpServerOf,
  pluginHookSources,
  pluginScopes,
  projectCandidates,
  settingsFound,
  sorted,
} from './inventory'
import type { SettingsReading } from './inventory'
import {
  DEFAULT_PROFILE,
  DEFAULT_PROFILE_NAME,
  EMPTY_LEDGER,
  INITIAL_PROFILES,
  PLUGIN,
  desiredState,
  fallbackProfile,
  findProfile,
  isEnabled,
  isFixedProfile,
  isShownOn,
  isValidProfileName,
  nameProblem,
  removeProfile,
  renameProfile,
  restoredProfiles,
  upsertProfile,
  withOverride,
} from './model'
import { isObject, isSoundStashedItem } from './settingsEdit'
import { drawBand, drawPane, profileOfKey } from './view'

const PANE = 'pristine'
const PANE_ROWS = 24
const FALLBACK_ROWS = 30
const FALLBACK_COLUMNS = 100
const CORE_TIER = 'core'
const PROFILES_KEY = 'profiles'
const ACTIVE_KEY = 'active'
const LEDGER_KEY = 'ledger'
const WRITABLE_SOURCES = ['user', 'project', 'local'] as const
const LOCKED_SOURCES = [
  { source: 'policy', origin: 'managed settings' },
  { source: 'flag', origin: 'command-line flag' },
] as const
const READ_ONLY_VERBS = ['', 'list', 'status']
const PERSON_ORIGINS: readonly string[] = ['composer', 'bridge']
const USAGE =
  'Usage: /pristine [list | status | use <profile> | new <profile> [on|off] | rename <profile> <new name> | delete <profile> | restore]'
const NO_ITEMS: Item[] = []
const STARTING_PROFILES: Profile[] = [...INITIAL_PROFILES]
const INITIAL_VIEW: View = {
  open: [],
  scope: 'all',
  page: 0,
  notice: '',
  edit: 'none',
  target: '',
  focused: '',
}
const VIEW_SHAPE = 'sections-v2'
const FIRST_NAME_QUESTION =
  'What should pristine call the profile that carries your current setup?'
const FIRST_NAME_OPTIONS = {
  header: 'Profile',
  options: [DEFAULT_PROFILE_NAME, 'personal'],
} as const

const profilesAtom = atom({ plugin: 'pristine', key: 'profiles' } as const, STARTING_PROFILES)
const activeAtom = atom({ plugin: 'pristine', key: 'active' } as const, DEFAULT_PROFILE_NAME)
const seenAtom = atom({ plugin: 'pristine', key: 'seen' } as const, NO_ITEMS)
const itemsAtom = atom({ plugin: 'pristine', key: 'items' } as const, NO_ITEMS)
const viewAtom = atom({ plugin: 'pristine', key: 'view' } as const, INITIAL_VIEW, {
  shape: VIEW_SHAPE,
})

let lastMutation: Promise<unknown> = Promise.resolve()

const inTurn = <Result,>(work: () => Promise<Result>): Promise<Result> => {
  const run = lastMutation.then(work, work)
  lastMutation = run.catch(() => undefined)

  return run
}

const isProfile = (value: unknown): value is Profile =>
  isObject(value) &&
  typeof value.name === 'string' &&
  isValidProfileName(value.name) &&
  (value.base === 'on' || value.base === 'off') &&
  isObject(value.overrides) &&
  Object.values(value.overrides).every(one => typeof one === 'boolean')

const settingsPaths = async ($: EngineInterface) =>
  pathsFrom(
    await $.env.get('HOME'),
    await $.env.get('CLAUDE_CONFIG_DIR'),
    await $.session.root(),
  )

const readObject = async ($: EngineInterface, path: string) => {
  if (!(await $.fs.exists(path))) return { value: {}, text: undefined }
  const text = await $.fs.read(path)

  return { value: parseJsonObject(text, path), text }
}

const readOrWarn = async ($: EngineInterface, path: string) => {
  try {
    return { value: (await readObject($, path)).value, warnings: [] }
  } catch (error) {
    return { value: {}, warnings: [messageOf(error)] }
  }
}

const isSymbolicLink = async ($: EngineInterface, path: string) => {
  if (!(await $.fs.exists(path))) return false

  return (await $.fs.stat(path)).isLink
}

const loadLedger = async ($: EngineInterface): Promise<Ledger> => {
  const stored = await $.store.get(LEDGER_KEY)
  if (!isObject(stored)) return EMPTY_LEDGER
  const stash = isObject(stored.stash) ? stored.stash : {}
  const raised = Array.isArray(stored.raised) ? stored.raised : []

  return {
    stash: Object.fromEntries(
      Object.entries(stash).filter(
        (pair): pair is [string, Item] =>
          isSoundStashedItem(pair[1]) && pair[1].id === pair[0],
      ),
    ),
    raised: raised.filter((id): id is string => typeof id === 'string'),
  }
}

const activeProfile = async ($: EngineInterface) =>
  findProfile(await read($, profilesAtom), await read($, activeAtom))

const setView = ($: EngineInterface, patch: Partial<View>) =>
  update($, viewAtom, view => ({ ...view, ...patch }))

const say = async ($: EngineInterface, notice: string) => {
  await setView($, { notice })
  $.ui.toast(notice)

  return notice
}

const invalidateGates = ($: EngineInterface) => {
  $.ui.invalidate('prompt.context')
  $.ui.invalidate('tool.describe')
  $.ui.invalidate('command.describe')
}

const forgetProfile = ($: EngineInterface, name: string) =>
  update($, viewAtom, view => ({
    ...view,
    ...(view.target === name ? { edit: 'none' as const, target: '' } : {}),
    ...(view.focused === name ? { focused: '' } : {}),
  }))

const saveProfiles = async ($: EngineInterface, profiles: Profile[]) => {
  await update($, profilesAtom, () => profiles)
  await $.store.set(PROFILES_KEY, profiles)
}

const readSettings = async ($: EngineInterface): Promise<SettingsReading[]> => {
  const paths = await settingsPaths($)
  const writable = WRITABLE_SOURCES.map(async (source): Promise<SettingsReading> => {
    const path = paths[source]
    try {
      return { source, origin: path, value: (await readObject($, path)).value }
    } catch (error) {
      return { warning: messageOf(error) }
    }
  })
  const locked = LOCKED_SOURCES.map(async ({ source, origin }): Promise<SettingsReading> => {
    try {
      const text = JSON.stringify(await $.settings.read({ source }))

      return { source, origin, value: parseJsonObject(text, origin) }
    } catch (error) {
      return { warning: `${origin} could not be read: ${messageOf(error)}` }
    }
  })

  return Promise.all([...writable, ...locked])
}

const refresh = async ($: EngineInterface) => {
  const paths = await settingsPaths($)
  const readings = await readSettings($)
  const isPolicyKnown = readings.some(
    reading => !('warning' in reading) && reading.source === 'policy',
  )
  const settings = settingsFound(readings, await loadLedger($))
  const scopes = pluginScopes(settings.items)
  const commands = await $.command.list()
  const checked = await Promise.all(
    projectCandidates(commands, paths).map(async path => ({
      path,
      isThere: await $.fs.exists(path),
    })),
  )
  const mcpFile = await readOrWarn($, `${paths.root}/.mcp.json`)
  const registry = await readOrWarn($, `${paths.configDir}/plugins/installed_plugins.json`)
  const hookFiles = await Promise.all(
    enabledPluginHookFiles(registry.value, scopes).map(async ({ key, path }) => {
      const file = await readOrWarn($, path)

      return {
        sources: pluginHookSources(key, file.value, scopes),
        warnings: file.warnings,
      }
    }),
  )
  const items = sorted([
    ...settings.items,
    ...commandItems(
      commands,
      paths,
      scopes,
      checked.filter(one => one.isThere).map(one => one.path),
    ),
    ...mcpItems(await $.tool.list(), mcpServerNames(mcpFile.value), paths),
    ...hookEventItems(
      settings.items,
      hookFiles.flatMap(file => file.sources),
      isPolicyKnown,
    ),
    ...(await read($, seenAtom)),
  ])
  const warnings = [
    ...settings.warnings,
    ...mcpFile.warnings,
    ...registry.warnings,
    ...hookFiles.flatMap(file => file.warnings),
  ]
  await update($, itemsAtom, () => items)
  if (warnings.length > 0) await setView($, { notice: warnings.join(' | ') })

  return items
}

const load = async ($: EngineInterface) => {
  const stored = await $.store.get(PROFILES_KEY)
  const isFirstRun = stored === undefined
  const kept = Array.isArray(stored) ? stored.filter(isProfile) : []
  const { profiles, active } = restoredProfiles(
    isFirstRun ? undefined : kept,
    await $.store.get(ACTIVE_KEY),
  )
  await update($, profilesAtom, () => profiles)
  await update($, activeAtom, () => active)
  if (isFirstRun) await $.store.set(PROFILES_KEY, profiles)
  $.ui.status(undefined)

  return isFirstRun
}

const setPersisted = async ($: EngineInterface, item: Item, isOn: boolean) => {
  if (item.entry === undefined) return
  const paths = await settingsPaths($)
  const path = paths[item.entry.source]
  if (path !== item.origin)
    throw new Error(`${item.name} belongs to ${item.origin}, not to this project`)
  if (item.entry.source !== 'user' && (await isSymbolicLink($, path)))
    throw new Error(`${path} is a symbolic link; pristine does not write through it`)
  const { value, text } = await readObject($, path)
  const ledger = await loadLedger($)
  const rewritten = rewrittenSettings(
    value,
    isOn ? (ledger.stash[item.id] ?? item) : item,
    isOn,
  )
  const backup = backupPathOf(paths.configDir, path)
  if (text !== undefined && !(await $.fs.exists(backup))) await $.fs.write(backup, text)
  if (!isOn) await $.store.set(LEDGER_KEY, ledgerAfter(ledger, item, false))
  if (text !== undefined || isOn) await $.fs.write(path, rewritten)
  if (isOn) await $.store.set(LEDGER_KEY, ledgerAfter(ledger, item, true))
}

const toggle = async ($: EngineInterface, id: string) => {
  const item = (await read($, itemsAtom)).find(one => one.id === id)
  if (item === undefined) {
    await refresh($)

    return say($, 'That element is gone; the list was refreshed.')
  }
  if (item.isLocked)
    return say($, `${item.name} is locked by the ${item.scope} scope and stays on.`)
  const profile = await activeProfile($)
  if (isFixedProfile(profile.name))
    return say($, `"${profile.name}" is built in and cannot be changed; duplicate it first.`)
  const isOn = !isShownOn(profile, item)
  try {
    await setPersisted($, item, isOn)
  } catch (error) {
    await refresh($)

    return say($, `Could not change ${item.name}: ${messageOf(error)}`)
  }
  await saveProfiles(
    $,
    upsertProfile(await read($, profilesAtom), withOverride(profile, id, isOn)),
  )
  await refresh($)
  invalidateGates($)
  const hint = item.kind === 'plugin' ? ' Run /reload-plugins to apply.' : ''

  return say(
    $,
    `${item.name} is ${isOn ? 'on' : 'off'} in profile "${profile.name}".${hint}`,
  )
}

const reconcile = async ($: EngineInterface, profile: Profile) => {
  const ledger = await loadLedger($)
  const pending = (await refresh($)).filter(
    item =>
      item.entry !== undefined && desiredState(profile, item, ledger) !== item.isOn,
  )
  const outcome = await pending.reduce(
    async (before, item) => {
      const done = await before
      try {
        await setPersisted($, item, !item.isOn)

        return { ...done, changed: done.changed + 1 }
      } catch (error) {
        return { ...done, errors: [...done.errors, `${item.name}: ${messageOf(error)}`] }
      }
    },
    Promise.resolve({ changed: 0, errors: [] as string[] }),
  )
  await refresh($)

  return outcome
}

const activate = async ($: EngineInterface, profile: Profile) => {
  const outcome = await reconcile($, profile)
  await update($, activeAtom, () => profile.name)
  await $.store.set(ACTIVE_KEY, profile.name)
  invalidateGates($)

  return outcome
}

const switchProfile = async ($: EngineInterface, name: string) => {
  const profile = (await read($, profilesAtom)).find(one => one.name === name)
  if (profile === undefined) return say($, `No profile is named "${name}".`)
  const { changed, errors } = await activate($, profile)
  const failures = errors.length === 0 ? '' : ` Failed: ${errors.join('; ')}.`
  const written =
    changed === 0
      ? ''
      : ` ${changed} settings entries rewritten; run /reload-plugins if plugins changed.`

  return say($, `Profile "${name}" is active.${written}${failures}`)
}

const addProfile = async ($: EngineInterface, created: Profile) => {
  const profiles = await read($, profilesAtom)
  const problem = nameProblem(profiles, created.name)
  if (problem !== undefined) return say($, problem)
  await saveProfiles($, [...profiles, created])

  return switchProfile($, created.name)
}

const duplicateProfile = async ($: EngineInterface, from: string, name: string) => {
  const source = (await read($, profilesAtom)).find(profile => profile.name === from)
  if (source === undefined) return say($, `No profile is named "${from}".`)

  return addProfile($, { ...source, name })
}

const createProfile = async (
  $: EngineInterface,
  name: string,
  base?: Profile['base'],
) =>
  base === undefined
    ? duplicateProfile($, (await activeProfile($)).name, name)
    : addProfile($, { name, base, overrides: {} })

const renameTo = async ($: EngineInterface, from: string, to: string) => {
  if (isFixedProfile(from))
    return say($, `"${from}" is built in and cannot be renamed.`)
  const profiles = await read($, profilesAtom)
  if (!profiles.some(profile => profile.name === from))
    return say($, `No profile is named "${from}".`)
  const problem = nameProblem(profiles, to)
  if (problem !== undefined) return say($, problem)
  await saveProfiles($, renameProfile(profiles, from, to))
  await forgetProfile($, from)
  if ((await read($, activeAtom)) === from) {
    await update($, activeAtom, () => to)
    await $.store.set(ACTIVE_KEY, to)
  }

  return say($, `Profile "${from}" is now "${to}".`)
}

const submitName = async (
  $: EngineInterface,
  typed: string,
  work: (name: string) => Promise<string>,
) => {
  const name = typed.trim()
  const problem = nameProblem(await read($, profilesAtom), name)
  if (problem !== undefined) return say($, problem)
  await setView($, { edit: 'none' })

  return work(name)
}

const deleteProfile = async ($: EngineInterface, name: string) => {
  if (isFixedProfile(name))
    return say($, `"${name}" is built in and cannot be deleted.`)
  const profiles = await read($, profilesAtom)
  if (!profiles.some(profile => profile.name === name))
    return say($, `No profile is named "${name}".`)
  const kept = removeProfile(profiles, name)
  if ((await read($, activeAtom)) === name) {
    const { errors } = await activate($, fallbackProfile(kept))
    if (errors.length > 0)
      return say($, `Profile "${name}" was kept; leaving it failed: ${errors.join('; ')}.`)
  }
  await saveProfiles($, kept)
  await forgetProfile($, name)

  return say($, `Profile "${name}" deleted.`)
}

const restoreAll = async ($: EngineInterface) => {
  const profiles = await read($, profilesAtom)
  const applied = await activeProfile($)
  const kept = isFixedProfile(applied.name) ? fallbackProfile(profiles) : applied
  const untouched: Profile = {
    ...DEFAULT_PROFILE,
    name: isFixedProfile(kept.name) ? DEFAULT_PROFILE_NAME : kept.name,
  }
  await saveProfiles($, upsertProfile(profiles, untouched))
  const { errors } = await activate($, untouched)

  return say(
    $,
    errors.length === 0
      ? `Everything pristine turned off is back on; profile "${untouched.name}" is active.`
      : `Profile "${untouched.name}" is active, but these were not restored: ${errors.join('; ')}.`,
  )
}

const nameFirstProfile = async ($: EngineInterface) => {
  const name = (await $.ui.ask(FIRST_NAME_QUESTION, FIRST_NAME_OPTIONS)).trim()
  if (name === DEFAULT_PROFILE_NAME) return
  await inTurn(() => renameTo($, DEFAULT_PROFILE_NAME, name))
}

const runProfileAction = async (
  $: EngineInterface,
  name: string,
  action: ProfileAction,
) => {
  if (action === 'apply') return switchProfile($, name)
  if (action === 'delete') return deleteProfile($, name)
  await setView($, { edit: action === 'duplicate' ? 'new' : 'rename', target: name })

  return name
}

const isOff = async ($: EngineInterface, id: string, kind: Kind) => {
  const known = (await read($, itemsAtom)).find(item => item.id === id)
  const item: Item = known ?? {
    id,
    kind,
    name: id,
    scope: 'user',
    origin: '',
    isLocked: false,
    isOn: true,
  }

  return !isEnabled(await activeProfile($), item)
}

const isKnownOff = async ($: EngineInterface, id: string, kind: Kind) => {
  const profile = await activeProfile($)
  const isKnown = (await read($, itemsAtom)).some(item => item.id === id)

  return (isKnown || profile.overrides[id] === false) && isOff($, id, kind)
}

const isHookEventMuted = async ($: EngineInterface, event: string) => {
  const item = (await read($, itemsAtom)).find(one => one.id === `hook-event:${event}`)

  return item !== undefined && !isEnabled(await activeProfile($), item)
}

const offNote = async ($: EngineInterface, what: string) =>
  `${what} is turned off in the active pristine profile "${(await activeProfile($)).name}". Re-enable it with /pristine.`

const openPane = async ($: EngineInterface) => {
  await refresh($)
  await $.ui.open({ id: PANE, title: 'Pristine', focus: true, rows: PANE_ROWS })

  return 'Pristine pane opened.'
}

const listProfiles = async ($: EngineInterface) => {
  const active = await activeProfile($)

  return (await read($, profilesAtom))
    .map(
      profile =>
        `${profile.name === active.name ? '*' : ' '} ${profile.name} (base ${profile.base}, ${Object.keys(profile.overrides).length} overrides)`,
    )
    .join('\n')
}

const status = async ($: EngineInterface) => {
  const profile = await activeProfile($)
  const items = await refresh($)
  const off = items.filter(item => !isShownOn(profile, item))

  return [
    `Profile "${profile.name}": ${off.length} of ${items.length} harness elements off.`,
    ...off.map(item => `  off  ${item.kind}  ${item.name}  [${item.scope}]`),
  ].join('\n')
}

const runCommand = async ($: EngineInterface, args: string, origin: PromptOrigin) => {
  const [verb = '', name = '', option = ''] = args.trim().split(/\s+/)
  if (!READ_ONLY_VERBS.includes(verb) && !PERSON_ORIGINS.includes(origin.kind))
    return 'Only the person at the prompt can change pristine profiles.'
  if (verb === '') return openPane($)
  if (verb === 'list') return listProfiles($)
  if (verb === 'status') return status($)
  if (verb === 'restore') return inTurn(() => restoreAll($))
  if (verb === 'use' && name !== '') return inTurn(() => switchProfile($, name))
  if (verb === 'delete' && name !== '') return inTurn(() => deleteProfile($, name))
  if (verb === 'rename' && name !== '' && option !== '')
    return inTurn(() => renameTo($, name, option))
  if (verb === 'new' && name !== '')
    return inTurn(() =>
      createProfile($, name, option === 'on' || option === 'off' ? option : undefined),
    )

  return USAGE
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'pristine',
      description: 'Manage harness profiles, scopes and on/off for every harness element',
      argumentHint:
        '[list | status | use <profile> | new <profile> | rename <profile> <new name> | delete <profile> | restore]',
    })
    try {
      const isFirstRun = await load($)
      await refresh($)
      if (isFirstRun)
        void nameFirstProfile($).catch(error =>
          $.ui.log(`pristine kept the name "default": ${messageOf(error)}`, {
            to: 'debug',
          }),
        )
    } catch (error) {
      $.ui.log(`pristine could not read the harness: ${messageOf(error)}`)
    }

    return next(e)
  })

  on('command.run', { command: 'pristine' }, async ($, e) => {
    try {
      return { text: await runCommand($, e.args, e.origin) }
    } catch (error) {
      return { text: `pristine failed: ${messageOf(error)}` }
    }
  })

  on('prompt.submit', async ($, e, next) => {
    try {
      await refresh($)
    } catch (error) {
      $.ui.log(`pristine could not refresh the harness: ${messageOf(error)}`)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('prompt.context', async ($, e, next) => {
    const answered = await next(e)
    const files = answered.instructionFiles ?? e.instructionFiles
    if (files === undefined) return answered
    const profile = await activeProfile($)
    const items = files.map(instructionItem)
    await update($, seenAtom, seen => [
      ...seen.filter(old => !items.some(item => item.id === old.id)),
      ...items,
    ])
    const kept = files.filter((file, index) => {
      const item = items[index]

      return item === undefined || isEnabled(profile, item)
    })

    return kept.length === files.length
      ? answered
      : { ...answered, instructionFiles: kept }
  })

  on('agent.offer', async ($, e, next) => {
    if (e.provider.tier === CORE_TIER || e.provider.plugin === PLUGIN) return next(e)
    const item = agentItem(e.agent, e.source, e.provider.plugin)
    await update($, seenAtom, seen =>
      seen.some(one => one.id === item.id) ? seen : [...seen, item],
    )

    return isEnabled(await activeProfile($), item) ? next(e) : { isOffered: false }
  }).catch(($, e, next) => next(e))

  on('command.describe', async ($, e, next) => {
    const described = await next(e)
    const isManaged = e.provider.tier !== CORE_TIER && e.provider.plugin !== PLUGIN
    if (!isManaged || !(await isOff($, `skill:${e.command}`, 'skill'))) return described

    return {
      ...described,
      description: `[off in pristine] ${described.description}`,
      isHidden: true,
    }
  })

  on('command.run', async ($, e, next) =>
    (await isKnownOff($, `skill:${e.command}`, 'skill'))
      ? { text: await offNote($, `/${e.command}`) }
      : next(e),
  ).catch(($, e, next) => next(e))

  on('skill.prompt', async ($, e, next) =>
    (await isKnownOff($, `skill:${e.skill}`, 'skill'))
      ? {
          text: `${await offNote($, `The skill "${e.skill}"`)} Do not carry it out; tell the user it is disabled.`,
        }
      : next(e),
  ).catch(($, e, next) => next(e))

  on('tool.describe', async ($, e, next) => {
    const described = await next(e)
    const server = mcpServerOf(e.tool)
    if (server === undefined) return described
    if (!(await isOff($, `mcp:${server}`, 'mcp'))) return described

    return {
      ...described,
      description: `[Disabled by the user's pristine profile: do not call.] ${described.description}`,
    }
  })

  on('tool.call', async ($, e, next) => {
    const server = mcpServerOf(String(e.tool))
    if (server === undefined) return next(e)

    return (await isOff($, `mcp:${server}`, 'mcp'))
      ? { deny: await offNote($, `The MCP server "${server}"`) }
      : next(e)
  }).catch(($, e, next) => next(e))

  on('classic.ConfigChange', async ($, e, next) =>
    (await isHookEventMuted($, 'ConfigChange')) ? {} : next(e),
  ).catch(($, e, next) => next(e))
  on('classic.CwdChanged', async ($, e, next) =>
    (await isHookEventMuted($, 'CwdChanged')) ? {} : next(e),
  ).catch(($, e, next) => next(e))
  on('classic.DirectoryAdded', async ($, e, next) =>
    (await isHookEventMuted($, 'DirectoryAdded')) ? {} : next(e),
  ).catch(($, e, next) => next(e))
  on('classic.Elicitation', async ($, e, next) =>
    (await isHookEventMuted($, 'Elicitation')) ? {} : next(e),
  ).catch(($, e, next) => next(e))
  on('classic.ElicitationResult', async ($, e, next) =>
    (await isHookEventMuted($, 'ElicitationResult')) ? {} : next(e),
  ).catch(($, e, next) => next(e))
  on('classic.FileChanged', async ($, e, next) =>
    (await isHookEventMuted($, 'FileChanged')) ? {} : next(e),
  ).catch(($, e, next) => next(e))
  on('classic.InstructionsLoaded', async ($, e, next) =>
    (await isHookEventMuted($, 'InstructionsLoaded')) ? {} : next(e),
  ).catch(($, e, next) => next(e))
  on('classic.MessageDisplay', async ($, e, next) =>
    (await isHookEventMuted($, 'MessageDisplay')) ? {} : next(e),
  ).catch(($, e, next) => next(e))
  on('classic.Notification', async ($, e, next) =>
    (await isHookEventMuted($, 'Notification')) ? {} : next(e),
  ).catch(($, e, next) => next(e))
  on('classic.PermissionDenied', async ($, e, next) =>
    (await isHookEventMuted($, 'PermissionDenied')) ? {} : next(e),
  ).catch(($, e, next) => next(e))
  on('classic.PermissionRequest', async ($, e, next) =>
    (await isHookEventMuted($, 'PermissionRequest')) ? {} : next(e),
  ).catch(($, e, next) => next(e))
  on('classic.PostCompact', async ($, e, next) =>
    (await isHookEventMuted($, 'PostCompact')) ? {} : next(e),
  ).catch(($, e, next) => next(e))
  on('classic.PostModelSwitch', async ($, e, next) =>
    (await isHookEventMuted($, 'PostModelSwitch')) ? {} : next(e),
  ).catch(($, e, next) => next(e))
  on('classic.PostToolBatch', async ($, e, next) =>
    (await isHookEventMuted($, 'PostToolBatch')) ? {} : next(e),
  ).catch(($, e, next) => next(e))
  on('classic.PostToolUse', async ($, e, next) =>
    (await isHookEventMuted($, 'PostToolUse')) ? {} : next(e),
  ).catch(($, e, next) => next(e))
  on('classic.PostToolUseFailure', async ($, e, next) =>
    (await isHookEventMuted($, 'PostToolUseFailure')) ? {} : next(e),
  ).catch(($, e, next) => next(e))
  on('classic.PreCompact', async ($, e, next) =>
    (await isHookEventMuted($, 'PreCompact')) ? {} : next(e),
  ).catch(($, e, next) => next(e))
  on('classic.PreModelSwitch', async ($, e, next) =>
    (await isHookEventMuted($, 'PreModelSwitch')) ? {} : next(e),
  ).catch(($, e, next) => next(e))
  on('classic.PreToolUse', async ($, e, next) =>
    (await isHookEventMuted($, 'PreToolUse')) ? {} : next(e),
  ).catch(($, e, next) => next(e))
  on('classic.SessionEnd', async ($, e, next) =>
    (await isHookEventMuted($, 'SessionEnd')) ? {} : next(e),
  ).catch(($, e, next) => next(e))
  on('classic.SessionStart', async ($, e, next) =>
    (await isHookEventMuted($, 'SessionStart')) ? {} : next(e),
  ).catch(($, e, next) => next(e))
  on('classic.Setup', async ($, e, next) =>
    (await isHookEventMuted($, 'Setup')) ? {} : next(e),
  ).catch(($, e, next) => next(e))
  on('classic.Stop', async ($, e, next) =>
    (await isHookEventMuted($, 'Stop')) ? {} : next(e),
  ).catch(($, e, next) => next(e))
  on('classic.StopFailure', async ($, e, next) =>
    (await isHookEventMuted($, 'StopFailure')) ? {} : next(e),
  ).catch(($, e, next) => next(e))
  on('classic.SubagentStart', async ($, e, next) =>
    (await isHookEventMuted($, 'SubagentStart')) ? {} : next(e),
  ).catch(($, e, next) => next(e))
  on('classic.SubagentStop', async ($, e, next) =>
    (await isHookEventMuted($, 'SubagentStop')) ? {} : next(e),
  ).catch(($, e, next) => next(e))
  on('classic.TaskCompleted', async ($, e, next) =>
    (await isHookEventMuted($, 'TaskCompleted')) ? {} : next(e),
  ).catch(($, e, next) => next(e))
  on('classic.TaskCreated', async ($, e, next) =>
    (await isHookEventMuted($, 'TaskCreated')) ? {} : next(e),
  ).catch(($, e, next) => next(e))
  on('classic.TeammateIdle', async ($, e, next) =>
    (await isHookEventMuted($, 'TeammateIdle')) ? {} : next(e),
  ).catch(($, e, next) => next(e))
  on('classic.UserPromptExpansion', async ($, e, next) =>
    (await isHookEventMuted($, 'UserPromptExpansion')) ? {} : next(e),
  ).catch(($, e, next) => next(e))
  on('classic.UserPromptSubmit', async ($, e, next) =>
    (await isHookEventMuted($, 'UserPromptSubmit')) ? {} : next(e),
  ).catch(($, e, next) => next(e))
  on('classic.WorktreeCreate', async ($, e, next) =>
    (await isHookEventMuted($, 'WorktreeCreate')) ? {} : next(e),
  ).catch(($, e, next) => next(e))
  on('classic.WorktreeRemove', async ($, e, next) =>
    (await isHookEventMuted($, 'WorktreeRemove')) ? {} : next(e),
  ).catch(($, e, next) => next(e))

  on('ui.focus', { requestId: PANE }, async ($, e, next) => {
    const answered = await next(e)
    try {
      const focused = profileOfKey(e.element)
      if ((await read($, viewAtom)).focused !== focused) await setView($, { focused })
    } catch (error) {
      $.ui.log(`pristine could not follow the focus: ${messageOf(error)}`, { to: 'debug' })
    }

    return answered
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)

    return drawBand($.ui.resolve(e), (await activeProfile($)).name, () =>
      void openPane($).catch(error =>
        $.ui.toast(`pristine could not open its pane: ${messageOf(error)}`),
      ),
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    const report = (error: unknown) => void say($, `pristine failed: ${messageOf(error)}`)

    const view = await read($, viewAtom)

    return drawPane(
      $.ui.resolve(e),
      {
        items: await read($, itemsAtom),
        profiles: await read($, profilesAtom),
        profile: await activeProfile($),
        view,
        focused: e.props.isFocused ? view.focused : '',
        columns: e.props.bodyColumns ?? FALLBACK_COLUMNS,
        rows: e.props.scroll?.bodyRows ?? FALLBACK_ROWS,
        isDocked: e.props.placement === 'dock',
      },
      {
        onToggle: id => void inTurn(() => toggle($, id)).catch(report),
        onAction: (name, action) =>
          void inTurn(() => runProfileAction($, name, action)).catch(report),
        onCreate: typed =>
          void inTurn(() =>
            submitName($, typed, name => duplicateProfile($, view.target, name)),
          ).catch(report),
        onRename: typed =>
          void inTurn(() =>
            submitName($, typed, name => renameTo($, view.target, name)),
          ).catch(report),
        onRestore: () => void inTurn(() => restoreAll($)).catch(report),
        onRefresh: () =>
          void refresh($)
            .then(() => setView($, { notice: 'Refreshed.' }))
            .catch(report),
        onView: patch => void setView($, patch).catch(report),
      },
    )
  })
}
