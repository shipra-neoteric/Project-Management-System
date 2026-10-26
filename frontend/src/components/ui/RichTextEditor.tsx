'use client';

import { Placeholder } from '@tiptap/extensions';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import DOMPurify from 'dompurify';
import {
  Bold,
  Code,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Strikethrough,
  Underline as UnderlineIcon,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/cn';
import { isRichTextEmpty, richTextCls, richTextExcerpt, toRichHtml } from '@/lib/richText';

export { isRichTextEmpty, richTextCls, richTextExcerpt, toRichHtml };

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  /** Called when the editor loses focus (e.g. to save). */
  onBlur?: (html: string) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  /** Minimum editing height (Tailwind class). */
  minHeight?: string;
}

const editorHtml = (editor: Editor) => (editor.isEmpty ? '' : editor.getHTML());

/** Rich-text editor (TipTap) with a formatting toolbar. Stores sanitised HTML; the API sanitises again. */
export function RichTextEditor({ value, onChange, onBlur, placeholder = 'Write something…', disabled, id, className, minHeight = 'min-h-28' }: RichTextEditorProps) {
  const editor = useEditor({
    immediatelyRender: false, // Next.js renders on the server first
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true, protocols: ['http', 'https', 'mailto', 'tel'], HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } },
      }),
      Placeholder.configure({ placeholder }),
    ],
    content: toRichHtml(value),
    editorProps: {
      attributes: {
        ...(id ? { id } : {}),
        class: cn(richTextCls, minHeight, 'px-3 py-2 focus:outline-none'),
        'aria-label': placeholder,
        role: 'textbox',
        'aria-multiline': 'true',
      },
    },
    onUpdate: ({ editor: e }) => onChange(editorHtml(e)),
    onBlur: ({ editor: e }) => onBlur?.(editorHtml(e)),
  });

  // Follow outside changes (another task opened, form reset) while the user is not typing.
  useEffect(() => {
    if (!editor || editor.isFocused) return;
    const next = toRichHtml(value);
    if (next !== editorHtml(editor)) editor.commands.setContent(next, { emitUpdate: false });
  }, [editor, value]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  return (
    <div
      className={cn(
        'rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 transition-all duration-200',
        'focus-within:ring-2 focus-within:ring-blue-500/50',
        disabled && 'opacity-60',
        '[&_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)] [&_p.is-editor-empty:first-child]:before:text-gray-400 dark:[&_p.is-editor-empty:first-child]:before:text-gray-500 [&_p.is-editor-empty:first-child]:before:float-left [&_p.is-editor-empty:first-child]:before:h-0 [&_p.is-editor-empty:first-child]:before:pointer-events-none',
        className,
      )}
    >
      {!disabled && editor && <Toolbar editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      quote: e.isActive('blockquote'),
      code: e.isActive('codeBlock'),
      link: e.isActive('link'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });

  const setLink = async () => {
    const previous = (editor.getAttributes('link').href as string | undefined) ?? '';
    const Swal = (await import('sweetalert2')).default;
    const result = await Swal.fire({
      title: 'Link',
      input: 'url',
      inputValue: previous,
      inputPlaceholder: 'https://…',
      showCancelButton: true,
      showDenyButton: !!previous,
      denyButtonText: 'Remove link',
      confirmButtonText: 'Apply',
      reverseButtons: true,
    });
    if (result.isDenied) return void editor.chain().focus().extendMarkRange('link').unsetLink().run();
    if (!result.isConfirmed) return;
    const href = String(result.value ?? '').trim();
    if (!href) return void editor.chain().focus().extendMarkRange('link').unsetLink().run();
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
  };

  const buttons: ({ icon: LucideIcon; label: string; active?: boolean; disabled?: boolean; run: () => void } | 'sep')[] = [
    { icon: Bold, label: 'Bold (Ctrl+B)', active: state.bold, run: () => editor.chain().focus().toggleBold().run() },
    { icon: Italic, label: 'Italic (Ctrl+I)', active: state.italic, run: () => editor.chain().focus().toggleItalic().run() },
    { icon: UnderlineIcon, label: 'Underline (Ctrl+U)', active: state.underline, run: () => editor.chain().focus().toggleUnderline().run() },
    { icon: Strikethrough, label: 'Strikethrough', active: state.strike, run: () => editor.chain().focus().toggleStrike().run() },
    'sep',
    { icon: Heading2, label: 'Heading', active: state.h2, run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { icon: Heading3, label: 'Subheading', active: state.h3, run: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
    { icon: List, label: 'Bulleted list', active: state.bullet, run: () => editor.chain().focus().toggleBulletList().run() },
    { icon: ListOrdered, label: 'Numbered list', active: state.ordered, run: () => editor.chain().focus().toggleOrderedList().run() },
    { icon: Quote, label: 'Quote', active: state.quote, run: () => editor.chain().focus().toggleBlockquote().run() },
    { icon: Code, label: 'Code block', active: state.code, run: () => editor.chain().focus().toggleCodeBlock().run() },
    { icon: Link2, label: 'Link', active: state.link, run: () => void setLink() },
    'sep',
    { icon: Undo2, label: 'Undo (Ctrl+Z)', disabled: !state.canUndo, run: () => editor.chain().focus().undo().run() },
    { icon: Redo2, label: 'Redo (Ctrl+Shift+Z)', disabled: !state.canRedo, run: () => editor.chain().focus().redo().run() },
  ];

  return (
    <div className="flex flex-wrap items-center gap-0.5 px-1.5 py-1 border-b border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/60 rounded-t-md" role="toolbar" aria-label="Formatting">
      {buttons.map((b, i) =>
        b === 'sep' ? (
          <span key={i} className="w-px h-5 bg-gray-200 dark:bg-gray-600 mx-1" aria-hidden />
        ) : (
          <button
            key={b.label}
            type="button"
            title={b.label}
            aria-label={b.label}
            aria-pressed={b.active}
            disabled={b.disabled}
            // Keep the selection in the editor while clicking.
            onMouseDown={(e) => e.preventDefault()}
            onClick={b.run}
            className={cn(
              'p-1.5 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed',
              b.active
                ? 'bg-gray-200 dark:bg-gray-600 text-gray-900 dark:text-white'
                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-200/70 dark:hover:bg-gray-700 hover:text-gray-800 dark:hover:text-gray-200',
            )}
          >
            <b.icon className="w-4 h-4" />
          </button>
        ),
      )}
    </div>
  );
}

/** Read-only rich text, sanitised again in the browser. Plain-text values keep their line breaks. */
export function RichTextView({ value, className, empty }: { value: string | null | undefined; className?: string; empty?: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const html = useMemo(
    () => (mounted ? DOMPurify.sanitize(toRichHtml(value), { ADD_ATTR: ['target'], FORBID_TAGS: ['style', 'img', 'iframe', 'form'] }) : ''),
    [mounted, value],
  );
  if (isRichTextEmpty(value)) return <>{empty ?? null}</>;
  // Before hydration, show the plain text so nothing jumps.
  if (!mounted) return <div className={cn(richTextCls, 'whitespace-pre-wrap', className)}>{richTextExcerpt(value, 100_000)}</div>;
  return <div className={cn(richTextCls, className)} dangerouslySetInnerHTML={{ __html: html }} />;
}
