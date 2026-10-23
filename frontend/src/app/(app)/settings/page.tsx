'use client';

import { Palette, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { PageLoader } from '@/components/ui/Feedback';
import { Field, inputCls } from '@/components/ui/Field';
import { Card, Page, PageHeader } from '@/components/ui/Layout';
import { AdminGate } from '@/features/AdminGate';
import { useOrgSettings, useUpdateOrgSettings } from '@/features/queries';
import { toastError, toastSuccess } from '@/lib/alerts';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { DEFAULT_THEME_COLOR, useTheme } from '@/lib/theme';

const PRESETS = ['#f97316', '#ef4444', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#1a365d'];

export default function OrgSettingsPage() {
  return (
    <AdminGate>
      <OrgSettingsContent />
    </AdminGate>
  );
}

function OrgSettingsContent() {
  const settings = useOrgSettings();
  const save = useUpdateOrgSettings();
  const { setThemeColor } = useTheme();
  const [orgName, setOrgName] = useState('');
  const [color, setColor] = useState(DEFAULT_THEME_COLOR);

  useEffect(() => {
    if (settings.data) {
      setOrgName(settings.data.orgName);
      setColor(settings.data.themeColor);
    }
  }, [settings.data]);

  if (settings.isLoading) return <PageLoader />;

  const valid = /^#[0-9a-fA-F]{6}$/.test(color) && orgName.trim().length > 0;

  const onSave = async () => {
    try {
      const data = await save.mutateAsync({ orgName: orgName.trim(), themeColor: color });
      setThemeColor(data.themeColor);
      void toastSuccess('Organisation settings saved');
    } catch (err) {
      void toastError(errorMessage(err));
    }
  };

  return (
    <Page>
      <PageHeader
        title="Organisation"
        subtitle="Branding shown to everyone in the app"
        actions={
          <Button variant="primary" icon={Save} loading={save.isPending} disabled={!valid} onClick={onSave}>
            Save
          </Button>
        }
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <Card title="Branding" icon={Palette}>
          <div className="p-5 space-y-5">
            <Field label="Organisation name" htmlFor="org-name" required>
              <input id="org-name" className={inputCls} value={orgName} onChange={(e) => setOrgName(e.target.value)} maxLength={80} />
            </Field>
            <Field label="Theme color" htmlFor="org-color" hint="Used for buttons, active navigation, Gantt bars and highlights">
              <div className="flex items-center gap-3">
                <input id="org-color" type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-12 h-10 rounded-md border border-gray-300 dark:border-gray-600 cursor-pointer bg-transparent" />
                <input className={cn(inputCls, 'w-32 font-mono')} value={color} onChange={(e) => setColor(e.target.value)} aria-label="Hex color" />
              </div>
            </Field>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setColor(p)}
                  className={cn('w-8 h-8 rounded-full border-2 transition-transform hover:scale-110', p === color ? 'border-gray-900 dark:border-white' : 'border-transparent')}
                  style={{ backgroundColor: p }}
                  title={p}
                  aria-label={`Use color ${p}`}
                />
              ))}
            </div>
          </div>
        </Card>
        <Card title="Preview">
          <div className="p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg text-white font-bold text-sm flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${color}, ${color}cc)` }}>
                {orgName.slice(0, 2).toUpperCase()}
              </div>
              <span className="text-sm font-semibold text-gray-900 dark:text-white">{orgName}</span>
            </div>
            <button type="button" className="px-4 py-2 rounded-lg text-sm font-medium text-white" style={{ backgroundColor: color }}>
              Primary button
            </button>
            <div className="h-5 rounded relative overflow-hidden" style={{ backgroundColor: `${color}59` }}>
              <div className="absolute inset-y-0 left-0 w-3/5 rounded" style={{ backgroundColor: color }} />
            </div>
            <p className="text-xs text-gray-400">Gantt bar at 60% complete</p>
          </div>
        </Card>
      </div>
    </Page>
  );
}
