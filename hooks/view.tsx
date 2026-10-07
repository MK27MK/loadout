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
}

const CHROME_ROWS = 9
const MIN_LIST_ROWS = 3
const TOGGLE_COLUMNS = 8
const SCOPE_COLUMNS = 9
const NAME_SHARE = 0.5
const ALL = 'all'

const clipEnd = (text: string, width: number) =>
  text.length > width ? `${text.slice(0, Math.max(1, width - 1))}…` : text

const clipStart = (text: string, width: number) =>
  text.length > width ? `…${text.slice(text.length - Math.max(1, width - 1))}` : text

export const visibleItems = (items: readonly Item[], view: View) =>
  items.filter(
    item =>
      (view.kind === ALL || item.kind === view.kind) &&
      (view.scope === ALL || item.scope === view.scope),
  )

export const pageSize = (rows: number) => Math.max(MIN_LIST_ROWS, rows - CHROME_ROWS)

export const drawPane = (
  { Box, Text, Button, Input, Select }: PaneElements,
  { items, profiles, profile, view, columns, rows }: PaneModel,
  actions: PaneActions,
) => {
  const shown = visibleItems(items, view)
  const size = pageSize(rows)
  const pages = Math.max(1, Math.ceil(shown.length / size))
  const page = Math.min(view.page, pages - 1)
  const room = Math.max(20, columns - TOGGLE_COLUMNS - SCOPE_COLUMNS - 2)
  const nameWidth = Math.floor(room * NAME_SHARE)
  const offCount = items.filter(item => !isShownOn(profile, item)).length
  const kindOptions = [
    { value: ALL, label: `All (${items.length})` },
    ...KINDS.map(kind => ({
      value: kind,
      label: `${KIND_LABELS[kind]} (${items.filter(item => item.kind === kind).length})`,
    })),
  ]
  const scopeOptions = [
    { value: ALL, label: 'All scopes' },
    ...SCOPES.filter(scope => items.some(item => item.scope === scope)).map(scope => ({
      value: scope,
      label: scope,
    })),
  ]

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Select
          key="profile"
          label="Profile"
          value={profile.name}
          options={profiles.map(one => ({ value: one.name, label: one.name }))}
          onSelect={actions.onProfile}
        />
        <Text dimColor>
          base {profile.base} · {offCount} off of {items.length}
        </Text>
      </Box>
      <Input
        key="new-profile"
        label="New profile from this one"
        placeholder="ECC-react"
        submitLabel="Create"
        onSubmit={actions.onCreate}
      />
      <Box flexDirection="row" gap={1}>
        {!isBuiltinProfile(profile.name) && (
          <Button key="delete" label="Delete profile" onPress={actions.onDelete} />
        )}
        <Button key="restore" label="Restore all" onPress={actions.onRestore} />
        <Button key="refresh" label="Refresh" hotkey="r" onPress={actions.onRefresh} />
      </Box>
      <Box flexDirection="row" gap={1}>
        <Select
          key="kind"
          label="Show"
          value={view.kind}
          options={kindOptions}
          onSelect={value => actions.onView({ kind: value as Kind | 'all', page: 0 })}
        />
        <Select
          key="scope"
          label="Scope"
          value={view.scope}
          options={scopeOptions}
          onSelect={value => actions.onView({ scope: value as Scope | 'all', page: 0 })}
        />
      </Box>
      {view.notice !== '' && <Text color="warning">{clipEnd(view.notice, columns * 2)}</Text>}
      {shown.length === 0 && <Text dimColor>Nothing here in this filter.</Text>}
      {shown.slice(page * size, (page + 1) * size).map(item => {
        const isOn = isShownOn(profile, item)

        return (
          <Box flexDirection="row" gap={1}>
            {item.isLocked ? (
              <Text dimColor>locked</Text>
            ) : (
              <Button
                key={`toggle:${item.id}`}
                plain
                label={isOn ? '● on ' : '○ off'}
                dimColor={!isOn}
                onPress={() => actions.onToggle(item.id)}
              />
            )}
            <Text dimColor={!isOn}>{clipEnd(item.name, nameWidth).padEnd(nameWidth)}</Text>
            <Text bold>{item.scope.padEnd(SCOPE_COLUMNS - 2)}</Text>
            <Text dimColor>{clipStart(item.origin, room - nameWidth)}</Text>
          </Box>
        )
      })}
      <Box flexDirection="row" gap={1}>
        <Button
          key="prev"
          label="Prev"
          hotkey="p"
          onPress={() => actions.onView({ page: Math.max(0, page - 1) })}
        />
        <Text dimColor>
          page {page + 1}/{pages}
        </Text>
        <Button
          key="next"
          label="Next"
          hotkey="n"
          onPress={() => actions.onView({ page: Math.min(pages - 1, page + 1) })}
        />
      </Box>
    </Box>
  )
}
