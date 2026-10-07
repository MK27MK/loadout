import { describe, expect, test } from 'claude-code/testing'

import { instructionItem } from '../hooks/inventory'
import {
  ancestorsOf,
  fileItems,
  memoryFolderOf,
  projectLabel,
  userFoldersOf,
  withProjectFiles,
  withSessionFiles,
} from '../hooks/project'

const fileItem = (path: string, kind: 'user' | 'project' | 'memory') =>
  instructionItem({ path, kind, content: '' })

describe('project paths', () => {
  test('lists a folder and every folder above it, outermost first', () => {
    expect(ancestorsOf('/work/app/loadout')).toEqual([
      '/work',
      '/work/app',
      '/work/app/loadout',
    ])
  })

  test('names the memory folder the way the engine names a project', () => {
    expect(memoryFolderOf('/home/me/.claude-ecc', '/work/my app/.x')).toBe(
      '/home/me/.claude-ecc/projects/-work-my-app--x/memory',
    )
  })

  test('labels a project by its path under the session root, or by its whole path', () => {
    expect(projectLabel('/work/app', '/work/app')).toBe('app · session')
    expect(projectLabel('/work/app/tools/cli', '/work/app')).toBe('tools/cli')
    expect(projectLabel('/elsewhere/repo', '/work/app')).toBe('/elsewhere/repo')
  })
})

describe('withProjectFiles', () => {
  test('swaps what belongs to the session project for the files of the picked one', () => {
    const userRule = fileItem('/home/me/.claude/rules/testing.md', 'user')
    const sessionFile = fileItem('/work/app/CLAUDE.md', 'project')
    const sessionMemory = fileItem('/home/me/.claude/projects/app/memory/MEMORY.md', 'memory')
    const pickedFile = fileItem('/work/other/CLAUDE.md', 'project')

    const shown = withProjectFiles([userRule, sessionFile, sessionMemory], [pickedFile])

    expect(shown.map(item => item.id)).toEqual([pickedFile.id, userRule.id])
  })

  test('lists once a file found again above the picked project', () => {
    const userRule = fileItem('/home/me/.claude/rules/testing.md', 'user')
    const sameRule = fileItem('/home/me/.claude/rules/testing.md', 'project')

    const shown = withProjectFiles([userRule], [sameRule])

    expect(shown).toEqual([userRule])
  })
})

describe('files of a user folder', () => {
  test('names the configuration folder in use and the one in the home folder', () => {
    expect(userFoldersOf('/home/me', '/home/me/.claude-ecc')).toEqual([
      '/home/me/.claude-ecc',
      '/home/me/.claude',
    ])
    expect(userFoldersOf('/home/me', undefined)).toEqual(['/home/me/.claude'])
    expect(userFoldersOf(undefined, '/cfg/')).toEqual(['/cfg'])
    expect(userFoldersOf(undefined, 'relative')).toEqual([])
  })

  test('gives the user scope to a file reached by walking up into a user folder', () => {
    const found = fileItems(
      [
        { path: '/home/me/.claude/CLAUDE.md', kind: 'project' },
        { path: '/home/me/code/app/CLAUDE.md', kind: 'project' },
        { path: '/home/me/.claude/CLAUDE.local.md', kind: 'local' },
      ],
      ['/home/me/.claude/rules/testing.md', '/home/me/code/app/.claude/rules/style.md'],
      ['/home/me/.claude'],
    )

    expect(found.map(item => item.scope)).toEqual(['user', 'project', 'local', 'user', 'project'])
  })
})

describe('withSessionFiles', () => {
  test('adds the files found on disk to what the session reported, each once', () => {
    const reported = fileItem('/work/app/CLAUDE.md', 'project')
    const memory = fileItem('/home/me/.claude/projects/app/memory/MEMORY.md', 'memory')
    const unreported = fileItem('/work/app/CLAUDE.local.md', 'project')

    const shown = withSessionFiles([reported, memory], [reported, unreported])

    expect(shown.map(item => item.id)).toEqual([unreported.id, reported.id, memory.id])
  })
})
