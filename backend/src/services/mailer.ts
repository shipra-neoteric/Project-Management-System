import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** e.g. a meeting invitation (.ics). */
  attachments?: { filename: string; content: string; contentType: string }[];
}

/** Messages "sent" while SMTP is not configured (used by tests and local development). */
export const outbox: MailMessage[] = [];

let transporter: Transporter | null = null;
function getTransporter(): Transporter | null {
  if (!env.smtpConfigured) return null;
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return transporter;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Simple branded email layout. `lines` are plain text paragraphs; `action` renders a button. */
export function renderEmail(title: string, lines: string[], action?: { label: string; url: string }) {
  const text = [title, '', ...lines, ...(action ? ['', `${action.label}: ${action.url}`] : [])].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#f9fafb;font-family:Inter,Arial,sans-serif;color:#111827">
<div style="max-width:560px;margin:24px auto;background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.08);overflow:hidden">
<div style="background:#1a365d;color:#fff;padding:14px 24px;font-weight:600">Project Management System</div>
<div style="padding:24px"><h1 style="font-size:18px;font-weight:600;margin:0 0 12px">${escapeHtml(title)}</h1>
${lines.map((l) => `<p style="font-size:14px;line-height:1.6;margin:0 0 10px;color:#374151;white-space:pre-wrap">${escapeHtml(l)}</p>`).join('')}
${action ? `<p style="margin:20px 0 0"><a href="${escapeHtml(action.url)}" style="display:inline-block;background:#f97316;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600">${escapeHtml(action.label)}</a></p>` : ''}
</div><div style="padding:12px 24px;font-size:12px;color:#9ca3af;border-top:1px solid #f3f4f6">You can turn off email notifications in your profile.</div></div></body></html>`;
  return { text, html };
}

/** Sends an email without ever throwing — a mail failure must not fail the user's action. */
export async function sendMail(message: MailMessage): Promise<void> {
  const t = getTransporter();
  if (!t) {
    outbox.push(message);
    if (outbox.length > 200) outbox.shift();
    if (env.NODE_ENV !== 'test') console.log(`[mail:not-sent] to=${message.to} subject="${message.subject}"\n${message.text}\n`);
    return;
  }
  try {
    await t.sendMail({ from: env.MAIL_FROM, ...message });
  } catch (err) {
    console.error(`[mail] failed to send "${message.subject}" to ${message.to}:`, err instanceof Error ? err.message : err);
  }
}
