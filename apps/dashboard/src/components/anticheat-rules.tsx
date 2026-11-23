'use client';

import { PERMISSIONS } from '@mnm/shared-types';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api, ApiError, errorKey } from '@/lib/api';
import { useAuth } from './auth-provider';
import { useToast } from './toaster';
import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Select, Skeleton } from './ui/primitives';
import { Switch } from './ui/switch';
import { TBody, TD, TH, THead, TR, Table } from './ui/table';

const ACTIONS = ['NONE', 'WARNING', 'KICK', 'TEMP_BAN', 'BAN'] as const;
type Action = (typeof ACTIONS)[number];

interface Rule {
  action: Action;
  durationSeconds: number | null;
  minViolationLevel: number;
  cooldownSeconds: number;
}
interface CheatRule extends Rule {
  cheatType: string;
  enabled: boolean;
}
interface Settings {
  enabled: boolean;
  collectEvidence: boolean;
  defaultRule: Rule;
  commandFallback: Rule;
  rules: CheatRule[];
  maxPunishmentsPerMinute: number;
}

const DAY = 86_400;

/** Keeps duration consistent with the action (required for TEMP_BAN, absent otherwise). */
function withAction<T extends Rule>(rule: T, action: Action): T {
  return { ...rule, action, durationSeconds: action === 'TEMP_BAN' ? (rule.durationSeconds ?? 7 * DAY) : null };
}

function RuleFields({ rule, onChange, disabled, id }: { rule: Rule; onChange: (r: Rule) => void; disabled: boolean; id: string }) {
  const t = useTranslations('anticheat');
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={t('action')} htmlFor={`${id}-action`}>
        <Select id={`${id}-action`} value={rule.action} disabled={disabled} onChange={(e) => onChange(withAction(rule, e.target.value as Action))}>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {t(`actions.${a}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('durationDays')} htmlFor={`${id}-duration`}>
        <Input
          id={`${id}-duration`}
          type="number"
          min={1}
          max={3650}
          disabled={disabled || rule.action !== 'TEMP_BAN'}
          value={rule.durationSeconds === null ? '' : Math.round(rule.durationSeconds / DAY)}
          onChange={(e) => onChange({ ...rule, durationSeconds: Math.max(1, Number(e.target.value)) * DAY })}
        />
      </Field>
      <Field label={t('minVl')} htmlFor={`${id}-vl`}>
        <Input id={`${id}-vl`} type="number" min={0} step="any" disabled={disabled} value={rule.minViolationLevel} onChange={(e) => onChange({ ...rule, minViolationLevel: Math.max(0, Number(e.target.value)) })} />
      </Field>
      <Field label={t('cooldown')} htmlFor={`${id}-cd`}>
        <Input id={`${id}-cd`} type="number" min={0} disabled={disabled} value={rule.cooldownSeconds} onChange={(e) => onChange({ ...rule, cooldownSeconds: Math.max(0, Math.round(Number(e.target.value))) })} />
      </Field>
    </div>
  );
}

export function AntiCheatRules() {
  const t = useTranslations('anticheat');
  const tc = useTranslations('common');
  const te = useTranslations('errors');
  const toast = useToast();
  const { can } = useAuth();
  const canManage = can(PERMISSIONS.ANTICHEAT_MANAGE);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [examples, setExamples] = useState<CheatRule[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ settings: Settings; examples: CheatRule[] }>('/anticheat/settings').then((r) => {
      setSettings(r.settings);
      setExamples(r.examples);
    });
  }, []);

  if (!settings) return <Skeleton className="h-64" />;
  const update = (patch: Partial<Settings>) => setSettings({ ...settings, ...patch });
  const updateRule = (i: number, rule: CheatRule) => update({ rules: settings.rules.map((r, j) => (j === i ? rule : r)) });

  async function save() {
    setBusy(true);
    setError(null);
    try {
      setSettings(await api<Settings>('/anticheat/settings', { method: 'PUT', body: settings }));
      toast(t('saved'));
    } catch (err) {
      setError(err instanceof ApiError && err.issues?.length ? err.issues.map((i) => `${i.path}: ${i.message}`).join(' · ') : te(errorKey(err)));
    } finally {
      setBusy(false);
    }
  }

  const existing = new Set(settings.rules.map((r) => r.cheatType.toLowerCase()));

  return (
    <div className="grid min-w-0 gap-6 [&>*]:min-w-0">
      {!canManage && <Alert>{t('readOnly')}</Alert>}
      {error && <Alert variant="destructive">{error}</Alert>}

      <Card>
        <CardContent className="grid gap-4 pt-5">
          <label className="flex items-start justify-between gap-4">
            <span>
              <span className="block font-medium">{t('enabled')}</span>
              <span className="text-sm text-muted-foreground">{t('enabledHint')}</span>
            </span>
            <Switch checked={settings.enabled} disabled={!canManage} onCheckedChange={(v) => update({ enabled: v })} />
          </label>
          <label className="flex items-start justify-between gap-4">
            <span>
              <span className="block font-medium">{t('collectEvidence')}</span>
              <span className="text-sm text-muted-foreground">{t('collectEvidenceHint')}</span>
            </span>
            <Switch checked={settings.collectEvidence} disabled={!canManage} onCheckedChange={(v) => update({ collectEvidence: v })} />
          </label>
          <Field label={t('maxPerMinute')} htmlFor="ac-max">
            <Input id="ac-max" className="max-w-32" type="number" min={1} max={1000} disabled={!canManage} value={settings.maxPunishmentsPerMinute} onChange={(e) => update({ maxPunishmentsPerMinute: Math.min(1000, Math.max(1, Number(e.target.value))) })} />
          </Field>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('defaultRule')}</CardTitle>
            <CardDescription>{t('defaultRuleHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            <RuleFields id="ac-default" rule={settings.defaultRule} disabled={!canManage} onChange={(r) => update({ defaultRule: r })} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('commandFallback')}</CardTitle>
            <CardDescription>{t('commandFallbackHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            <RuleFields id="ac-fallback" rule={settings.commandFallback} disabled={!canManage} onChange={(r) => update({ commandFallback: r })} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{t('rules')}</CardTitle>
            <CardDescription>{t('rulesHint')}</CardDescription>
            {canManage && <CardDescription className="mt-1 text-xs">{t('examplesHint')}</CardDescription>}
          </div>
          {canManage && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => update({ rules: [...settings.rules, ...examples.filter((e) => !existing.has(e.cheatType.toLowerCase()))] })}
              >
                {t('loadExamples')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => update({ rules: [...settings.rules, { cheatType: '', action: 'KICK', durationSeconds: null, minViolationLevel: 0, cooldownSeconds: 300, enabled: true }] })}
              >
                <Plus aria-hidden /> {t('addRule')}
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="px-0">
          {settings.rules.length === 0 ? (
            <p className="px-5 text-sm text-muted-foreground">{t('noRules')}</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>{t('cheatType')}</TH>
                  <TH>{t('action')}</TH>
                  <TH>{t('durationDays')}</TH>
                  <TH>{t('minVl')}</TH>
                  <TH>{t('cooldown')}</TH>
                  <TH>{t('ruleEnabled')}</TH>
                  <TH>
                    <span className="sr-only">{tc('actions')}</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {settings.rules.map((rule, i) => (
                  <TR key={i}>
                    <TD className="min-w-36">
                      <Input aria-label={t('cheatType')} value={rule.cheatType} maxLength={64} disabled={!canManage} onChange={(e) => updateRule(i, { ...rule, cheatType: e.target.value })} />
                    </TD>
                    <TD className="min-w-44">
                      <Select aria-label={t('action')} value={rule.action} disabled={!canManage} onChange={(e) => updateRule(i, withAction(rule, e.target.value as Action))}>
                        {ACTIONS.map((a) => (
                          <option key={a} value={a}>
                            {t(`actions.${a}`)}
                          </option>
                        ))}
                      </Select>
                    </TD>
                    <TD className="w-28">
                      <Input
                        aria-label={t('durationDays')}
                        type="number"
                        min={1}
                        disabled={!canManage || rule.action !== 'TEMP_BAN'}
                        value={rule.durationSeconds === null ? '' : Math.round(rule.durationSeconds / DAY)}
                        onChange={(e) => updateRule(i, { ...rule, durationSeconds: Math.max(1, Number(e.target.value)) * DAY })}
                      />
                    </TD>
                    <TD className="min-w-24">
                      <Input aria-label={t('minVl')} type="number" min={0} step="any" disabled={!canManage} value={rule.minViolationLevel} onChange={(e) => updateRule(i, { ...rule, minViolationLevel: Math.max(0, Number(e.target.value)) })} />
                    </TD>
                    <TD className="w-28">
                      <Input aria-label={t('cooldown')} type="number" min={0} disabled={!canManage} value={rule.cooldownSeconds} onChange={(e) => updateRule(i, { ...rule, cooldownSeconds: Math.max(0, Math.round(Number(e.target.value))) })} />
                    </TD>
                    <TD>
                      <Switch aria-label={t('ruleEnabled')} checked={rule.enabled} disabled={!canManage} onCheckedChange={(v) => updateRule(i, { ...rule, enabled: v })} />
                    </TD>
                    <TD>
                      {canManage && (
                        <Button variant="ghost" size="icon" title={tc('delete')} onClick={() => update({ rules: settings.rules.filter((_, j) => j !== i) })}>
                          <Trash2 aria-hidden />
                          <span className="sr-only">{tc('delete')}</span>
                        </Button>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {canManage && (
        <div className="flex justify-end">
          <Button onClick={() => void save()} disabled={busy || settings.rules.some((r) => !r.cheatType.trim())}>
            {busy ? tc('saving') : tc('save')}
          </Button>
        </div>
      )}
    </div>
  );
}
