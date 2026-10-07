import type { FsEntry, InstructionFile } from 'claude-code'

import type { Item, Scope } from '../types'
import { isAbsolute } from './files'
import { instructionItem, sorted } from './inventory'

export type FoundFile = Pick<InstructionFile, 'path' | 'kind'>

const INSTRUCTION_FILES: readonly { name: string; kind: InstructionFile['kind'] }[] = [
  { name: 'CLAUDE.md', kind: 'project' },
  { name: '.claude/CLAUDE.md', kind: 'project' },
  { name: 'CLAUDE.local.md', kind: 'local' },
]
const HOME_CONFIG_FOLDER = '.claude'
const TRAILING_SLASHES = /\/+$/
const RULES_FOLDER = '.claude/rules'
const MEMORY_INDEX = 'MEMORY.md'
const MARKDOWN_FILE = /\.md$/
const PROJECT_MARKERS = ['CLAUDE.md', '.claude']
const HIDDEN_FOLDER = /^\./
const FOLDER_NAME_SEPARATORS = /[^A-Za-z0-9]/g
const SCOPES_OF_ONE_PROJECT: readonly Scope[] = ['project', 'local', 'memory']
const SESSION_MARK = ' · session'

export const ancestorsOf = (root: string): string[] =>
  root
    .split('/')
    .filter(part => part !== '')
    .map((_, index, parts) => `/${parts.slice(0, index + 1).join('/')}`)

export const memoryFolderOf = (configDir: string, root: string) =>
  `${configDir}/projects/${root.replace(FOLDER_NAME_SEPARATORS, '-')}/memory`

export const projectLabel = (path: string, root: string) => {
  if (path === root) return `${path.split('/').at(-1) ?? path}${SESSION_MARK}`

  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
}

export const withSessionFiles = (
  items: readonly Item[],
  files: readonly Item[],
): Item[] =>
  sorted([...items, ...files.filter(file => !items.some(item => item.id === file.id))])

export const withProjectFiles = (
  items: readonly Item[],
  files: readonly Item[],
): Item[] =>
  withSessionFiles(
    items.filter(item => !SCOPES_OF_ONE_PROJECT.includes(item.scope)),
    files,
  )

export const namedFilesOf = (configDir: string, root: string): FoundFile[] => [
  ...ancestorsOf(root).flatMap(folder =>
    INSTRUCTION_FILES.map(({ name, kind }) => ({ path: `${folder}/${name}`, kind })),
  ),
  { path: `${memoryFolderOf(configDir, root)}/${MEMORY_INDEX}`, kind: 'memory' },
]

export const rulesFoldersOf = (root: string) =>
  ancestorsOf(root).map(folder => `${folder}/${RULES_FOLDER}`)

export const isMarkdownFile = (entry: FsEntry) =>
  entry.kind === 'file' && MARKDOWN_FILE.test(entry.name)

export const userFoldersOf = (
  home: string | undefined,
  configDir: string | undefined,
): string[] => [
  ...new Set(
    [configDir, home === undefined ? undefined : `${home}/${HOME_CONFIG_FOLDER}`]
      .filter(isAbsolute)
      .map(folder => folder.replace(TRAILING_SLASHES, '')),
  ),
]

export const inUserScope = <File extends FoundFile>(
  file: File,
  userFolders: readonly string[],
): File =>
  file.kind === 'project' &&
  userFolders.some(folder => file.path.startsWith(`${folder}/`))
    ? { ...file, kind: 'user' }
    : file

export const fileItems = (
  files: readonly FoundFile[],
  rules: readonly string[],
  userFolders: readonly string[],
) =>
  [...files, ...rules.map((path): FoundFile => ({ path, kind: 'project' }))].map(file =>
    instructionItem({ ...inUserScope(file, userFolders), content: '' }),
  )

export const visibleFolders = (entries: readonly FsEntry[], root: string) =>
  entries
    .filter(entry => entry.kind === 'dir' && !HIDDEN_FOLDER.test(entry.name))
    .map(entry => `${root}/${entry.name}`)
    .sort((left, right) => left.localeCompare(right))

export const markersOf = (folder: string) =>
  PROJECT_MARKERS.map(marker => `${folder}/${marker}`)
