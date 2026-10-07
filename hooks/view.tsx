import type { Elements } from 'claude-code'

import type { Item, Kind, Profile, Scope, View } from '../types'
import { KINDS, KIND_LABELS, SCOPES, isBuiltinProfile, isShownOn } from './model'

export type PaneElements = Pick<
  Elements['terminal'],
  'Box' | 'Text' | 'Button' | 'Input' | 'Select'
>

export type PaneActions = {
  onToggle: (id: string) => void
  onProfile: (name: string) => void
  onCreate: (name: string) => void
  onRename: (name: string) => void
  onDelete: () => void
  onRestore: () => void
  onRefresh: () => void
  onView: (patch: Partial<View>) => void
}

export type PaneModel = {
  items: readonly Item[]
  profiles: readonly Profile[]
  profile: Profile
  view: View
  columns: number
  rows: number
  isDocked: boolean
}

export type SectionLine = { kind: Kind; isOpen: boolean; count: number; offCount: number }
export type ItemLine = { item: Item; isInSection: boolean }
export type Line = SectionLine | ItemLine

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

const clipEnd = (text: string, width: number) =>
  text.length > width ? `${text.slice(0, Math.max(1, width - 1))}…` : text

const clipStart = (text: string, width: number) =>
  text.length > width ? `…${text.slice(text.length - Math.max(1, width - 1))}` : text

export const visibleItems = (items: readonly Item[], view: View) =>
  items.filter(item => view.scope === ALL || item.scope === view.scope)

export const pageSize = (rows: number) => Math.max(MIN_LIST_ROWS, rows - CHROME_ROWS)

export const withToggledSection = (open: readonly Kind[], kind: Kind): Kind[] =>
  open.includes(kind) ? open.filter(one => one !== kind) : [...open, kind]

export const linesOf = (items: readonly Item[], profile: Profile, view: View): Line[] => {
  const visible = visibleItems(items, view)

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
        offCount: ofKind.filter(item => !isShownOn(profile, item)).length,
      },
      ...(isOpen ? ofKind.map(item => ({ item, isInSection: true })) : []),
    ]
  })
}

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
  { Box, Text, Button, Input, Select }: PaneElements,
  { items, profiles, profile, view, columns, rows, isDocked }: PaneModel,
  actions: PaneActions,
) => {
  const lines = linesOf(items, profile, view)
  const size = pageSize(rows)
  const pages = Math.max(1, Math.ceil(lines.length / size))
  const page = Math.min(view.page, pages - 1)
  const room = Math.max(20, columns - FRAME_COLUMNS - INDENT_COLUMNS - CHECKBOX_COLUMNS - SCOPE_COLUMNS - 2)
  const nameWidth = Math.floor(room * NAME_SHARE)
  const offCount = items.filter(item => !isShownOn(profile, item)).length
  const isCustom = !isBuiltinProfile(profile.name)
  const scopeOptions = [
    { value: ALL, label: 'All scopes' },
    ...SCOPES.filter(scope => items.some(item => item.scope === scope)).map(scope => ({
      value: scope,
      label: scope,
    })),
  ]
  const closeEdit = () => actions.onView({ edit: 'none' })

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
    const isOn = isShownOn(profile, item)
    const origin = item.isLocked ? `locked · ${item.origin}` : item.origin

    return (
      <Box flexDirection="row" gap={1} paddingLeft={isInSection ? INDENT_COLUMNS : 0}>
        {item.isLocked ? (
          <Text dimColor>{CHECKED}</Text>
        ) : (
          <Button
            key={`toggle:${item.id}`}
            plain
            label={isOn ? CHECKED : UNCHECKED}
            onPress={() => actions.onToggle(item.id)}
          />
        )}
        <Text dimColor={!isOn}>{clipEnd(item.name, nameWidth).padEnd(nameWidth)}</Text>
        <Text color="suggestion" dimColor={!isOn}>
          {item.scope.padEnd(SCOPE_COLUMNS - 2)}
        </Text>
        <Text dimColor>{clipStart(origin, room - nameWidth)}</Text>
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
      <Box marginBottom={1}>
        <Select
          key="scope"
          label="Scope"
          value={view.scope}
          options={scopeOptions}
          onSelect={value => actions.onView({ scope: value as Scope | 'all', page: 0 })}
        />
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
      {view.edit === 'new' && (
        <Box flexDirection="row" gap={1}>
          <Input
            key="new-profile-name"
            label="New profile"
            placeholder="name"
            submitLabel="create"
            autoFocus
            onSubmit={actions.onCreate}
          />
          <Button key="cancel-edit" plain dimColor label="Cancel" onPress={closeEdit} />
        </Box>
      )}
      {view.edit === 'rename' && isCustom && (
        <Box flexDirection="row" gap={1}>
          <Input
            key="rename-profile-name"
            label={`Rename "${profile.name}"`}
            placeholder="name"
            value={profile.name}
            submitLabel="rename"
            autoFocus
            onSubmit={actions.onRename}
          />
          <Button key="cancel-edit" plain dimColor label="Cancel" onPress={closeEdit} />
        </Box>
      )}
      <Box key="profile-tabs" flexDirection="row" justifyContent="space-between" {...FRAME}>
        <Box flexDirection="row" gap={2} flexWrap="wrap">
          {profiles.map(one =>
            one.name === profile.name ? (
              <Button
                key={`profile:${one.name}`}
                variant="primary"
                label={one.name}
                onPress={() => actions.onProfile(one.name)}
              />
            ) : (
              <Button
                key={`profile:${one.name}`}
                plain
                dimColor
                label={one.name}
                onPress={() => actions.onProfile(one.name)}
              />
            ),
          )}
          <Button
            key="new-profile"
            plain
            label="+"
            onPress={() => actions.onView({ edit: 'new' })}
          />
        </Box>
        {isCustom && (
          <Box flexDirection="row" gap={2}>
            <Button
              key="rename-profile"
              plain
              dimColor
              label="Rename"
              onPress={() => actions.onView({ edit: 'rename' })}
            />
            <Button key="delete-profile" plain dimColor label="Delete" onPress={actions.onDelete} />
          </Box>
        )}
      </Box>
    </Box>
  )
}
