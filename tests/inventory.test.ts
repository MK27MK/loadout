import { describe, expect, test } from 'claude-code/testing'

import { ledgerAfter, pathsFrom } from '../hooks/files'
import {
  agentItem,
  commandItems,
  enabledPluginHookFiles,
  hookEventItems,
  instructionItem,
  mcpItems,
  pluginHookSources,
  pluginScopes,
  projectCandidates,
  settingsFound,
} from '../hooks/inventory'
import { EMPTY_LEDGER } from '../hooks/model'
import { entriesOf } from '../hooks/settingsEdit'

const PATHS = pathsFrom('/home/me', '/home/me/.claude-ecc', '/work/app')
const USER_SETTINGS = {
  enabledPlugins: { 'ecc@ecc': true },
  hooks: { Stop: [{ hooks: [{ type: 'command', command: 'notify.sh' }] }] },
}

describe('paths', () => {
  test('honours CLAUDE_CONFIG_DIR for the user scope', () => {
    expect(PATHS.user).toBe('/home/me/.claude-ecc/settings.json')
    expect(pathsFrom('/home/me', undefined, '/work/app').user).toBe(
      '/home/me/.claude/settings.json',
    )
    expect(PATHS.local).toBe('/work/app/.claude/settings.local.json')
  })

  test('refuses to build paths from an empty HOME or project root', () => {
    expect(() => pathsFrom('', undefined, '/work/app')).toThrow('absolute')
    expect(() => pathsFrom('/home/me', '', '')).toThrow('absolute')
    expect(pathsFrom('/home/me', '', '/work/app').configDir).toBe('/home/me/.claude')
  })
})

describe('instructionItem', () => {
  test('tells a rule, a memory and a CLAUDE.md apart and keeps their scope', () => {
    const rule = instructionItem({
      path: '/home/me/.claude-ecc/rules/ecc/common/testing.md',
      kind: 'user',
      content: '',
    })
    const memory = instructionItem({ path: '/m/MEMORY.md', kind: 'memory', content: '' })
    const project = instructionItem({ path: '/work/app/CLAUDE.md', kind: 'project', content: '' })

    expect([rule.kind, rule.scope]).toEqual(['rule', 'user'])
    expect([memory.kind, memory.scope]).toEqual(['memory', 'memory'])
    expect([project.kind, project.scope]).toEqual(['instruction', 'project'])
    expect(rule.origin).toContain('/rules/ecc/common/testing.md')
  })

  test('locks an organization-managed file', () => {
    const managed = instructionItem({ path: '/etc/CLAUDE.md', kind: 'managed', content: '' })

    expect(managed.isLocked).toBe(true)
    expect(managed.scope).toBe('policy')
  })
})

describe('settingsFound', () => {
  test('lists a stashed entry as off when the file no longer has it', () => {
    const [theme] = entriesOf({ theme: 'dark' }, 'user', PATHS.user)
    if (theme === undefined) throw new Error('no theme entry')

    const found = settingsFound(
      [{ source: 'user', origin: PATHS.user, value: {} }],
      ledgerAfter(EMPTY_LEDGER, theme, false),
    )

    expect(found.items.map(item => [item.name, item.isOn])).toEqual([
      ['theme (text)', false],
    ])
  })

  test('keeps an entry stashed from another project out of this one', () => {
    const elsewhere = '/other/repo/.claude/settings.json'
    const [hook] = entriesOf(USER_SETTINGS, 'project', elsewhere).filter(
      item => item.kind === 'hook',
    )
    if (hook === undefined) throw new Error('no hook entry')

    const found = settingsFound(
      [{ source: 'project', origin: PATHS.project, value: {} }],
      ledgerAfter(EMPTY_LEDGER, hook, false),
    )

    expect(found.items).toEqual([])
  })

  test('never lets a profile switch loadout itself off', () => {
    const found = settingsFound(
      [
        {
          source: 'user',
          origin: PATHS.user,
          value: { enabledPlugins: { 'loadout@loadout': true } },
        },
      ],
      EMPTY_LEDGER,
    )

    expect(found.items[0]?.isLocked).toBe(true)
    expect(found.items[0]?.entry).toBeUndefined()
  })

  test('reports an unreadable settings file as a warning', () => {
    const found = settingsFound([{ warning: 'settings.json: bad JSON' }], EMPTY_LEDGER)

    expect(found.warnings).toEqual(['settings.json: bad JSON'])
  })
})

describe('commandItems', () => {
  const settings = entriesOf(USER_SETTINGS, 'user', PATHS.user)
  const commands = [
    { name: 'help', description: '', source: 'builtin' as const },
    { name: 'ecc:plan', description: '', source: 'plugin' as const, plugin: 'ecc' },
    { name: 'deploy', description: '', source: 'user' as const },
    { name: 'mine', description: '', source: 'user' as const },
    { name: 'loadout', description: '', source: 'plugin' as const, plugin: 'loadout' },
  ]

  test('names the plugin and its install scope, and skips built-ins and itself', () => {
    const items = commandItems(commands, PATHS, pluginScopes(settings), [])

    expect(items.map(item => item.name)).toEqual(['ecc:plan', 'deploy', 'mine'])
    expect(items[0]?.origin).toBe('plugin ecc (user)')
  })

  test('places a skill found under the project in the project scope', () => {
    const existing = ['/work/app/.claude/skills/deploy']

    const items = commandItems(commands, PATHS, {}, existing)

    expect(items.find(item => item.name === 'deploy')?.scope).toBe('project')
    expect(items.find(item => item.name === 'mine')?.scope).toBe('user')
    expect(projectCandidates(commands, PATHS)).toContain('/work/app/.claude/commands/mine.md')
  })

  test('probes no path for a command name that climbs out of the project', () => {
    const hostile = [{ name: '../../etc/passwd', description: '', source: 'user' as const }]

    expect(projectCandidates(hostile, PATHS)).toEqual([])
  })
})

describe('mcpItems', () => {
  test('groups tools by server and names where each server comes from', () => {
    const tools = [
      { name: 'Bash', description: '', mcp: false },
      { name: 'mcp__github__list', description: '', mcp: true },
      { name: 'mcp__github__get', description: '', mcp: true },
      { name: 'mcp__claude_ai_Gmail__send', description: '', mcp: true },
      { name: 'mcp__plugin_ecc_chrome-devtools__click', description: '', mcp: true },
      { name: 'mcp__notes__add', description: '', mcp: true },
    ]

    const items = mcpItems(tools, ['github'], PATHS)

    expect(items.map(item => [item.name, item.scope])).toEqual([
      ['github (2 tools)', 'project'],
      ['claude_ai_Gmail (1 tools)', 'account'],
      ['plugin_ecc_chrome-devtools (1 tools)', 'plugin'],
      ['notes (1 tools)', 'user'],
    ])
  })

  test('shows a project server as project even when its name imitates a connector', () => {
    const tools = [{ name: 'mcp__claude_ai_Gmail__send', description: '', mcp: true }]

    const [item] = mcpItems(tools, ['claude_ai_Gmail'], PATHS)

    expect(item?.scope).toBe('project')
  })

  test('lists a server named like the mod itself so it can be switched off', () => {
    const tools = [{ name: 'mcp__loadout__run', description: '', mcp: true }]

    expect(mcpItems(tools, [], PATHS).map(item => item.id)).toEqual(['mcp:loadout'])
  })
})

describe('hook events', () => {
  test('counts settings and plugin hooks per event and marks mixed scopes', () => {
    const settings = entriesOf(USER_SETTINGS, 'user', PATHS.user)
    const registry = { plugins: { 'ecc@ecc': [{ installPath: '/cache/ecc' }], 'x@y': [{ installPath: '/cache/x' }] } }
    const files = enabledPluginHookFiles(registry, pluginScopes(settings))
    const sources = pluginHookSources(
      'ecc@ecc',
      { hooks: { Stop: [{}, {}], PreToolUse: [{}] } },
      pluginScopes(settings),
    )

    const items = hookEventItems(settings, sources)

    expect(files).toEqual([{ key: 'ecc@ecc', path: '/cache/ecc/hooks/hooks.json' }])
    expect(items.map(item => [item.id, item.scope, item.origin])).toEqual([
      ['hook-event:Stop', 'mixed', 'user settings ×1, ecc@ecc ×2'],
      ['hook-event:PreToolUse', 'plugin', 'ecc@ecc ×1'],
    ])
  })

  test('locks an event the organization hooks', () => {
    const policy = entriesOf(USER_SETTINGS, 'policy', 'managed settings')

    expect(hookEventItems(policy, [])[0]?.isLocked).toBe(true)
  })

  test('locks the hooks of a plugin the organization forces on', () => {
    const sources = pluginHookSources('guard@corp', { hooks: { Stop: [{}] } }, { guard: ['policy'] })

    expect(hookEventItems([], sources)[0]?.isLocked).toBe(true)
  })

  test('locks every hook event while the managed settings are unreadable', () => {
    const sources = pluginHookSources('ecc@ecc', { hooks: { Stop: [{}] } }, {})

    expect(hookEventItems([], sources, false)[0]?.isLocked).toBe(true)
  })
})

describe('agentItem', () => {
  test('reads the scope from the source and falls back to the plugin', () => {
    expect(agentItem('reviewer', 'projectSettings', 'engine').scope).toBe('project')
    expect(agentItem('ecc:planner', 'plugin', 'ecc').origin).toBe('plugin ecc')
  })
})
