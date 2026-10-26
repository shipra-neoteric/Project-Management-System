import { cn } from './cn';

/** Typography for stored rich text (editor and read-only view look the same). */
export const richTextCls = cn(
  'text-sm text-gray-800 dark:text-gray-200 leading-relaxed break-words',
  '[&_p]:my-1.5 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:mt-3 [&_h1]:mb-1.5 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1.5',
  '[&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_li>p]:my-0',
  '[&_blockquote]:border-l-4 [&_blockquote]:border-gray-200 dark:[&_blockquote]:border-gray-600 [&_blockquote]:pl-3 [&_blockquote]:text-gray-600 dark:[&_blockquote]:text-gray-400',
  '[&_code]:bg-gray-100 dark:[&_code]:bg-gray-700 [&_code]:rounded [&_code]:px-1 [&_code]:text-[0.85em] [&_pre]:bg-gray-100 dark:[&_pre]:bg-gray-900 [&_pre]:rounded-md [&_pre]:p-3 [&_pre]:overflow-x-auto [&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_a]:text-blue-600 dark:[&_a]:text-blue-400 [&_a]:underline [&_hr]:my-3 [&_hr]:border-gray-200 dark:[&_hr]:border-gray-700',
  '[&_table]:w-full [&_td]:border [&_td]:border-gray-200 dark:[&_td]:border-gray-700 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-gray-200 dark:[&_th]:border-gray-700 [&_th]:px-2 [&_th]:py-1',
);

const hasTags = (value: string) => /<\/?[a-z][\s\S]*>/i.test(value);
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Older notes are plain text: keep their line breaks when they are shown or edited as rich text. */
export function toRichHtml(value: string | null | undefined): string {
  const text = value ?? '';
  if (!text.trim()) return '';
  if (hasTags(text)) return text;
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/** True when rich text has no visible content. */
export const isRichTextEmpty = (value: string | null | undefined) => !(value ?? '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();

/** Plain-text excerpt for lists, tooltips and previews. */
export function richTextExcerpt(value: string | null | undefined, max = 160) {
  const raw = value ?? '';
  const text = (hasTags(raw) ? raw : raw.replace(/</g, '&lt;'))
    .replace(/<\/(p|h[1-4]|li|blockquote)>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
