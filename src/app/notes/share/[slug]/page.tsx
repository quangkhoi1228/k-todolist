"use client";

import { use } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { FileText, ChevronRight, Folder } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

function isHtml(str: string): boolean {
  return /^\s*<[^>]+>/i.test(str);
}

export default function SharedNotePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);

  const noteData = useQuery(api.notes.getNoteByShareSlug, { slug });

  if (noteData === undefined) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-primary/30 border-t-primary rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">Đang tải ghi chú...</p>
        </div>
      </div>
    );
  }

  if (noteData === null) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 rounded-2xl bg-muted/40 flex items-center justify-center mx-auto mb-4">
            <FileText className="w-8 h-8 text-muted-foreground/50" />
          </div>
          <h1 className="text-xl font-bold text-foreground mb-2">Ghi chú không tồn tại</h1>
          <p className="text-sm text-muted-foreground">
            Liên kết này có thể đã bị xóa hoặc không hợp lệ.
          </p>
        </div>
      </div>
    );
  }

  const contentIsHtml = noteData.content ? isHtml(noteData.content) : false;

  const createdDate = new Date(noteData._creationTime).toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="border-b border-border/50 bg-card/60 backdrop-blur-md sticky top-0 z-20">
        <div className="max-w-4xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <FileText className="w-4 h-4" />
            <span className="font-medium text-foreground">KFlow</span>
            <span className="text-muted-foreground/50">{'/'}</span>
            <span>Ghi chú chia sẻ</span>
          </div>
          <div className="flex items-center gap-3">
            {noteData.projectName && (
              <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary font-medium">
                <Folder className="w-3 h-3" />
                {noteData.projectName}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Breadcrumb */}
      {noteData.breadcrumb.length > 0 && (
        <div className="max-w-4xl mx-auto px-6 pt-4">
          <div className="flex items-center gap-1 text-xs text-muted-foreground flex-wrap">
            {noteData.breadcrumb.map((b: { id: string; title: string }, i: number) => (
              <span key={b.id} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="w-3 h-3" />}
                <span>{b.title}</span>
              </span>
            ))}
            <ChevronRight className="w-3 h-3" />
            <span className="text-foreground font-medium">{noteData.title}</span>
          </div>
        </div>
      )}

      {/* Note content */}
      <main className="max-w-4xl mx-auto px-6 py-8">
        <article>
          {/* Title */}
          <h1 className="text-3xl font-bold text-foreground mb-2 leading-tight">
            {noteData.icon} {noteData.title}
          </h1>

          {/* Meta */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground mb-8 pb-4 border-b border-border/30">
            <span>Ngày tạo: {createdDate}</span>
            {noteData.childNotes.length > 0 && (
              <span>{noteData.childNotes.length} note con</span>
            )}
          </div>

          {/* Rendered content */}
          {noteData.content ? (
            contentIsHtml ? (
              <div
                className="wysiwyg-content prose prose-neutral dark:prose-invert max-w-none prose-headings:font-bold prose-p:text-foreground/90 prose-a:text-primary prose-code:text-primary/80 prose-code:bg-muted/50 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:text-sm prose-code:before:content-none prose-code:after:content-none prose-pre:bg-muted/30 prose-pre:border prose-pre:border-border/30 prose-pre:rounded-xl prose-li:text-foreground/90 prose-strong:text-foreground prose-img:rounded-xl prose-img:shadow-md"
                dangerouslySetInnerHTML={{ __html: noteData.content }}
              />
            ) : (
              <div className="prose prose-neutral dark:prose-invert max-w-none prose-headings:font-bold prose-p:text-foreground/90 prose-a:text-primary prose-code:text-primary/80 prose-code:bg-muted/50 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:text-sm prose-code:before:content-none prose-code:after:content-none prose-pre:bg-muted/30 prose-pre:border prose-pre:border-border/30 prose-pre:rounded-xl prose-li:text-foreground/90 prose-strong:text-foreground prose-img:rounded-xl prose-img:shadow-md">
                <Markdown remarkPlugins={[remarkGfm]}>{noteData.content}</Markdown>
              </div>
            )
          ) : (
            <p className="text-muted-foreground/50 italic">Ghi chú này chưa có nội dung.</p>
          )}

          {/* Child notes */}
          {noteData.childNotes.length > 0 && (
            <div className="mt-10 pt-6 border-t border-border/30">
              <h3 className="text-sm font-semibold text-foreground mb-3">Note con</h3>
              <div className="space-y-1.5">
                {noteData.childNotes.map((child: { id: string; title: string; icon?: string | null }) => (
                  <div
                    key={child.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/20 border border-border/30 text-sm text-muted-foreground"
                  >
                    <span>{child.icon || "📝"}</span>
                    <span>{child.title}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground/50 mt-3 italic">
                Chỉ hiển thị tiêu đề note con. Vui lòng đăng nhập để xem đầy đủ.
              </p>
            </div>
          )}

          {/* Styles for HTML content */}
          <style jsx global>{`
            .wysiwyg-content img {
              max-width: 100%;
              height: auto;
              border-radius: 0.5rem;
              margin: 0.75em 0;
              display: block;
              box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
            }
            .wysiwyg-content table {
              width: 100%;
              border-collapse: collapse;
              margin: 0.5em 0;
            }
            .wysiwyg-content th,
            .wysiwyg-content td {
              border: 2px solid var(--border);
              padding: 0.5em 0.75em;
              vertical-align: top;
            }
            .wysiwyg-content th {
              background: var(--muted);
              font-weight: 600;
            }
            .wysiwyg-content mark {
              padding: 0.1em 0.2em;
              border-radius: 0.2em;
            }
          `}</style>
        </article>
      </main>
    </div>
  );
}
