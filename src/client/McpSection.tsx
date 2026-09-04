/**
 * The MCP manager settings section: server table with live status,
 * add/edit form, enable/disable and remove.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, DisclosureRow, IconDatabaseOutline16, Input, Pill, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  addServer,
  fetchServers,
  parseJsonField,
  removeServer,
  setServerEnabled,
  updateServer,
  type ServerView,
} from './api.ts'

type Translate = (key: string) => string

interface FormState {
  id: string
  transport: 'stdio' | 'streamable-http'
  description: string
  command: string
  args: string
  env: string
  cwd: string
  url: string
  headers: string
  toolCallTimeoutMs: string
}

const EMPTY_FORM: FormState = {
  id: '',
  transport: 'stdio',
  description: '',
  command: '',
  args: '',
  env: '',
  cwd: '',
  url: '',
  headers: '',
  toolCallTimeoutMs: '',
}

function formFromServer(server: ServerView): FormState {
  return {
    id: server.id,
    transport: server.transport,
    description: server.description ?? '',
    command: server.command ?? '',
    args: server.args === undefined ? '' : JSON.stringify(server.args),
    env: server.env === undefined ? '' : JSON.stringify(server.env),
    cwd: server.cwd ?? '',
    url: server.url ?? '',
    headers: server.headers === undefined ? '' : JSON.stringify(server.headers),
    toolCallTimeoutMs: server.toolCallTimeoutMs === undefined ? '' : String(server.toolCallTimeoutMs),
  }
}

function entryFromForm(form: FormState, editing: boolean): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    transport: form.transport,
    description: form.description.trim() === '' ? undefined : form.description.trim(),
  }
  if (editing) entry.id = form.id
  else entry.id = form.id.trim()
  if (form.transport === 'stdio') {
    entry.command = form.command.trim() === '' ? undefined : form.command.trim()
    const args = parseJsonField(form.args)
    if (args !== undefined) entry.args = args
    const env = parseJsonField(form.env)
    if (env !== undefined) entry.env = env
    if (form.cwd.trim() !== '') entry.cwd = form.cwd.trim()
  } else {
    entry.url = form.url.trim() === '' ? undefined : form.url.trim()
    const headers = parseJsonField(form.headers)
    if (headers !== undefined) entry.headers = headers
  }
  if (form.toolCallTimeoutMs.trim() !== '') entry.toolCallTimeoutMs = Number(form.toolCallTimeoutMs.trim())
  return entry
}

function statusMeta(server: ServerView, t: Translate): { dot: 'done' | 'ongoing' | 'error' | null; label: string } {
  switch (server.status) {
    case 'ready': return { dot: 'done', label: t('statusReady') }
    case 'starting': return { dot: 'ongoing', label: t('statusStarting') }
    case 'error': return { dot: 'error', label: t('statusError') }
    default: return { dot: null, label: t('statusDisabled') }
  }
}

function endpointOf(server: ServerView): string {
  if (server.transport === 'stdio') {
    const base = server.command ?? ''
    const tail = (server.args ?? []).slice(0, 2).join(' ')
    return tail === '' ? base : `${base} ${tail}`
  }
  return server.url ?? ''
}

export function McpSection({ t }: { t: Translate }): JSX.Element {
  const [servers, setServers] = useState<ServerView[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<{ mode: 'add' } | { mode: 'edit' } | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const serversRef = useRef<ServerView[] | null>(null)
  serversRef.current = servers

  const refresh = useCallback(async () => {
    try {
      const next = await fetchServers()
      setError(null)
      setServers(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => {
      // Only poll while no form is open to avoid clobbering nothing but keep
      // status dots live; mutations trigger explicit refreshes.
      void refresh()
    }, 5000)
    return () => clearInterval(timer)
  }, [refresh])

  const beginAdd = () => {
    setForm(EMPTY_FORM)
    setFormError(null)
    setEditing({ mode: 'add' })
  }

  const beginEdit = (server: ServerView) => {
    setForm(formFromServer(server))
    setFormError(null)
    setEditing({ mode: 'edit' })
  }

  const submit = async () => {
    if (busy) return
    setBusy(true)
    setFormError(null)
    try {
      if (editing?.mode === 'add') {
        await addServer(entryFromForm(form, false))
      } else if (editing?.mode === 'edit') {
        await updateServer(entryFromForm(form, true))
      }
      setEditing(null)
      await refresh()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const toggleEnabled = async (server: ServerView) => {
    if (busy) return
    setBusy(true)
    try {
      await setServerEnabled(server.id, !server.enabled)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const doRemove = async (id: string) => {
    if (busy) return
    setBusy(true)
    try {
      await removeServer(id)
      setConfirmRemove(null)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const toggleExpanded = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const field = (key: keyof FormState) => ({
    value: form[key],
    onChange: (e: { target: { value: string } }) => setForm(f => ({ ...f, [key]: e.target.value })),
  })

  const rows = useMemo(() => servers ?? [], [servers])

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1, opacity: 0.8, fontSize: 13 }}>{t('subtitle')}</span>
        <Button variant="ghost" size="sm" onClick={() => { void refresh() }}>{t('refresh')}</Button>
        <Button variant="primary" size="sm" disabled={editing !== null} onClick={beginAdd}>{t('addServer')}</Button>
      </div>

      {error !== null && (
        <div role="alert" style={{ color: 'var(--dsw-danger, #d13438)', fontSize: 13 }}>
          {t('loadFailed')}: {error}
        </div>
      )}

      {editing === null && rows.length === 0 && servers !== null && (
        <div style={{ opacity: 0.7, fontSize: 13, padding: '12px 0' }}>{t('empty')}</div>
      )}
      {servers === null && error === null && <div style={{ opacity: 0.7, fontSize: 13 }}>{t('loading')}</div>}

      {rows.map(server => {
        const meta = statusMeta(server, t)
        return (
          <div key={server.id} style={{ border: '1px solid var(--dsw-border, rgba(128,128,128,.35))', borderRadius: 8, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {meta.dot !== null && <StateDot state={meta.dot} />}
              <strong style={{ fontSize: 14 }}>{server.id}</strong>
              <Pill active={false}>{server.transport === 'stdio' ? 'stdio' : 'http'}</Pill>
              <span style={{ opacity: 0.75, fontSize: 12, flex: 1, minWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{endpointOf(server)}</span>
              <span style={{ fontSize: 12, opacity: 0.85 }}>{meta.label}{server.toolNames.length > 0 ? ` · ${server.toolNames.length} ${t('tools')}` : ''}</span>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => { void toggleEnabled(server) }}>
                {server.enabled ? t('disable') : t('enable')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => beginEdit(server)}>{t('edit')}</Button>
              {confirmRemove === server.id
                ? (
                  <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', fontSize: 12 }}>
                    <span>{t('removeConfirm')}</span>
                    <Button variant="primary" size="sm" disabled={busy} onClick={() => { void doRemove(server.id) }}>{t('remove')}</Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmRemove(null)}>{t('cancel')}</Button>
                  </span>
                )
                : <Button variant="ghost" size="sm" onClick={() => setConfirmRemove(server.id)}>{t('remove')}</Button>}
            </div>
            {server.error !== undefined && (
              <div role="alert" style={{ fontSize: 12, color: 'var(--dsw-danger, #d13438)' }}>{server.error}</div>
            )}
            {server.toolNames.length > 0 && (
              <DisclosureRow
                icon={<IconDatabaseOutline16 />}
                title={`${t('tools')} (${server.toolNames.length})`}
                expandable
                open={expanded.has(server.id)}
                onToggle={() => toggleExpanded(server.id)}
              >
                <ul style={{ margin: '4px 0 0', paddingInlineStart: 20, fontSize: 12, opacity: 0.85 }}>
                  {server.toolNames.map(name => <li key={name}>{name}</li>)}
                </ul>
              </DisclosureRow>
            )}
          </div>
        )
      })}

      {editing !== null && (
        <div style={{ border: '1px solid var(--dsw-border, rgba(128,128,128,.35))', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{editing.mode === 'add' ? t('addServer') : `${t('edit')}: ${form.id}`}</span>
            <span style={{ display: 'inline-flex', gap: 4 }}>
              <Pill active={form.transport === 'stdio'} onClick={() => setForm(f => ({ ...f, transport: 'stdio' }))}>stdio</Pill>
              <Pill active={form.transport === 'streamable-http'} onClick={() => setForm(f => ({ ...f, transport: 'streamable-http' }))}>streamable-http</Pill>
            </span>
          </div>
          {editing.mode === 'add' && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              {t('id')}
              <Input placeholder="github" {...field('id')} />
              <span style={{ opacity: 0.65 }}>{t('idHint')}</span>
            </label>
          )}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
            {t('description')}
            <Input {...field('description')} />
          </label>
          {form.transport === 'stdio'
            ? (
              <>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                  {t('command')}
                  <Input placeholder="npx" {...field('command')} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                  {t('args')}
                  <Input placeholder='["-y","@modelcontextprotocol/server-filesystem","/tmp"]' {...field('args')} />
                  <span style={{ opacity: 0.65 }}>{t('argsHint')}</span>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                  {t('env')}
                  <Input placeholder='{"GITHUB_TOKEN":"ghp_..."}' {...field('env')} />
                  <span style={{ opacity: 0.65 }}>{t('envHint')}</span>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                  {t('cwd')}
                  <Input {...field('cwd')} />
                </label>
              </>
            )
            : (
              <>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                  {t('url')}
                  <Input placeholder="http://localhost:3000/mcp" {...field('url')} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                  {t('headers')}
                  <Input placeholder='{"Authorization":"Bearer ..."}' {...field('headers')} />
                  <span style={{ opacity: 0.65 }}>{t('headersHint')}</span>
                </label>
              </>
          )}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
            {t('toolCallTimeoutMs')}
            <Input placeholder="60000" inputMode="numeric" {...field('toolCallTimeoutMs')} />
          </label>
          {formError !== null && (
            <div role="alert" style={{ color: 'var(--dsw-danger, #d13438)', fontSize: 12 }}>{formError}</div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>{t('cancel')}</Button>
            <Button variant="primary" size="sm" disabled={busy} onClick={() => { void submit() }}>{t('save')}</Button>
          </div>
        </div>
      )}
    </section>
  )
}
