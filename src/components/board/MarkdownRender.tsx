import { useMemo } from "react";

interface MarkdownRenderProps {
  content: string;
  className?: string;
}

export function MarkdownRender({ content, className = "" }: MarkdownRenderProps) {
  const html = useMemo(() => {
    let result = content
      // Escape HTML
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      // Code blocks
      .replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) => {
        return `<pre class="bg-muted/60 border border-border/40 rounded-lg p-3 my-2 overflow-x-auto"><code class="text-xs font-mono leading-relaxed">${code.trim()}</code></pre>`;
      })
      // Inline code
      .replace(/`([^`]+)`/g, '<code class="bg-muted/60 px-1 py-0.5 rounded text-xs font-mono">$1</code>')
      // Headings
      .replace(/^###### (.+)$/gm, '<h6 class="text-xs font-bold text-foreground/70 mt-3 mb-1">$1</h6>')
      .replace(/^##### (.+)$/gm, '<h5 class="text-xs font-bold text-foreground/80 mt-3 mb-1">$1</h5>')
      .replace(/^#### (.+)$/gm, '<h4 class="text-xs font-bold text-foreground mt-3 mb-1">$1</h4>')
      .replace(/^### (.+)$/gm, '<h3 class="text-sm font-bold text-foreground mt-4 mb-1.5">$1</h3>')
      .replace(/^## (.+)$/gm, '<h2 class="text-sm font-extrabold text-foreground mt-5 mb-2 pb-1 border-b border-border/30">$1</h2>')
      .replace(/^# (.+)$/gm, '<h1 class="text-base font-black text-foreground mt-5 mb-2 pb-1 border-b border-border/40">$1</h1>')
      // Bold + Italic
      .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      // Bold
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      // Italic
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      // Links
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-blue-600 dark:text-blue-400 underline hover:no-underline">$1</a>')
      // Unordered list items
      .replace(/^(\s*)[-*] (.+)$/gm, (_m, indent, text) => {
        return `${indent}<li class="text-xs text-foreground/90 leading-relaxed ml-4 list-disc">${text}</li>`;
      })
      // Ordered list items
      .replace(/^(\s*)\d+\. (.+)$/gm, (_m, indent, text) => {
        return `${indent}<li class="text-xs text-foreground/90 leading-relaxed ml-4 list-decimal">${text}</li>`;
      })
      // Horizontal rule
      .replace(/^---$/gm, '<hr class="my-3 border-border/40" />')
      // Paragraphs: double newline
      .replace(/\n\n/g, '</p><p class="text-xs text-foreground/85 leading-relaxed">')
      // Single newline within paragraph becomes br
      .replace(/\n/g, '<br />');

    // Wrap in paragraphs if not already wrapped by headings/pre/etc
    if (!result.startsWith("<h") && !result.startsWith("<pre") && !result.startsWith("<li")) {
      result = `<p class="text-xs text-foreground/85 leading-relaxed">${result}</p>`;
    }

    return result;
  }, [content]);

  return (
    <div
      className={`prose prose-xs max-w-none ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
