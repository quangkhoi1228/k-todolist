"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import Underline from "@tiptap/extension-underline";
import Superscript from "@tiptap/extension-superscript";
import Subscript from "@tiptap/extension-subscript";
import TextAlign from "@tiptap/extension-text-align";
import { Highlight } from "@tiptap/extension-highlight";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
// @ts-ignore
import ImageExt from "@tiptap/extension-image";
import LinkExt from "@tiptap/extension-link";
import { NodeSelection } from "@tiptap/pm/state";
import { FontSize } from "@/extensions/FontSize";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Code,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  List,
  ListOrdered,
  ListIndentIncrease,
  ListIndentDecrease,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Quote,
  Code2,
  Minus,
  Undo2,
  Redo2,
  Palette,
  PaintBucket,
  Table as TableIcon,
  Trash2,
  ImagePlus,
  Loader2,
  LinkIcon,
  Unlink,
  RemoveFormatting,
  Printer,
  ImageIcon,
  Lock,
  Unlock,
} from "lucide-react";

const FONT_SIZES = ["8","9","10","11","12","14","16","18","20","22","24","26","28","36","42","48","72"];

const TEXT_COLORS = [
  '#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef',
  '#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff',
  '#9900ff', '#ff00ff', '#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3',
  '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc', '#dd7e6b', '#ea9999', '#f9cb9c', '#ffe599',
  '#b6d7a8', '#a2c4c9', '#a4c2f4', '#9fc5e8', '#b4a7d6', '#d5a6bd',
];

const HIGHLIGHT_COLORS = [
  '#ffff00', '#00ff00', '#00ffff', '#ff9900', '#ff0000', '#ff00ff',
  '#c9daf8', '#d9ead3', '#fce5cd', '#f4cccc', '#d9d2e9', '#e6b8af',
];

interface WysiwygEditorProps {
  content: string;
  onChange: (md: string) => void;
  placeholder?: string;
  onImageUpload?: (file: File) => Promise<string>;
}

function ToolbarButton({
  onClick,
  active,
  disabled,
  children,
  title,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-1.5 rounded-md transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
        active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function ToolbarSelect({
  value,
  onChange,
  options,
  title,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly { label: string; value: string }[];
  title?: string;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title={title}
      className={`text-xs bg-transparent border border-border/40 rounded-md px-2 py-1.5 outline-none focus:ring-1 focus:ring-primary cursor-pointer hover:bg-muted/50 transition-colors ${className || ""}`}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

function Separator() {
  return <div className="w-px h-6 bg-border/50 mx-1.5" />;
}

const HEADING_OPTIONS = [
  { label: "Paragraph", value: "paragraph" },
  { label: "Heading 1", value: "h1" },
  { label: "Heading 2", value: "h2" },
  { label: "Heading 3", value: "h3" },
] as const;

// ─── Resizable Image Extension ───────────────────────────────────
const ImageEx = ImageExt.extend({
  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      title: { default: null },
      width: { default: null },
      height: { default: null },
    };
  },
});

function getImageAttrs(editor: ReturnType<typeof useEditor>) {
  if (!editor) return null;
  const node = editor.state.selection instanceof NodeSelection
    ? (editor.state.selection as NodeSelection).node
    : null;
  if (node && node.type.name === "image") {
    return { ...node.attrs };
  }
  const { from, to } = editor.state.selection;
  if (from === to) {
    const nodeAtPos = editor.state.doc.nodeAt(from);
    if (nodeAtPos && nodeAtPos.type.name === "image") {
      return { ...nodeAtPos.attrs };
    }
  }
  return null;
}

export function WysiwygEditor({ content, onChange, placeholder, onImageUpload }: WysiwygEditorProps) {
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const colorPickerRef = useRef<HTMLDivElement>(null);
  const [highlightPickerOpen, setHighlightPickerOpen] = useState(false);
  const highlightPickerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const linkPopoverRef = useRef<HTMLDivElement>(null);
  const handleImageFileRef = useRef<(file: File) => Promise<void>>(async () => {});

  // Image editing state
  const [imageEditorOpen, setImageEditorOpen] = useState(false);
  const [imageEditorAttrs, setImageEditorAttrs] = useState<{ src: string; width: string; height: string } | null>(null);
  const [keepAspect, setKeepAspect] = useState(true);
  const imageEditorRef = useRef<HTMLDivElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: false,
      }),
      Markdown,
      TextStyle,
      Color.configure({ types: ['textStyle'] }),
      FontSize,
      Underline,
      Superscript,
      Subscript,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Highlight.configure({ multicolor: true }),
      Placeholder.configure({
        placeholder: placeholder || "Bắt đầu viết...",
      }),
      Table.configure({
        resizable: true,
        HTMLAttributes: {
          class: 'tiptap-table w-full border-collapse',
        },
      }),
      TableRow,
      TableCell,
      TableHeader,
      ImageEx.configure({
        inline: false,
        allowBase64: false,
        HTMLAttributes: {
          class: 'tiptap-image',
        },
      }),
      LinkExt.configure({
        openOnClick: false,
        HTMLAttributes: {
          rel: 'noopener noreferrer',
          target: '_blank',
        },
      }),
    ],
    content,
    contentType: "markdown",
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      onChange(html);
    },
    editorProps: {
      handleDrop: (view, event, slice, moved) => {
        if (!moved && event.dataTransfer?.files?.length) {
          const imageFiles = Array.from(event.dataTransfer.files).filter(f =>
            f.type.startsWith("image/")
          );
          if (imageFiles.length > 0) {
            event.preventDefault();
            imageFiles.forEach(file => handleImageFileRef.current(file));
            return true;
          }
        }
        return false;
      },
      handlePaste: (view, event) => {
        const items = event.clipboardData?.items;
        if (!items) return false;

        // Handle image file paste (e.g. screenshots from clipboard)
        for (const item of Array.from(items)) {
          if (item.kind === "file" && item.type.startsWith("image/")) {
            event.preventDefault();
            const file = item.getAsFile();
            if (file) handleImageFileRef.current(file);
            return true;
          }
        }

        // For text/HTML paste without images, let TipTap handle it natively
        return false;
      },
    },
  });

  const handleImageFile = useCallback(async (file: File) => {
    if (!editor || !onImageUpload) return;

    if (file.size > 10 * 1024 * 1024) {
      alert("Ảnh phải nhỏ hơn 10MB");
      return;
    }

    if (!file.type.startsWith("image/")) {
      alert("Chỉ chấp nhận file ảnh");
      return;
    }

    setUploading(true);
    try {
      const url = await onImageUpload(file);
      editor.chain().focus().setImage({ src: url }).run();
    } catch (err) {
      console.error("Failed to upload image:", err);
      alert("Không thể tải ảnh lên. Vui lòng thử lại.");
    } finally {
      setUploading(false);
    }
  }, [editor, onImageUpload]);

  handleImageFileRef.current = handleImageFile;

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleImageFile(file);
    }
    e.target.value = "";
  }, [handleImageFile]);

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // Intercept copy/cut
  const handleCopyRef = useRef((e: ClipboardEvent) => {
    if (!editor) return;
    e.preventDefault();
    const html = editor.getHTML();
    e.clipboardData?.setData('text/html', html);
    const text = editor.state.doc.textBetween(
      editor.state.selection.from,
      editor.state.selection.to,
      '\n',
    );
    e.clipboardData?.setData('text/plain', text);
  });

  useEffect(() => {
    const el = editor?.view?.dom;
    if (!el) return;
    const handler = (e: ClipboardEvent) => handleCopyRef.current(e);
    el.addEventListener('copy', handler);
    return () => el.removeEventListener('copy', handler);
  }, [editor]);

  const handleCutRef = useRef((e: ClipboardEvent) => {
    if (!editor) return;
    e.preventDefault();
    const html = editor.getHTML();
    e.clipboardData?.setData('text/html', html);
    const text = editor.state.doc.textBetween(
      editor.state.selection.from,
      editor.state.selection.to,
      '\n',
    );
    e.clipboardData?.setData('text/plain', text);
    editor.chain().focus().deleteSelection().run();
  });

  useEffect(() => {
    const el = editor?.view?.dom;
    if (!el) return;
    const handler = (e: ClipboardEvent) => handleCutRef.current(e);
    el.addEventListener('cut', handler);
    return () => el.removeEventListener('cut', handler);
  }, [editor]);

  // Close popovers on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) {
        setColorPickerOpen(false);
      }
      if (highlightPickerRef.current && !highlightPickerRef.current.contains(e.target as Node)) {
        setHighlightPickerOpen(false);
      }
      if (linkPopoverRef.current && !linkPopoverRef.current.contains(e.target as Node)) {
        setLinkPopoverOpen(false);
      }
      if (imageEditorRef.current && !imageEditorRef.current.contains(e.target as Node)) {
        setImageEditorOpen(false);
      }
    };
    if (colorPickerOpen || highlightPickerOpen || linkPopoverOpen || imageEditorOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [colorPickerOpen, highlightPickerOpen, linkPopoverOpen, imageEditorOpen]);

  useEffect(() => {
    if (linkPopoverOpen) {
      linkInputRef.current?.focus();
      linkInputRef.current?.select();
    }
  }, [linkPopoverOpen]);

  // Track image selection for editing
  useEffect(() => {
    if (!editor) return;
    const handleSelectionUpdate = () => {
      const attrs = getImageAttrs(editor);
      if (attrs) {
        setImageEditorAttrs({ src: attrs.src, width: attrs.width || "", height: attrs.height || "" });
        setImageEditorOpen(true);
      } else {
        // Don't close immediately on selection change — only on click-outside
      }
    };
    editor.on("selectionUpdate", handleSelectionUpdate);
    return () => { editor.off("selectionUpdate", handleSelectionUpdate); };
  }, [editor]);

  const applyImageDimensions = useCallback((width: string, height: string) => {
    if (!editor) return;
    const pos = editor.state.selection.from;
    const nodeAtPos = editor.state.doc.nodeAt(pos);
    if (nodeAtPos && nodeAtPos.type.name === "image") {
      editor.chain().focus().updateAttributes("image", { width: width || null, height: height || null }).run();
    }
  }, [editor]);

  if (!editor) return null;

  const currentFontSize = editor.getAttributes("textStyle").fontSize || "";

  const currentHeading = editor.isActive("paragraph") ? "paragraph"
    : editor.isActive("heading", { level: 1 }) ? "h1"
    : editor.isActive("heading", { level: 2 }) ? "h2"
    : editor.isActive("heading", { level: 3 }) ? "h3"
    : "paragraph";

  const currentTextAlign = editor.isActive({ textAlign: "left" }) ? "left"
    : editor.isActive({ textAlign: "center" }) ? "center"
    : editor.isActive({ textAlign: "right" }) ? "right"
    : editor.isActive({ textAlign: "justify" }) ? "justify"
    : "left";

  return (
    <div className="wysiwyg-editor relative">
      {/* === TOOLBAR (single row) === */}
      <div className="flex items-center gap-0.5 p-1.5 border-b border-border/40 flex-wrap bg-muted/20 rounded-t-lg">

        {/* ─── GROUP 1: History ─── */}
        <div className="flex items-center gap-0.5">
          <ToolbarButton
            onClick={() => editor.chain().focus().undo().run()}
            title="Undo (Ctrl+Z)"
          >
            <Undo2 className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().redo().run()}
            title="Redo (Ctrl+Shift+Z)"
          >
            <Redo2 className="w-4 h-4" />
          </ToolbarButton>
        </div>

        <Separator />

        {/* ─── GROUP 2: Text Style + Size ─── */}
        <div className="flex items-center gap-0.5">
          <ToolbarSelect
            value={currentHeading}
            onChange={(v) => {
              if (v === "paragraph") {
                editor.chain().focus().setParagraph().run();
              } else {
                const level = parseInt(v.replace("h", ""), 10) as 1 | 2 | 3;
                editor.chain().focus().toggleHeading({ level }).run();
              }
            }}
            options={HEADING_OPTIONS}
            title="Heading style"
            className="max-w-[90px]"
          />
          <ToolbarSelect
            value={currentFontSize}
            onChange={(v) => {
              if (v === "") {
                editor.chain().focus().unsetFontSize().run();
              } else {
                editor.chain().focus().setFontSize(`${v}pt`).run();
              }
            }}
            options={[
              { label: "Size", value: "" },
              ...FONT_SIZES.map((s) => ({ label: s, value: s })),
            ]}
            title="Font size"
            className="max-w-[58px]"
          />
        </div>

        <Separator />

        {/* ─── GROUP 3: Text Format ─── */}
        <div className="flex items-center gap-0.5">
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBold().run()}
            active={editor.isActive("bold")}
            title="Bold (Ctrl+B)"
          >
            <Bold className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleItalic().run()}
            active={editor.isActive("italic")}
            title="Italic (Ctrl+I)"
          >
            <Italic className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            active={editor.isActive("underline")}
            title="Underline (Ctrl+U)"
          >
            <UnderlineIcon className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleStrike().run()}
            active={editor.isActive("strike")}
            title="Strikethrough"
          >
            <Strikethrough className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleCode().run()}
            active={editor.isActive("code")}
            title="Inline code"
          >
            <Code className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleSuperscript().run()}
            active={editor.isActive("superscript")}
            title="Superscript"
          >
            <SuperscriptIcon className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleSubscript().run()}
            active={editor.isActive("subscript")}
            title="Subscript"
          >
            <SubscriptIcon className="w-4 h-4" />
          </ToolbarButton>
        </div>

        <Separator />

        {/* ─── GROUP 4: Color / Highlight ─── */}
        <div className="flex items-center gap-0.5">
          <div ref={colorPickerRef} className="relative flex items-center">
            <ToolbarButton
              onClick={() => setColorPickerOpen(!colorPickerOpen)}
              active={colorPickerOpen}
              title="Text color"
            >
              <Palette className="w-4 h-4" />
            </ToolbarButton>
            {colorPickerOpen && (
              <div className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-xl shadow-xl p-2 w-[192px]">
                <div className="grid grid-cols-8 gap-1">
                  {TEXT_COLORS.map((c) => (
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

          <div ref={highlightPickerRef} className="relative flex items-center">
            <ToolbarButton
              onClick={() => setHighlightPickerOpen(!highlightPickerOpen)}
              active={highlightPickerOpen}
              title="Highlight color"
            >
              <PaintBucket className="w-4 h-4" />
            </ToolbarButton>
            {highlightPickerOpen && (
              <div className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-xl shadow-xl p-2 w-[168px]">
                <div className="grid grid-cols-6 gap-1">
                  {HIGHLIGHT_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => {
                        editor.chain().focus().toggleHighlight({ color: c }).run();
                        setHighlightPickerOpen(false);
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
                    editor.chain().focus().toggleHighlight().run();
                    setHighlightPickerOpen(false);
                  }}
                  className="mt-1.5 w-full text-[10px] px-2 py-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                >
                  Remove highlight
                </button>
              </div>
            )}
          </div>
        </div>

        <Separator />

        {/* ─── GROUP 5: Alignment ─── */}
        <div className="flex items-center gap-0.5">
          <ToolbarButton
            onClick={() => editor.chain().focus().setTextAlign("left").run()}
            active={currentTextAlign === "left"}
            title="Align left"
          >
            <AlignLeft className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().setTextAlign("center").run()}
            active={currentTextAlign === "center"}
            title="Center"
          >
            <AlignCenter className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().setTextAlign("right").run()}
            active={currentTextAlign === "right"}
            title="Align right"
          >
            <AlignRight className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().setTextAlign("justify").run()}
            active={currentTextAlign === "justify"}
            title="Justify"
          >
            <AlignJustify className="w-4 h-4" />
          </ToolbarButton>
        </div>

        <Separator />

        {/* ─── GROUP 6: Lists ─── */}
        <div className="flex items-center gap-0.5">
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            active={editor.isActive("bulletList")}
            title="Bullet list"
          >
            <List className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            active={editor.isActive("orderedList")}
            title="Ordered list"
          >
            <ListOrdered className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().sinkListItem("listItem").run()}
            disabled={!editor.can().sinkListItem("listItem")}
            title="Indent list"
          >
            <ListIndentIncrease className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().liftListItem("listItem").run()}
            disabled={!editor.can().liftListItem("listItem")}
            title="Outdent list"
          >
            <ListIndentDecrease className="w-4 h-4" />
          </ToolbarButton>
        </div>

        <Separator />

        {/* ─── GROUP 7: Insert ─── */}
        <div className="flex items-center gap-0.5">
          {/* Link */}
          <div className="relative flex items-center" ref={linkPopoverRef}>
            <ToolbarButton
              onClick={() => {
                const previousUrl = editor.getAttributes("link").href || "";
                setLinkUrl(previousUrl);
                setLinkPopoverOpen(!linkPopoverOpen);
              }}
              active={editor.isActive("link")}
              title="Thêm link"
            >
              <LinkIcon className="w-4 h-4" />
            </ToolbarButton>
            {editor.isActive("link") && (
              <ToolbarButton
                onClick={() => {
                  editor.chain().focus().unsetLink().run();
                  setLinkPopoverOpen(false);
                }}
                title="Xoá link"
              >
                <Unlink className="w-4 h-4" />
              </ToolbarButton>
            )}
            {linkPopoverOpen && (
              <div className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-xl shadow-xl p-2 min-w-[260px]">
                <div className="flex items-center gap-1.5">
                  <input
                    ref={linkInputRef}
                    type="url"
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        if (linkUrl === "") {
                          editor.chain().focus().unsetLink().run();
                        } else {
                          editor.chain().focus().setLink({ href: linkUrl }).run();
                        }
                        setLinkPopoverOpen(false);
                      }
                      if (e.key === "Escape") {
                        setLinkPopoverOpen(false);
                      }
                    }}
                    placeholder="https://..."
                    className="flex-1 text-xs bg-background border border-border rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/50"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (linkUrl === "") {
                        editor.chain().focus().unsetLink().run();
                      } else {
                        editor.chain().focus().setLink({ href: linkUrl }).run();
                      }
                      setLinkPopoverOpen(false);
                    }}
                    className="px-2 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors cursor-pointer"
                  >
                    OK
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Image upload */}
          <ToolbarButton
            onClick={handleUploadClick}
            disabled={uploading || !onImageUpload}
            title="Thêm ảnh"
          >
            {uploading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <ImagePlus className="w-4 h-4" />
            )}
          </ToolbarButton>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileInputChange}
          />

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            active={editor.isActive("blockquote")}
            title="Blockquote"
          >
            <Quote className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            active={editor.isActive("codeBlock")}
            title="Code block"
          >
            <Code2 className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            title="Horizontal rule"
          >
            <Minus className="w-4 h-4" />
          </ToolbarButton>

          {/* Table */}
          {editor.isActive("table") ? (
            <span className="flex items-center gap-0.5">
              <ToolbarButton
                onClick={() => editor.chain().focus().addColumnBefore().run()}
                title="Cột trước"
              >
                <span className="flex items-center gap-0.5 text-[9px] font-bold">&#x2190;Col</span>
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().addColumnAfter().run()}
                title="Cột sau"
              >
                <span className="flex items-center gap-0.5 text-[9px] font-bold">Col&#x2192;</span>
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().addRowBefore().run()}
                title="Hàng trước"
              >
                <span className="flex items-center gap-0.5 text-[9px] font-bold">&#x2191;Row</span>
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().addRowAfter().run()}
                title="Hàng sau"
              >
                <span className="flex items-center gap-0.5 text-[9px] font-bold">Row&#x2193;</span>
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().deleteColumn().run()}
                title="Xoá cột"
              >
                <span className="text-[9px] font-bold">ColX</span>
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().deleteRow().run()}
                title="Xoá hàng"
              >
                <span className="text-[9px] font-bold">RowX</span>
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleHeaderCell().run()}
                active={editor.isActive("tableHeader")}
                title="Header cell"
              >
                <span className="text-[9px] font-bold">TH</span>
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().mergeOrSplit().run()}
                title="Merge / Split"
              >
                <span className="text-[9px] font-bold">M/S</span>
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().deleteTable().run()}
                title="Xoá bảng"
              >
                <Trash2 className="w-3.5 h-3.5 text-destructive" />
              </ToolbarButton>
            </span>
          ) : (
            <ToolbarButton
              onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
              title="Thêm bảng"
            >
              <TableIcon className="w-4 h-4" />
            </ToolbarButton>
          )}
        </div>

        <Separator />

        {/* ─── GROUP 8: Actions ─── */}
        <div className="flex items-center gap-0.5">
          <ToolbarButton
            onClick={() => {
              editor.chain().focus().clearNodes().unsetAllMarks().run();
            }}
            title="Clear formatting"
          >
            <RemoveFormatting className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => window.print()}
            title="Print"
          >
            <Printer className="w-4 h-4" />
          </ToolbarButton>
        </div>
      </div>

      {/* Editor content */}
      <EditorContent
        editor={editor}
        className="max-w-none p-4 min-h-[200px] focus:outline-none text-sm leading-relaxed"
      />

      {/* ─── Image Edit Popover ─── */}
      {imageEditorOpen && imageEditorAttrs && (
        <div
          ref={imageEditorRef}
          className="absolute left-1/2 -translate-x-1/2 z-50 bg-popover border border-border rounded-xl shadow-xl p-3 min-w-[280px]"
          style={{ top: "var(--toolbar-bottom, 44px)" }}
        >
          <div className="flex items-center gap-2 mb-2">
            <ImageIcon className="w-4 h-4 text-primary" />
            <span className="text-xs font-semibold text-foreground">Edit image</span>
          </div>

          {/* Current image preview */}
          {imageEditorAttrs.src && (
            <div className="mb-2 rounded-lg overflow-hidden border border-border/40 max-h-[120px] flex items-center justify-center bg-muted/20">
              <img
                src={imageEditorAttrs.src}
                alt="preview"
                className="max-w-full max-h-[120px] object-contain"
              />
            </div>
          )}

          <div className="flex items-center gap-2 mb-2">
            <div className="flex-1">
              <label className="text-[10px] text-muted-foreground mb-0.5 block">Width</label>
              <input
                type="number"
                min="1"
                value={imageEditorAttrs.width ? parseInt(imageEditorAttrs.width) : ""}
                onChange={(e) => {
                  const w = e.target.value;
                  const newAttrs = { ...imageEditorAttrs, width: w };
                  setImageEditorAttrs(newAttrs);
                  if (keepAspect && w && imageEditorAttrs.height) {
                    // Recalculate height from original ratio — we don't know original,
                    // so just apply width only and clear height for auto
                  }
                  applyImageDimensions(w, imageEditorAttrs.height);
                }}
                placeholder="Auto"
                className="w-full text-xs bg-background border border-border rounded-md px-2 py-1 outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="flex-1">
              <label className="text-[10px] text-muted-foreground mb-0.5 block">Height</label>
              <input
                type="number"
                min="1"
                value={imageEditorAttrs.height ? parseInt(imageEditorAttrs.height) : ""}
                onChange={(e) => {
                  const h = e.target.value;
                  const newAttrs = { ...imageEditorAttrs, height: h };
                  setImageEditorAttrs(newAttrs);
                  applyImageDimensions(imageEditorAttrs.width, h);
                }}
                placeholder="Auto"
                className="w-full text-xs bg-background border border-border rounded-md px-2 py-1 outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <button
              type="button"
              onClick={() => setKeepAspect(!keepAspect)}
              title={keepAspect ? "Unlock aspect ratio" : "Lock aspect ratio"}
              className={`p-1.5 rounded-md transition-colors cursor-pointer self-end ${
                keepAspect ? "text-primary bg-primary/10" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {keepAspect ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                // Reset to auto dimensions
                setImageEditorAttrs({ ...imageEditorAttrs, width: "", height: "" });
                applyImageDimensions("", "");
              }}
              className="flex-1 px-2 py-1.5 text-[10px] font-medium rounded-lg bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors cursor-pointer"
            >
              Reset size
            </button>
            <button
              type="button"
              onClick={() => {
                // Delete image
                if (editor) {
                  editor.chain().focus().deleteSelection().run();
                }
                setImageEditorOpen(false);
              }}
              className="flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] font-medium rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors cursor-pointer"
            >
              <Trash2 className="w-3 h-3" />
              Delete
            </button>
          </div>
        </div>
      )}

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
        .wysiwyg-editor .tiptap u {
          text-decoration: underline;
        }
        .wysiwyg-editor .tiptap sup {
          font-size: 0.75em;
          vertical-align: super;
        }
        .wysiwyg-editor .tiptap sub {
          font-size: 0.75em;
          vertical-align: sub;
        }
        .wysiwyg-editor .tiptap mark {
          padding: 0.1em 0.2em;
          border-radius: 0.2em;
        }
        .wysiwyg-editor .tiptap table {
          width: 100%;
          border-collapse: collapse;
          margin: 0.5em 0;
          font-size: 0.8125rem;
          overflow: hidden;
        }
        .wysiwyg-editor .tiptap th,
        .wysiwyg-editor .tiptap td {
          border: 2px solid var(--border);
          padding: 0.5em 0.75em;
          vertical-align: top;
          text-align: left;
          min-width: 80px;
        }
        .wysiwyg-editor .tiptap th {
          background: var(--muted);
          font-weight: 600;
        }
        .wysiwyg-editor .tiptap td {
          background: var(--card);
        }
        .wysiwyg-editor .tiptap .selectedCell {
          background: color-mix(in srgb, var(--primary) 15%, transparent);
          border-color: var(--primary);
        }
        .wysiwyg-editor .tiptap th p,
        .wysiwyg-editor .tiptap td p {
          margin: 0;
          font-size: 0.8125rem;
        }
        .wysiwyg-editor .tiptap .column-resize-handle {
          position: absolute;
          right: -2px;
          top: 0;
          bottom: 0;
          width: 4px;
          background: var(--primary);
          pointer-events: none;
        }
        .wysiwyg-editor .tiptap img {
          max-width: 100%;
          height: auto;
          border-radius: 0.5rem;
          margin: 0.75em 0;
          display: block;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
          transition: box-shadow 0.2s ease;
        }
        .wysiwyg-editor .tiptap img:hover {
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }
        .dark .wysiwyg-editor .tiptap img {
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
        }
        .dark .wysiwyg-editor .tiptap img:hover {
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
        }
        .wysiwyg-editor .tiptap img.ProseMirror-selectednode {
          outline: 3px solid var(--primary);
          outline-offset: 2px;
          border-radius: 0.5rem;
        }
        /* Heading with text-align */
        .wysiwyg-editor .tiptap h1[style*="text-align"],
        .wysiwyg-editor .tiptap h2[style*="text-align"],
        .wysiwyg-editor .tiptap h3[style*="text-align"],
        .wysiwyg-editor .tiptap p[style*="text-align"] {
          text-align: inherit;
        }
      `}</style>
    </div>
  );
}
