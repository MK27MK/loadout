import type { Elements } from 'claude-code'

import type { Item, Kind, Picker, Profile, ProfileAction, Scope, View } from '../types'
import { KINDS, KIND_LABELS, SCOPES, isFixedProfile } from './model'
import { projectLabel } from './project'

export type PaneElements = Pick<
  Elements['terminal'],
  'Box' | 'Text' | 'Button' | 'Input' | 'Link'
>

export type PaneActions = {
  onToggle: (id: string) => void
  onAction: (name: string, action: ProfileAction) => void
  onCreate: (name: string) => void
  onRename: (name: string) => void
  onRestore: () => void
  onRefresh: () => void
  onProject: (path: string) => void
  onView: (patch: Partial<View>) => void
}

export type PaneModel = {
  items: readonly Item[]
  root: string
  projects: readonly string[]
  profiles: readonly Profile[]
  profile: Profile
  applied: string
  isOn: (item: Item) => boolean
  view: View
  columns: number
  rows: number
  isDocked: boolean
}

type SectionLine = { kind: Kind; isOpen: boolean; count: number; offCount: number }
type ItemLine = { item: Item; isInSection: boolean }
type Line = SectionLine | ItemLine
type PickerOption = { value: string; label: string }
type OpenPicker = Exclude<Picker, 'none'>

const CHROME_ROWS = 13
const FRAME_COLUMNS = 4
const FRAME = { borderStyle: 'round', borderDimColor: true, paddingX: 1 } as const
const MIN_LIST_ROWS = 3
const INDENT_COLUMNS = 2
const CHECKBOX_COLUMNS = 1
const SCOPE_COLUMNS = 9
const NAME_SHARE = 0.5
const ALL = 'all'
const CHECKED = '☑'
const UNCHECKED = '☐'
const OPEN_MARK = '▾'
const CLOSED_MARK = '▸'
const KINDS_WITHOUT_SECTION: readonly Kind[] = ['instruction']
const PROFILE_KEY_PREFIX = 'profile:'
const MENU_KEY_PREFIX = 'menu:'
const ACTION_KEY_PREFIX = 'action:'
const PICKER_KEY_PREFIX = 'picker:'
const PICK_KEY_PREFIX = 'pick:'
const PICKER_LABELS: Readonly<Record<OpenPicker, string>> = {
  project: 'Project',
  scope: 'Scope',
}
const APPLIED_COLOR = 'suggestion'
const MENU_BORDER_ROWS = 2
const ORIGIN_NOTE = / (\(@import from .*\)|or commands)$/
const FILE_SCHEME = 'file://'
const PROFILE_ACTIONS: readonly ProfileAction[] = ['apply', 'duplicate', 'rename', 'delete']
const FIXED_PROFILE_ACTIONS: readonly ProfileAction[] = ['apply', 'duplicate']
const NAME_FIELDS = {
  new: { key: 'new-profile-name', verb: 'Duplicate', submitLabel: 'create' },
  rename: { key: 'rename-profile-name', verb: 'Rename', submitLabel: 'rename' },
} as const

const clipEnd = (text: string, width: number) =>
  text.length > width ? `${text.slice(0, Math.max(1, width - 1))}…` : text

const clipStart = (text: string, width: number) =>
  text.length > width ? `…${text.slice(text.length - Math.max(1, width - 1))}` : text

const actionsOf = (name: string) =>
  isFixedProfile(name) ? FIXED_PROFILE_ACTIONS : PROFILE_ACTIONS

const pageSize = (rows: number, menuRows = 0) =>
  Math.max(MIN_LIST_ROWS, rows - CHROME_ROWS - menuRows)

const withToggledSection = (open: readonly Kind[], kind: Kind): Kind[] =>
  open.includes(kind) ? open.filter(one => one !== kind) : [...open, kind]

const linesOf = (
  items: readonly Item[],
  isOn: (item: Item) => boolean,
  view: View,
): Line[] => {
  const visible = items.filter(item => view.scope === ALL || item.scope === view.scope)

  return KINDS.flatMap((kind): Line[] => {
    const ofKind = visible.filter(item => item.kind === kind)
    if (ofKind.length === 0) return []
    if (KINDS_WITHOUT_SECTION.includes(kind))
      return ofKind.map(item => ({ item, isInSection: false }))
    const isOpen = view.open.includes(kind)

    return [
      {
        kind,
        isOpen,
        count: ofKind.length,
        offCount: ofKind.filter(item => !isOn(item)).length,
      },
      ...(isOpen ? ofKind.map(item => ({ item, isInSection: true })) : []),
    ]
  })
}

export const menuKeyOf = (name: string) => `${MENU_KEY_PREFIX}${name}`

const fileLinkOf = (origin: string) =>
  origin.startsWith('/')
    ? `${FILE_SCHEME}${origin.replace(ORIGIN_NOTE, '').split('/').map(encodeURIComponent).join('/')}`
    : undefined

export const drawBand = (
  { Box, Button }: Pick<PaneElements, 'Box' | 'Button'>,
  profileName: string,
  onOpen: () => void,
) => (
  <Box>
    <Button
      key="open-pane"
      plain
      dimColor
      label={`↗ pristine · ${profileName}`}
      onPress={onOpen}
    />
  </Box>
)

export const drawPane = (
  { Box, Text, Button, Input, Link }: PaneElements,
  {
    items,
    root,
    projects,
    profiles,
    profile,
    applied,
    isOn,
    view,
    columns,
    rows,
    isDocked,
  }: PaneModel,
  actions: PaneActions,
) => {
  const isMenuOpen = view.edit === 'menu' && view.target === profile.name
  const menuActions = isMenuOpen ? actionsOf(profile.name) : []
  const lines = linesOf(items, isOn, view)
  const room = Math.max(20, columns - FRAME_COLUMNS - INDENT_COLUMNS - CHECKBOX_COLUMNS - SCOPE_COLUMNS - 2)
  const nameWidth = Math.floor(room * NAME_SHARE)
  const offCount = items.filter(item => !isOn(item)).length
  const isRenaming =
    view.edit === 'rename' &&
    !isFixedProfile(view.target) &&
    profiles.some(one => one.name === view.target)
  const scopeOptions: PickerOption[] = [
    { value: ALL, label: 'All' },
    ...SCOPES.filter(scope => items.some(item => item.scope === scope)).map(scope => ({
      value: scope,
      label: scope,
    })),
  ]
  const shownProject = view.project === '' ? root : view.project
  const projectOptions: PickerOption[] = [
    ...new Set([root, ...projects, shownProject]),
  ].map(path => ({ value: path, label: projectLabel(path, root) }))
  const pickers = {
    project: {
      options: projectOptions,
      picked: shownProject,
      onPick: actions.onProject,
    },
    scope: {
      options: scopeOptions,
      picked: view.scope,
      onPick: (value: string) =>
        actions.onView({ scope: value as Scope | 'all', page: 0, picker: 'none' }),
    },
  }
  const openRows = [
    ...(isMenuOpen ? [menuActions.length] : []),
    ...(view.picker === 'none' ? [] : [pickers[view.picker].options.length]),
  ].reduce((total, count) => total + count + MENU_BORDER_ROWS, 0)
  const size = pageSize(rows, openRows)
  const pages = Math.max(1, Math.ceil(lines.length / size))
  const page = Math.min(view.page, pages - 1)
  const drawNameField = (edit: keyof typeof NAME_FIELDS, onSubmit: (name: string) => void) => (
    <Box flexDirection="row" gap={1}>
      <Input
        key={NAME_FIELDS[edit].key}
        label={`${NAME_FIELDS[edit].verb} "${view.target}"`}
        placeholder="name"
        {...(edit === 'rename' ? { value: view.target } : {})}
        submitLabel={NAME_FIELDS[edit].submitLabel}
        autoFocus
        onSubmit={onSubmit}
      />
      <Button
        key="cancel-edit"
        plain
        dimColor
        label="Cancel"
        onPress={() => actions.onView({ edit: 'none' })}
      />
    </Box>
  )

  const drawPicker = (picker: OpenPicker) => {
    const { options, picked, onPick } = pickers[picker]
    const isOpen = view.picker === picker
    const pickedLabel = options.find(option => option.value === picked)?.label ?? picked

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text dimColor>{PICKER_LABELS[picker]}</Text>
          <Button
            key={`${PICKER_KEY_PREFIX}${picker}`}
            plain
            label={`${pickedLabel} ${isOpen ? OPEN_MARK : CLOSED_MARK}`}
            onPress={() => actions.onView({ picker: isOpen ? 'none' : picker })}
          />
        </Box>
        {isOpen && (
          <Box key="picker-menu" flexDirection="column" {...FRAME}>
            {options.map(option => (
              <Button
                key={`${PICK_KEY_PREFIX}${picker}:${option.value}`}
                plain
                dimColor={option.value !== picked}
                label={option.label}
                onPress={() => onPick(option.value)}
              />
            ))}
          </Box>
        )}
      </Box>
    )
  }

  const drawSection = (line: SectionLine) => (
    <Box flexDirection="row" gap={1}>
      <Button
        key={`section:${line.kind}`}
        plain
        label={`${line.isOpen ? OPEN_MARK : CLOSED_MARK} ${KIND_LABELS[line.kind]}`}
        onPress={() =>
          actions.onView({ open: withToggledSection(view.open, line.kind), page })
        }
      />
      <Text dimColor>{line.count}</Text>
      {line.offCount > 0 && <Text color="warning">{line.offCount} off</Text>}
    </Box>
  )

  const drawItem = ({ item, isInSection }: ItemLine) => {
    const isItemOn = isOn(item)
    const origin = clipStart(
      item.isLocked ? `locked · ${item.origin}` : item.origin,
      room - nameWidth,
    )
    const fileLink = fileLinkOf(item.origin)

    return (
      <Box flexDirection="row" gap={1} paddingLeft={isInSection ? INDENT_COLUMNS : 0}>
        {item.isLocked ? (
          <Text dimColor>{CHECKED}</Text>
        ) : (
          <Button
            key={`toggle:${item.id}`}
            plain
            label={isItemOn ? CHECKED : UNCHECKED}
            onPress={() => actions.onToggle(item.id)}
          />
        )}
        <Text dimColor={!isItemOn}>{clipEnd(item.name, nameWidth).padEnd(nameWidth)}</Text>
        <Text color="suggestion" dimColor={!isItemOn}>
          {item.scope.padEnd(SCOPE_COLUMNS - 2)}
        </Text>
        <Text dimColor>
          {fileLink === undefined ? origin : <Link href={fileLink} label={origin} />}
        </Text>
      </Box>
    )
  }

  const drawProfile = (one: Profile) => {
    const isApplied = one.name === applied
    const isShown = one.name === profile.name

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Box flexDirection="row">
            {isApplied && <Text color={APPLIED_COLOR}>[</Text>}
            {isApplied && isShown ? (
              <Text color={APPLIED_COLOR}>{one.name}</Text>
            ) : (
              <Button
                key={`${PROFILE_KEY_PREFIX}${one.name}`}
                plain
                dimColor={!isShown}
                label={one.name}
                onPress={() =>
                  actions.onView({
                    viewed: one.name,
                    ...(view.edit === 'menu' ? { edit: 'none' as const } : {}),
                  })
                }
              />
            )}
            {isApplied && <Text color={APPLIED_COLOR}>]</Text>}
          </Box>
          {isShown && (
            <Button
              key={menuKeyOf(one.name)}
              plain
              label={isMenuOpen ? OPEN_MARK : CLOSED_MARK}
              onPress={() =>
                actions.onView(isMenuOpen ? { edit: 'none' } : { edit: 'menu', target: one.name })
              }
            />
          )}
        </Box>
        {isShown && isMenuOpen && (
          <Box key="profile-menu" flexDirection="column" {...FRAME}>
            {menuActions.map(action => (
              <Button
                key={`${ACTION_KEY_PREFIX}${action}`}
                plain
                label={action}
                onPress={() => actions.onAction(one.name, action)}
              />
            ))}
          </Box>
        )}
      </Box>
    )
  }

  return (
    <Box flexDirection="column" {...(isDocked ? { minHeight: rows } : {})}>
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row" gap={1}>
          <Text bold color="claude">
            Pristine
          </Text>
          <Text dimColor>
            {profile.name} · base {profile.base} · {offCount} of {items.length} off
          </Text>
        </Box>
        <Box flexDirection="row" gap={2}>
          <Button key="refresh" plain dimColor label="Refresh" hotkey="r" onPress={actions.onRefresh} />
          <Button key="restore" plain dimColor label="Restore all" onPress={actions.onRestore} />
        </Box>
      </Box>
      <Box flexDirection="row" gap={2} marginBottom={1}>
        {drawPicker('project')}
        {drawPicker('scope')}
      </Box>
      <Box flexDirection="column" {...FRAME}>
        {lines.length === 0 && <Text dimColor>Nothing here in this scope.</Text>}
        {lines
          .slice(page * size, (page + 1) * size)
          .map(line => ('kind' in line ? drawSection(line) : drawItem(line)))}
      </Box>
      {pages > 1 && (
        <Box flexDirection="row" gap={1} justifyContent="center">
          <Button
            key="prev"
            plain
            label="Prev"
            hotkey="p"
            onPress={() => actions.onView({ page: Math.max(0, page - 1) })}
          />
          <Text dimColor>
            page {page + 1}/{pages}
          </Text>
          <Button
            key="next"
            plain
            label="Next"
            hotkey="n"
            onPress={() => actions.onView({ page: Math.min(pages - 1, page + 1) })}
          />
        </Box>
      )}
      <Box flexGrow={1} />
      {view.notice !== '' && <Text dimColor>{clipEnd(view.notice, columns * 2)}</Text>}
      {view.edit === 'new' && drawNameField('new', actions.onCreate)}
      {isRenaming && drawNameField('rename', actions.onRename)}
      <Box key="profile-tabs" flexDirection="row" gap={2} flexWrap="wrap" {...FRAME}>
        {profiles.map(drawProfile)}
        <Button
          key="new-profile"
          plain
          label="+"
          onPress={() => actions.onView({ edit: 'new', target: profile.name })}
        />
      </Box>
    </Box>
  )
}
