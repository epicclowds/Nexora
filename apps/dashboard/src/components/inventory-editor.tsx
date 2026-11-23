'use client';

import { PERMISSIONS } from '@mnm/shared-types';
import { Plus, RefreshCw, RotateCcw, Trash2, X } from 'lucide-react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { type DragEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError, errorKey } from '@/lib/api';
import { diff, type Draft, type DraftItem, effective, initials, type InventoryItem, ITEM_ID, move, normalizeId } from '@/lib/inventory';
import { prettyId } from '@/lib/stats';
import { cn } from '@/lib/utils';
import { useAuth } from './auth-provider';
import { ConfirmDialog } from './confirm-dialog';
import { useLiveRefresh } from './realtime-provider';
import { useToast } from './toaster';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Select, Skeleton, Textarea } from './ui/primitives';

type Kind = 'inventory' | 'ender-chest';
interface ServerOverview {
  serverId: string;
  serverName: string;
  online: boolean;
  kinds: { kind: 'INVENTORY' | 'ENDER_CHEST'; revision: number; capturedAt: string }[];
}
interface RevisionSummary {
  id: string;
  status: 'PENDING' | 'APPLIED' | 'CONFLICT' | 'REJECTED' | 'ROLLED_BACK' | 'CANCELLED' | 'SNAPSHOT';
  reason: string | null;
  resultMessage: string | null;
  rollbackOfId: string | null;
  actor: { id: string; username: string } | null;
  createdAt: string;
  appliedAt: string | null;
  changes: { slot: number; before: { id: string; amount: number } | null; after: { id: string; amount: number } | null }[];
}
interface View {
  revision: number;
  capturedAt: string;
  items: InventoryItem[];
  pending: string | null;
  revisions: RevisionSummary[];
}

const STATUS_VARIANT: Record<RevisionSummary['status'], 'default' | 'warning' | 'danger' | 'muted' | 'info'> = {
  PENDING: 'info',
  APPLIED: 'default',
  CONFLICT: 'warning',
  REJECTED: 'danger',
  ROLLED_BACK: 'muted',
  CANCELLED: 'muted',
  SNAPSHOT: 'muted',
};

function hueOf(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

/** One Minecraft-style slot. Item textures are not bundled; items show a labelled tile. */
function Slot({ slot, item, selected, changed, editable, onSelect, onDrop, label }: {
  slot: number;
  item: DraftItem | null;
  selected: boolean;
  changed: boolean;
  editable: boolean;
  onSelect: (slot: number) => void;
  onDrop: (from: number, to: number) => void;
  label?: string;
}) {
  const t = useTranslations('inventory');
  const enchanted = item && Object.keys(item.enchantments).length > 0;
  const damaged = item?.maxDamage && item.damage ? 1 - item.damage / item.maxDamage : null;
  return (
    <button
      type="button"
      draggable={editable && !!item}
      onDragStart={(e: DragEvent) => e.dataTransfer.setData('text/plain', String(slot))}
      onDragOver={(e: DragEvent) => editable && e.preventDefault()}
      onDrop={(e: DragEvent) => {
        e.preventDefault();
        const from = Number(e.dataTransfer.getData('text/plain'));
        if (!Number.isNaN(from)) onDrop(from, slot);
      }}
      onClick={() => onSelect(slot)}
      title={item ? `${prettyId(item.id)}${item.name ? ` – ${item.name}` : ''} ×${item.amount}` : label ?? t('empty')}
      aria-label={item ? `${t('slot', { slot })}: ${item.amount} × ${prettyId(item.id)}` : `${t('slot', { slot })}: ${label ?? t('empty')}`}
      aria-pressed={selected}
      className={cn(
        'relative size-12 shrink-0 border-2 bg-[#8b8b8b] [border-color:#373737_#ffffff_#ffffff_#373737] transition-[outline] focus-visible:outline-2 focus-visible:outline-primary dark:bg-[#5a5a5a] dark:[border-color:#2a2a2a_#8f8f8f_#8f8f8f_#2a2a2a]',
        selected && 'outline-2 outline-offset-1 outline-primary',
        changed && 'ring-2 ring-gold',
      )}
    >
      {item ? (
        <>
          <span
            className={cn('absolute inset-1 flex items-center justify-center rounded-sm text-[11px] font-bold text-white [text-shadow:1px_1px_0_#000]', enchanted && 'shadow-[0_0_8px_2px_#b06cff] ring-1 ring-[#c99bff]')}
            style={{ background: `oklch(0.5 0.12 ${hueOf(item.id)})` }}
          >
            {initials(item.id)}
          </span>
          {item.amount > 1 && <span className="absolute bottom-0 right-0.5 text-xs font-bold text-white [text-shadow:1px_1px_0_#000]">{item.amount}</span>}
          {damaged !== null && (
            <span className="absolute inset-x-1 bottom-0.5 h-0.5 bg-black">
              <span className="block h-full" style={{ width: `${damaged * 100}%`, background: `hsl(${damaged * 120} 90% 45%)` }} />
            </span>
          )}
        </>
      ) : (
        label && <span className="absolute inset-0 flex items-center justify-center text-[8px] uppercase text-black/40 dark:text-white/30">{label}</span>
      )}
    </button>
  );
}

/** Inventory or Ender Chest of one player on one server, with editing, history and rollback. */
export function InventoryEditor({ uuid, kind }: { uuid: string; kind: Kind }) {
  const t = useTranslations('inventory');
  const tc = useTranslations('common');
  const te = useTranslations('errors');
  const format = useFormatter();
  const now = useNow({ updateInterval: 30_000 });
  const toast = useToast();
  const { can } = useAuth();
  const canEdit = can(PERMISSIONS.PLAYERS_EDIT_INVENTORY);
  const [servers, setServers] = useState<ServerOverview[] | null>(null);
  const [scope, setScope] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [missing, setMissing] = useState(false);
  const [draft, setDraft] = useState<Draft>(new Map());
  const [selected, setSelected] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const size = kind === 'inventory' ? 41 : 27;

  const loadServers = useCallback(async () => {
    const list = await api<ServerOverview[]>(`/players/${uuid}/inventories`).catch(() => []);
    setServers(list);
    setScope((current) => current ?? list.find((s) => s.online)?.serverId ?? list[0]?.serverId ?? null);
  }, [uuid]);

  const loadView = useCallback(async () => {
    if (!scope) return;
    try {
      setView(await api<View>(`/players/${uuid}/inventories/${scope}/${kind}`));
      setMissing(false);
    } catch (err) {
      setView(null);
      setMissing(err instanceof ApiError && err.status === 404);
    }
  }, [uuid, scope, kind]);

  useEffect(() => {
    void loadServers();
  }, [loadServers]);
  useEffect(() => {
    setDraft(new Map());
    setSelected(null);
    void loadView();
  }, [loadView]);
  // Live updates only refresh the view when nothing is being edited.
  useLiveRefresh(['inventory.changed'], () => {
    void loadServers();
    if (draft.size === 0) void loadView();
  }, 120_000);

  const items = useMemo(() => new Map((view?.items ?? []).map((i) => [i.slot, i])), [view]);
  const changes = useMemo(() => (view ? diff(items, draft, view.items) : []), [items, draft, view]);
  const changedSlots = new Set(changes.map((c) => c.slot));
  const server = servers?.find((s) => s.serverId === scope);
  const editable = canEdit && !!view && !view.pending;
  const current = selected === null ? null : effective(items, draft, selected);

  function update(slot: number, item: DraftItem | null) {
    setDraft(new Map(draft).set(slot, item));
  }

  async function save() {
    if (!view || !scope) return;
    setBusy(true);
    try {
      await api(`/players/${uuid}/inventories/${scope}/${kind}/revisions`, { method: 'POST', body: { baseRevision: view.revision, reason: reason.trim() || undefined, changes } });
      toast(t('saved'));
      setDraft(new Map());
      setReason('');
      await loadView();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      if (code === 'STALE_REVISION' || code === 'STALE_SLOT') {
        setDraft(new Map());
        await loadView();
      }
      toast(code === 'STALE_REVISION' || code === 'PENDING_EDIT' || code === 'STALE_SLOT' ? t(`errors.${code}`) : te(errorKey(err)), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    try {
      await api(`/players/${uuid}/inventories/${scope}/refresh`, { method: 'POST' });
      toast(t('refreshRequested'));
    } catch (err) {
      toast(err instanceof ApiError && err.code === 'PLAYER_NOT_ON_SERVER' ? t('errors.PLAYER_NOT_ON_SERVER') : te(errorKey(err)), 'error');
    }
  }

  async function revisionAction(path: string, success?: string) {
    try {
      await api(path, { method: 'POST', body: {} });
      if (success) toast(success);
      await loadView();
    } catch (err) {
      toast(err instanceof ApiError && err.code === 'PENDING_EDIT' ? t('errors.PENDING_EDIT') : te(errorKey(err)), 'error');
    }
  }

  if (!servers) return <Skeleton className="h-72" />;
  if (servers.length === 0) return <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">{t('noServers')}</div>;

  const slotProps = (slot: number, label?: string) => ({
    slot,
    label,
    item: effective(items, draft, slot),
    selected: selected === slot,
    changed: changedSlots.has(slot),
    editable,
    onSelect: setSelected,
    onDrop: (from: number, to: number) => editable && setDraft(move(items, draft, from, to)),
  });

  return (
    <div className="grid gap-6 [&>*]:min-w-0">
      <div className="flex flex-wrap items-center gap-3">
        <Select aria-label={t('server')} className="w-56" value={scope ?? ''} onChange={(e) => setScope(e.target.value)}>
          {servers.map((s) => (
            <option key={s.serverId} value={s.serverId}>
              {s.serverName}
              {s.online ? ` · ${tc('online')}` : ''}
            </option>
          ))}
        </Select>
        {view && (
          <span className="text-xs text-muted-foreground">
            {t('capturedAt', { time: format.relativeTime(new Date(view.capturedAt), now) })} · {t('revision', { revision: view.revision })}
          </span>
        )}
        <Button variant="outline" size="sm" className="ml-auto" disabled={!server?.online} title={t('refreshHint')} onClick={() => void refresh()}>
          <RefreshCw aria-hidden /> {t('refresh')}
        </Button>
      </div>

      {missing && <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">{t('noSnapshot')}</div>}

      {view && (
        <>
          {!canEdit && <Alert>{t('readOnly')}</Alert>}
          {canEdit && <Alert>{server?.online ? t('onlineNotice') : t('offlineNotice')}</Alert>}
          {view.pending && (
            <Alert className="flex flex-wrap items-center justify-between gap-2">
              {t('pending')}
              {canEdit && (
                <Button size="sm" variant="outline" onClick={() => void revisionAction(`/players/${uuid}/inventories/revisions/${view.pending}/cancel`)}>
                  <X aria-hidden /> {t('cancelPending')}
                </Button>
              )}
            </Alert>
          )}

          <div className="grid gap-6 xl:grid-cols-[auto_1fr] [&>*]:min-w-0">
            <Card className="w-fit max-w-full overflow-x-auto bg-[#c6c6c6] p-4 dark:bg-[#3b3b3b]">
              {kind === 'inventory' ? (
                <div className="grid gap-3">
                  <div className="flex gap-4">
                    <div className="grid gap-0.5">
                      <span className="text-[10px] uppercase text-black/60 dark:text-white/50">{t('armor')}</span>
                      {[39, 38, 37, 36].map((s, i) => (
                        <Slot key={s} {...slotProps(s, ['helmet', 'chest', 'legs', 'boots'][i])} />
                      ))}
                    </div>
                    <div className="grid content-end gap-0.5">
                      <span className="text-[10px] uppercase text-black/60 dark:text-white/50">{t('offhand')}</span>
                      <Slot {...slotProps(40, 'offhand')} />
                    </div>
                  </div>
                  <span className="text-[10px] uppercase text-black/60 dark:text-white/50">{t('main')}</span>
                  <div className="grid grid-cols-9 gap-0.5">
                    {Array.from({ length: 27 }, (_, i) => (
                      <Slot key={i + 9} {...slotProps(i + 9)} />
                    ))}
                  </div>
                  <span className="text-[10px] uppercase text-black/60 dark:text-white/50">{t('hotbar')}</span>
                  <div className="grid grid-cols-9 gap-0.5">
                    {Array.from({ length: 9 }, (_, i) => (
                      <Slot key={i} {...slotProps(i)} />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="grid gap-3">
                  <span className="text-[10px] uppercase text-black/60 dark:text-white/50">{t('enderChest')}</span>
                  <div className="grid grid-cols-9 gap-0.5">
                    {Array.from({ length: 27 }, (_, i) => (
                      <Slot key={i} {...slotProps(i)} />
                    ))}
                  </div>
                </div>
              )}
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">{selected === null ? t('selectHint') : t('slot', { slot: selected })}</CardTitle>
              </CardHeader>
              <CardContent>
                {selected !== null && (
                  <ItemPanel
                    key={`${selected}-${draft.size}`}
                    item={current}
                    editable={editable}
                    onChange={(item) => update(selected, item)}
                  />
                )}
              </CardContent>
            </Card>
          </div>

          {editable && (
            <Card>
              <CardContent className="flex flex-wrap items-end gap-3 pt-5">
                <span className="text-sm font-medium">{t('changes', { count: changes.length })}</span>
                <div className="min-w-64 flex-1">
                  <Input aria-label={t('reason')} placeholder={t('reason')} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
                </div>
                <ConfirmDialog
                  trigger={
                    <Button variant="outline" size="sm">
                      <Trash2 aria-hidden /> {t('clearAll')}
                    </Button>
                  }
                  title={t('clearAll')}
                  description={t('changes', { count: [...items.keys()].length })}
                  confirmLabel={t('clearAll')}
                  destructive
                  onConfirm={() => setDraft(new Map(Array.from({ length: size }, (_, i) => [i, null] as [number, null])))}
                />
                <Button variant="outline" size="sm" disabled={!changes.length} onClick={() => setDraft(new Map())}>
                  {t('reset')}
                </Button>
                <Button size="sm" disabled={busy || !changes.length} onClick={() => void save()}>
                  {busy ? tc('saving') : t('save')}
                </Button>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>{t('history')}</CardTitle>
            </CardHeader>
            <CardContent>
              {view.revisions.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('noHistory')}</p>
              ) : (
                <ul className="grid gap-2">
                  {view.revisions.map((r) => (
                    <li key={r.id} className="rounded-lg border px-4 py-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={STATUS_VARIANT[r.status]}>{t(`status.${r.status}`)}</Badge>
                        {r.rollbackOfId && <Badge variant="outline">{t('rolledBackOf')}</Badge>}
                        <span className="font-medium">{r.actor?.username ?? tc('unknown')}</span>
                        <span className="text-xs text-muted-foreground">{format.dateTime(new Date(r.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}</span>
                        {canEdit && r.status === 'APPLIED' && !view.pending && (
                          <span className="ml-auto">
                            <ConfirmDialog
                              trigger={
                                <Button size="sm" variant="outline">
                                  <RotateCcw aria-hidden /> {t('rollback')}
                                </Button>
                              }
                              title={t('rollback')}
                              description={t('rollbackConfirm')}
                              confirmLabel={t('rollback')}
                              onConfirm={() => revisionAction(`/players/${uuid}/inventories/revisions/${r.id}/rollback`, t('saved'))}
                            />
                          </span>
                        )}
                      </div>
                      {r.reason && <p className="mt-1 text-muted-foreground">{r.reason}</p>}
                      {(r.status === 'CONFLICT' || r.status === 'REJECTED') && (
                        <p className="mt-1 text-xs text-gold">
                          {r.resultMessage} {r.status === 'CONFLICT' && `· ${t('conflictHint')}`}
                        </p>
                      )}
                      <ul className="mt-2 grid gap-0.5 font-mono text-xs text-muted-foreground">
                        {r.changes.map((c) => (
                          <li key={c.slot}>
                            #{c.slot}: {c.before ? `${c.before.amount}× ${prettyId(c.before.id)}` : '∅'} → {c.after ? `${c.after.amount}× ${prettyId(c.after.id)}` : '∅'}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

/** Inspect / edit one slot. */
function ItemPanel({ item, editable, onChange }: { item: DraftItem | null; editable: boolean; onChange: (item: DraftItem | null) => void }) {
  const t = useTranslations('inventory');
  const [id, setId] = useState(item?.id ?? '');
  const [newEnchant, setNewEnchant] = useState({ id: '', level: 1 });

  if (!item) {
    return editable ? (
      <div className="grid gap-3">
        <Field label={t('itemId')} htmlFor="new-item" error={id && !ITEM_ID.test(normalizeId(id)) ? t('invalidId') : null}>
          <Input id="new-item" placeholder="minecraft:diamond" value={id} onChange={(e) => setId(e.target.value)} maxLength={128} />
        </Field>
        <Button size="sm" className="w-fit" disabled={!id || !ITEM_ID.test(normalizeId(id))} onClick={() => onChange({ id: normalizeId(id), amount: 1, name: null, lore: [], enchantments: {} })}>
          <Plus aria-hidden /> {t('addItem')}
        </Button>
      </div>
    ) : (
      <p className="text-sm text-muted-foreground">{t('empty')}</p>
    );
  }

  const set = (patch: Partial<DraftItem>) => onChange({ ...item, ...patch });
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="font-medium">{prettyId(item.id)}</div>
          <div className="font-mono text-xs text-muted-foreground">{item.id}</div>
        </div>
        {editable && (
          <Button size="sm" variant="outline" onClick={() => onChange(null)}>
            <Trash2 aria-hidden /> {t('removeItem')}
          </Button>
        )}
      </div>
      {item.maxDamage ? (
        <p className="text-xs text-muted-foreground">
          {t('durability')}: {item.maxDamage - (item.damage ?? 0)} / {item.maxDamage}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('amount')} htmlFor="item-amount">
          <Input id="item-amount" type="number" min={1} max={99} disabled={!editable} value={item.amount} onChange={(e) => set({ amount: Math.min(99, Math.max(1, Number(e.target.value) || 1)) })} />
        </Field>
        <Field label={t('name')} htmlFor="item-name">
          <Input id="item-name" maxLength={100} disabled={!editable} value={item.name ?? ''} onChange={(e) => set({ name: e.target.value || null })} />
        </Field>
      </div>
      <Field label={t('lore')} htmlFor="item-lore">
        <Textarea id="item-lore" disabled={!editable} value={item.lore.join('\n')} onChange={(e) => set({ lore: e.target.value.split('\n').slice(0, 20).map((l) => l.slice(0, 200)) })} />
      </Field>
      <div className="grid gap-2">
        <span className="text-sm font-medium">{t('enchantments')}</span>
        {Object.entries(item.enchantments).map(([key, level]) => (
          <div key={key} className="flex items-center gap-2 text-sm">
            <span className="flex-1">{prettyId(key)}</span>
            <Input aria-label={`${prettyId(key)} ${t('level')}`} className="w-20" type="number" min={1} max={255} disabled={!editable} value={level} onChange={(e) => set({ enchantments: { ...item.enchantments, [key]: Math.min(255, Math.max(1, Number(e.target.value) || 1)) } })} />
            {editable && (
              <Button size="icon" variant="ghost" className="size-8" onClick={() => set({ enchantments: Object.fromEntries(Object.entries(item.enchantments).filter(([k]) => k !== key)) })}>
                <X aria-hidden />
                <span className="sr-only">{t('removeItem')}</span>
              </Button>
            )}
          </div>
        ))}
        {editable && (
          <div className="flex flex-wrap items-end gap-2">
            <Input aria-label={t('enchantmentId')} placeholder="minecraft:sharpness" className="min-w-40 flex-1" value={newEnchant.id} onChange={(e) => setNewEnchant({ ...newEnchant, id: e.target.value })} />
            <Input aria-label={t('level')} className="w-20" type="number" min={1} max={255} value={newEnchant.level} onChange={(e) => setNewEnchant({ ...newEnchant, level: Math.min(255, Math.max(1, Number(e.target.value) || 1)) })} />
            <Button
              size="sm"
              variant="outline"
              disabled={!ITEM_ID.test(normalizeId(newEnchant.id || 'x'))}
              onClick={() => {
                set({ enchantments: { ...item.enchantments, [normalizeId(newEnchant.id)]: newEnchant.level } });
                setNewEnchant({ id: '', level: 1 });
              }}
            >
              <Plus aria-hidden /> {t('addEnchantment')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
