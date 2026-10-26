'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Download, KeyRound, ShieldCheck, ShieldOff, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { Alert, PageLoader } from '@/components/ui/Feedback';
import { Field, inputCls } from '@/components/ui/Field';
import { Card } from '@/components/ui/Layout';
import { toastError, toastSuccess } from '@/lib/alerts';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { User } from '@/lib/types';

interface Status {
  enabled: boolean;
  backupCodesLeft: number;
  required: boolean;
  sso: boolean;
}

const KEY = ['2fa'] as const;

/** Profile card: turn TOTP two-factor authentication on/off and manage backup codes. */
export function TwoFactorCard() {
  const qc = useQueryClient();
  const { setUser } = useAuth();
  const status = useQuery({ queryKey: KEY, queryFn: () => api<Status>('/auth/2fa') });
  const [setupOpen, setSetupOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);

  const regenerate = useMutation({
    mutationFn: (code: string) => api<{ backupCodes: string[] }>('/auth/2fa/backup-codes', { method: 'POST', body: { code } }),
    onSuccess: (data) => {
      setCodes(data.backupCodes);
      void qc.invalidateQueries({ queryKey: KEY });
    },
  });

  const askAndRegenerate = async () => {
    const Swal = (await import('sweetalert2')).default;
    const { value } = await Swal.fire({
      title: 'New backup codes',
      text: 'Enter a current code from your authenticator app. Your old backup codes will stop working.',
      input: 'text',
      inputAttributes: { inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6' },
      showCancelButton: true,
      confirmButtonText: 'Create codes',
      reverseButtons: true,
    });
    if (!value) return;
    regenerate.mutate(String(value), { onError: (err) => void toastError(errorMessage(err)) });
  };

  const s = status.data;
  return (
    <Card
      title="Two-factor authentication"
      icon={ShieldCheck}
      actions={s && <Badge tone={s.enabled ? 'success' : s.required ? 'warning' : 'neutral'} dot>{s.enabled ? 'On' : s.required ? 'Required' : 'Off'}</Badge>}
    >
      <div className="p-5 space-y-4">
        {status.isLoading || !s ? (
          <PageLoader />
        ) : s.sso && !s.enabled ? (
          <p className="text-sm text-gray-600 dark:text-gray-300">You sign in with single sign-on, so your organisation’s sign-in provider protects your account.</p>
        ) : s.enabled ? (
          <>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Signing in with your password also asks for a code from your authenticator app. You have{' '}
              <strong className="text-gray-900 dark:text-white">{s.backupCodesLeft}</strong> unused backup code{s.backupCodesLeft === 1 ? '' : 's'}.
            </p>
            {s.backupCodesLeft <= 3 && <Alert tone="warning">You are running out of backup codes. Create new ones.</Alert>}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" icon={KeyRound} onClick={askAndRegenerate} loading={regenerate.isPending}>
                New backup codes
              </Button>
              {!s.required && (
                <Button size="sm" variant="danger" icon={ShieldOff} onClick={() => setDisableOpen(true)}>
                  Turn off
                </Button>
              )}
            </div>
          </>
        ) : (
          <>
            {s.required && <Alert tone="warning">Your organisation requires two-factor authentication. Please set it up now.</Alert>}
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Protect your account with a second step at sign-in: a 6-digit code from an app such as Microsoft Authenticator, Google Authenticator or 1Password.
            </p>
            <Button variant="primary" icon={Smartphone} onClick={() => setSetupOpen(true)}>
              Set up two-factor authentication
            </Button>
          </>
        )}
      </div>

      <SetupDrawer
        open={setupOpen}
        onClose={() => setSetupOpen(false)}
        onEnabled={(backupCodes, user) => {
          setSetupOpen(false);
          setCodes(backupCodes);
          setUser(user);
          void qc.invalidateQueries({ queryKey: KEY });
        }}
      />
      <DisableDrawer
        open={disableOpen}
        onClose={() => setDisableOpen(false)}
        onDisabled={(user) => {
          setDisableOpen(false);
          setUser(user);
          void qc.invalidateQueries({ queryKey: KEY });
        }}
      />
      <BackupCodesDrawer codes={codes} onClose={() => setCodes(null)} />
    </Card>
  );
}

function SetupDrawer({ open, onClose, onEnabled }: { open: boolean; onClose: () => void; onEnabled: (codes: string[], user: User) => void }) {
  const [code, setCode] = useState('');
  const setup = useQuery({
    queryKey: ['2fa-setup', open],
    queryFn: () => api<{ secret: string; otpauthUrl: string; qr: string }>('/auth/2fa/setup', { method: 'POST' }),
    enabled: open,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
  const enable = useMutation({
    mutationFn: () => api<{ backupCodes: string[]; user: User }>('/auth/2fa/enable', { method: 'POST', body: { code } }),
    onSuccess: (data) => {
      setCode('');
      void toastSuccess('Two-factor authentication is on');
      onEnabled(data.backupCodes, data.user);
    },
  });

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Set up two-factor authentication"
      subtitle="Scan the code with your authenticator app"
      icon={Smartphone}
      width="md"
      footer={
        <>
          <Button inDrawer onClick={onClose}>
            Cancel
          </Button>
          <Button inDrawer variant="primary" icon={ShieldCheck} disabled={!/^\d{6}$/.test(code)} loading={enable.isPending} onClick={() => enable.mutate()}>
            Turn on
          </Button>
        </>
      }
    >
      {setup.isLoading ? (
        <PageLoader />
      ) : setup.error ? (
        <Alert>{errorMessage(setup.error)}</Alert>
      ) : setup.data ? (
        <div className="space-y-5">
          <ol className="text-sm text-gray-600 dark:text-gray-300 list-decimal pl-5 space-y-1">
            <li>Open your authenticator app and add an account.</li>
            <li>Scan this QR code (or type the key below).</li>
            <li>Enter the 6-digit code the app shows.</li>
          </ol>
          <div className="flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.data.qr} alt="QR code for your authenticator app" width={220} height={220} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white p-2" />
          </div>
          <Field label="Setup key" hint="Use this if you cannot scan the code">
            <div className="flex gap-2">
              <input readOnly className={`${inputCls} font-mono text-xs`} value={setup.data.secret} aria-label="Setup key" />
              <Button
                inDrawer
                icon={Copy}
                onClick={() => void navigator.clipboard.writeText(setup.data!.secret).then(() => toastSuccess('Key copied'))}
                aria-label="Copy key"
              />
            </div>
          </Field>
          {enable.error && <Alert>{errorMessage(enable.error)}</Alert>}
          <Field label="Code from the app" htmlFor="tfa-code" required>
            <input
              id="tfa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className={`${inputCls} tracking-[0.3em] text-center font-mono text-base`}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
          </Field>
        </div>
      ) : null}
    </Drawer>
  );
}

function DisableDrawer({ open, onClose, onDisabled }: { open: boolean; onClose: () => void; onDisabled: (user: User) => void }) {
  const { user } = useAuth();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const disable = useMutation({
    mutationFn: () => api<{ user: User }>('/auth/2fa/disable', { method: 'POST', body: { password, code } }),
    onSuccess: (data) => {
      setPassword('');
      setCode('');
      void toastSuccess('Two-factor authentication is off');
      onDisabled(data.user);
    },
  });
  const needsPassword = !user?.sso;
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Turn off two-factor authentication"
      subtitle="Your account will be protected by your password only"
      icon={ShieldOff}
      width="md"
      footer={
        <>
          <Button inDrawer onClick={onClose}>
            Cancel
          </Button>
          <Button inDrawer variant="danger" icon={ShieldOff} disabled={code.trim().length < 6 || (needsPassword && !password)} loading={disable.isPending} onClick={() => disable.mutate()}>
            Turn off
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {disable.error && <Alert>{errorMessage(disable.error)}</Alert>}
        {needsPassword && (
          <Field label="Password" htmlFor="tfa-pw" required>
            <input id="tfa-pw" type="password" autoComplete="current-password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        )}
        <Field label="Code from your app or a backup code" htmlFor="tfa-off" required>
          <input id="tfa-off" autoComplete="one-time-code" className={`${inputCls} font-mono`} value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>
      </div>
    </Drawer>
  );
}

function BackupCodesDrawer({ codes, onClose }: { codes: string[] | null; onClose: () => void }) {
  const text = (codes ?? []).join('\n');
  const download = () => {
    const url = URL.createObjectURL(new Blob([`Project Management System backup codes\nEach code works once.\n\n${text}\n`], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pms-backup-codes.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <Drawer
      open={!!codes}
      onClose={onClose}
      title="Your backup codes"
      subtitle="Shown only once — save them somewhere safe"
      icon={KeyRound}
      width="md"
      footer={
        <>
          <Button inDrawer icon={Copy} onClick={() => void navigator.clipboard.writeText(text).then(() => toastSuccess('Codes copied'))}>
            Copy
          </Button>
          <Button inDrawer icon={Download} onClick={download}>
            Download
          </Button>
          <Button inDrawer variant="primary" onClick={onClose}>
            I saved them
          </Button>
        </>
      }
    >
      <Alert tone="warning">Use a backup code if you lose your phone. Each code can be used once. You will not see these codes again.</Alert>
      <ul className="mt-4 grid grid-cols-2 gap-2">
        {(codes ?? []).map((c) => (
          <li key={c} className="font-mono text-sm text-center py-2 rounded-md bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100">
            {c}
          </li>
        ))}
      </ul>
    </Drawer>
  );
}
