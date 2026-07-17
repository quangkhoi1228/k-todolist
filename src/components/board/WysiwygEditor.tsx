"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import Placeholder from "@tiptap/extension-placeholder";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Code2,
  Minus,
  Undo2,
  Redo2,
  Palette,
} from "lucide-react";

interface WysiwygEditorProps {
  content: string;
  onChange: (md: string) => void;
  placeholder?: string;
}

function ToolbarButton({
  onClick,
  active,
  children,
  title,
}: {
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`p-1 rounded-md transition-colors cursor-pointer ${
        active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function serializeSelectionToMarkdown(editor: Editor): string {
  const { from, to } = editor.state.selection;
  if (from === to) {
    return editor.getMarkdown();
  }
  const slice = editor.state.doc.slice(from, to);
  const json = slice.toJSON();
  return editor.storage.markdown.manager.serialize(json);
}

export function WysiwygEditor({ content, onChange, placeholder }: WysiwygEditorProps) {
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const colorPickerRef = useRef<HTMLDivElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Markdown,
      TextStyle,
      Color.configure({
        types: ['textStyle'],
      }),
      Placeholder.configure({
        placeholder: placeholder || "Bắt đầu viết...",
      }),
    ],
    content,
    contentType: "markdown",
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      const md = editor.getMarkdown();
      onChange(md);
    },
  });

  // Intercept copy to put Markdown on clipboard
  const handleCopyRef = useRef((e: ClipboardEvent) => {
    if (!editor) return;
    e.preventDefault();
    // Put markdown as text/plain
    const md = serializeSelectionToMarkdown(editor);
    e.clipboardData?.setData('text/plain', md);
    // Also include HTML so pasting into rich editors works
    const html = editor.getHTML();
    e.clipboardData?.setData('text/html', html);
  });

  useEffect(() => {
    const el = editor?.view?.dom;
    if (!el) return;
    const handler = (e: ClipboardEvent) => handleCopyRef.current(e);
    el.addEventListener('copy', handler);
    return () => el.removeEventListener('copy', handler);
  }, [editor]);

  // Intercept cut (copy + delete)
  const handleCutRef = useRef((e: ClipboardEvent) => {
    if (!editor) return;
    e.preventDefault();
    const md = serializeSelectionToMarkdown(editor);
    e.clipboardData?.setData('text/plain', md);
    const html = editor.getHTML();
    e.clipboardData?.setData('text/html', html);
    editor.chain().focus().deleteSelection().run();
  });

  useEffect(() => {
    const el = editor?.view?.dom;
    if (!el) return;
    const handler = (e: ClipboardEvent) => handleCutRef.current(e);
    el.addEventListener('cut', handler);
    return () => el.removeEventListener('cut', handler);
  }, [editor]);

  // Close color picker on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) {
        setColorPickerOpen(false);
      }
    };
    if (colorPickerOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [colorPickerOpen]);

  // Sync content prop to editor when it changes (e.g. after data loads)
  useEffect(() => {
    if (!editor) return;
    const currentMd = editor.getMarkdown();
    if (currentMd !== content) {
      editor.commands.setContent(content, { emitUpdate: false });
    }
  }, [editor, content]);

  if (!editor) return null;

  return (
    <div className="wysiwyg-editor">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 p-1.5 border-b border-border/40 flex-wrap bg-muted/20 rounded-t-lg">
        <div className="flex items-center gap-0.5 mr-1">
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBold().run()}
            active={editor.isActive("bold")}
            title="Bold"
          >
            <Bold className="w-3.5 h-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleItalic().run()}
            active={editor.isActive("italic")}
            title="Italic"
          >
            <Italic className="w-3.5 h-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleStrike().run()}
            active={editor.isActive("strike")}
            title="Strikethrough"
          >
            <Strikethrough className="w-3.5 h-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleCode().run()}
            active={editor.isActive("code")}
            title="Inline code"
          >
            <Code className="w-3.5 h-3.5" />
          </ToolbarButton>
        </div>

        <div className="w-px h-5 bg-border/50 mx-0.5" />

        <div className="flex items-center gap-0.5 mr-1">
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            active={editor.isActive("heading", { level: 1 })}
            title="Heading 1"
          >
            <Heading1 className="w-3.5 h-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            active={editor.isActive("heading", { level: 2 })}
            title="Heading 2"
          >
            <Heading2 className="w-3.5 h-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            active={editor.isActive("heading", { level: 3 })}
            title="Heading 3"
          >
            <Heading3 className="w-3.5 h-3.5" />
          </ToolbarButton>
        </div>

        <div className="w-px h-5 bg-border/50 mx-0.5" />

        <div className="flex items-center gap-0.5 mr-1">
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            active={editor.isActive("bulletList")}
            title="Bullet list"
          >
            <List className="w-3.5 h-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            active={editor.isActive("orderedList")}
            title="Ordered list"
          >
            <ListOrdered className="w-3.5 h-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            active={editor.isActive("blockquote")}
            title="Blockquote"
          >
            <Quote className="w-3.5 h-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            active={editor.isActive("codeBlock")}
            title="Code block"
          >
            <Code2 className="w-3.5 h-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            title="Horizontal rule"
          >
            <Minus className="w-3.5 h-3.5" />
          </ToolbarButton>
        </div>

        <div className="w-px h-5 bg-border/50 mx-0.5" />

        <div ref={colorPickerRef} className="relative flex items-center">
          <ToolbarButton
            onClick={() => setColorPickerOpen(!colorPickerOpen)}
            active={colorPickerOpen}
            title="Text color"
          >
            <Palette className="w-3.5 h-3.5" />
          </ToolbarButton>
          {colorPickerOpen && (
            <div className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-xl shadow-xl p-2 w-[192px]">
              <div className="grid grid-cols-8 gap-1">
                {[
                  '#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef',
                  '#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff',
                  '#9900ff', '#ff00ff', '#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3',
                  '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc', '#dd7e6b', '#ea9999', '#f9cb9c', '#ffe599',
                  '#b6d7a8', '#a2c4c9', '#a4c2f4', '#9fc5e8', '#b4a7d6', '#d5a6bd',
                ].map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => {
                      editor.chain().focus().setColor(c).run();
                      setColorPickerOpen(false);
                    }}
                    className="w-5 h-5 rounded-md border border-border/40 hover:scale-110 transition-transform cursor-pointer"
                    style={{ backgroundColor: c }}
                    title={c}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  editor.chain().focus().unsetColor().run();
                  setColorPickerOpen(false);
                }}
                className="mt-1.5 w-full text-[10px] px-2 py-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
              >
                Remove color
              </button>
            </div>
          )}
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-0.5">
          <ToolbarButton
            onClick={() => editor.chain().focus().undo().run()}
            title="Undo"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().redo().run()}
            title="Redo"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </ToolbarButton>
        </div>
      </div>

      {/* Editor content */}
      <EditorContent
        editor={editor}
        className="max-w-none p-3 min-h-[200px] focus:outline-none text-xs leading-relaxed"
      />

      <style jsx global>{`
        .wysiwyg-editor .tiptap {
          min-height: 200px;
          outline: none;
        }
        .wysiwyg-editor .tiptap p {
          margin: 0.25em 0;
          line-height: 1.6;
        }
        .wysiwyg-editor .tiptap h1 {
          font-size: 1.125rem;
          font-weight: 800;
          margin: 1em 0 0.5em;
        }
        .wysiwyg-editor .tiptap h2 {
          font-size: 1rem;
          font-weight: 700;
          margin: 1em 0 0.4em;
          padding-bottom: 0.25em;
          border-bottom: 1px solid var(--border);
        }
        .wysiwyg-editor .tiptap h3 {
          font-size: 0.875rem;
          font-weight: 700;
          margin: 1em 0 0.3em;
        }
        .wysiwyg-editor .tiptap ul,
        .wysiwyg-editor .tiptap ol {
          padding-left: 1.5em;
          margin: 0.3em 0;
        }
        .wysiwyg-editor .tiptap ul {
          list-style-type: disc;
        }
        .wysiwyg-editor .tiptap ol {
          list-style-type: decimal;
        }
        .wysiwyg-editor .tiptap li {
          font-size: 0.8125rem;
          margin: 0.15em 0;
        }
        .wysiwyg-editor .tiptap blockquote {
          border-left: 3px solid var(--border);
          padding-left: 1em;
          margin: 0.5em 0;
          color: var(--muted-foreground);
          font-style: italic;
        }
        .wysiwyg-editor .tiptap pre {
          background: var(--muted);
          border: 1px solid var(--border);
          border-radius: 0.5rem;
          padding: 0.75em 1em;
          margin: 0.5em 0;
          overflow-x: auto;
          font-size: 0.75rem;
          font-family: monospace;
        }
        .wysiwyg-editor .tiptap code {
          background: var(--muted);
          padding: 0.15em 0.3em;
          border-radius: 0.25rem;
          font-size: 0.75rem;
          font-family: monospace;
        }
        .wysiwyg-editor .tiptap pre code {
          background: none;
          padding: 0;
          border-radius: 0;
        }
        .wysiwyg-editor .tiptap hr {
          margin: 1em 0;
          border-color: var(--border);
        }
        .wysiwyg-editor .tiptap p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: var(--muted-foreground);
          pointer-events: none;
          height: 0;
          opacity: 0.4;
        }
        .wysiwyg-editor .tiptap a {
          color: var(--blue-600);
          text-decoration: underline;
        }
        .dark .wysiwyg-editor .tiptap a {
          color: var(--blue-400);
        }
        .wysiwyg-editor .tiptap s {
          text-decoration: line-through;
        }
      `}</style>
    </div>
  );
}
