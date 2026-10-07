export type Kind =
  | 'instruction'
  | 'rule'
  | 'memory'
  | 'skill'
  | 'agent'
  | 'mcp'
  | 'hook-event'
  | 'hook'
  | 'plugin'
  | 'permission'
  | 'setting'

export type Scope =
  | 'policy'
  | 'user'
  | 'project'
  | 'local'
  | 'flag'
  | 'plugin'
  | 'account'
  | 'memory'
  | 'mixed'

export type WritableSource = 'user' | 'project' | 'local'

export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json }

export type SettingsEntry = {
  mode: 'flag' | 'key' | 'element'
  source: WritableSource
  path: string[]
  value: Json
}

export type Item = {
  id: string
  kind: Kind
  name: string
  scope: Scope
  origin: string
  isLocked: boolean
  isOn: boolean
  entry?: SettingsEntry
  event?: string
}

export type Profile = {
  name: string
  base: 'on' | 'off'
  overrides: Record<string, boolean>
}

export type ProfileEdit = 'none' | 'new' | 'rename'

export type View = {
  open: Kind[]
  scope: Scope | 'all'
  page: number
  notice: string
  edit: ProfileEdit
}

export type Stash = Record<string, Item>

export type Ledger = {
  stash: Stash
  raised: string[]
}

declare module 'claude-code' {
  interface PluginState {
    pristine: {
      profiles: Profile[]
      active: string
      seen: Item[]
      items: Item[]
      view: Shaped<View>
    }
  }
}
