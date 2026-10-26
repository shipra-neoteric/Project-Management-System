import sanitizeHtml from 'sanitize-html';

/** Tags the rich-text editor produces (TipTap StarterKit + task lists). Everything else is stripped. */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'code', 'pre',
    'blockquote', 'ul', 'ol', 'li', 'a', 'span', 'label', 'input', 'div', 'mark', 'sub', 'sup',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    ul: ['data-type'],
    li: ['data-type', 'data-checked'],
    input: ['type', 'checked', 'disabled'],
    ol: ['start'],
    th: ['colspan', 'rowspan'],
    td: ['colspan', 'rowspan'],
    code: ['class'],
  },
  allowedClasses: { code: [/^language-[\w-]+$/] },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowProtocolRelative: false,
  // Only checkboxes survive (task lists); any other input is dropped.
  exclusiveFilter: (frame) => frame.tag === 'input' && frame.attribs.type !== 'checkbox',
  transformTags: {
    a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer nofollow' } }),
    input: (tagName, attribs) => ({ tagName, attribs: { ...attribs, disabled: 'disabled' } }),
  },
};

const looksLikeHtml = (value: string) => /<\/?[a-z][\s\S]*>/i.test(value);
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Cleans rich text before it is stored. Plain text (older notes, API clients) is kept as plain text;
 * HTML is reduced to the editor's safe subset (no scripts, event handlers or javascript: links).
 */
export function sanitizeRichText(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (!looksLikeHtml(trimmed)) return trimmed;
  const clean = sanitizeHtml(trimmed, OPTIONS).trim();
  // An editor that was cleared leaves "<p></p>".
  return /^(<p>(\s|<br\s*\/?>)*<\/p>)*$/i.test(clean) ? '' : clean;
}

/** Plain-text version for emails, search and previews. */
export function richTextToPlain(value: string): string {
  if (!looksLikeHtml(value)) return value;
  return sanitizeHtml(value.replace(/<\/(p|h[1-4]|li|blockquote|pre|tr)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n'), { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** HTML for emails: rich text as-is (already sanitised), plain text escaped with line breaks. */
export function richTextToHtml(value: string): string {
  return looksLikeHtml(value) ? value : escape(value).replace(/\n/g, '<br>');
}
