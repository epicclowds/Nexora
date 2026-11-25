import { Fragment, type ReactNode } from 'react';
import { safeHref } from '@/lib/punishment-edit';

/**
 * Renders GitHub release notes (untrusted Markdown) as React elements: no HTML
 * is ever interpreted (no dangerouslySetInnerHTML), HTML comments are dropped,
 * and only https:// links become clickable (opened without referrer/opener).
 * Supported: headings, bullet lists, paragraphs, **bold**, `code` and [links](https://…).
 */
export function ReleaseNotes({ markdown, className }: { markdown: string; className?: string }) {
  const lines = markdown.replace(/<!--[\s\S]*?-->/g, '').replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let paragraph: string[] = [];
  let inCode = false;
  let code: string[] = [];

  const flushList = () => {
    if (list.length) blocks.push(<ul key={`l${blocks.length}`} className="ml-5 list-disc space-y-1">{list.map((item, i) => <li key={i}>{inline(item)}</li>)}</ul>);
    list = [];
  };
  const flushParagraph = () => {
    if (paragraph.length) blocks.push(<p key={`p${blocks.length}`}>{inline(paragraph.join(' '))}</p>);
    paragraph = [];
  };

  for (const raw of lines) {
    if (raw.trim().startsWith('```')) {
      flushList();
      flushParagraph();
      if (inCode) blocks.push(<pre key={`c${blocks.length}`} className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">{code.join('\n')}</pre>);
      inCode = !inCode;
      code = [];
      continue;
    }
    if (inCode) {
      code.push(raw);
      continue;
    }
    const line = raw.trimEnd();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (heading) {
      flushList();
      flushParagraph();
      blocks.push(<p key={`h${blocks.length}`} className={heading[1].length <= 2 ? 'pt-2 text-base font-semibold' : 'pt-1 font-semibold'}>{inline(heading[2])}</p>);
    } else if (bullet) {
      flushParagraph();
      list.push(bullet[1]);
    } else if (!line.trim()) {
      flushList();
      flushParagraph();
    } else if (/^\s*\|/.test(line) || /^\s*-{3,}\s*$/.test(line)) {
      // Tables and rules are shown as plain text lines.
      flushList();
      flushParagraph();
      blocks.push(<p key={`t${blocks.length}`} className="font-mono text-xs break-all">{line}</p>);
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  if (inCode && code.length) blocks.push(<pre key="c-end" className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">{code.join('\n')}</pre>);
  flushList();
  flushParagraph();
  return <div className={className ?? 'grid gap-2 text-sm break-words'}>{blocks}</div>;
}

const TOKEN = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

function inline(text: string): ReactNode {
  return text.split(TOKEN).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <code key={i} className="rounded bg-muted px-1 font-mono text-xs">{part.slice(1, -1)}</code>;
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) {
      const href = safeHref(link[2]);
      return href ? (
        <a key={i} href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-primary hover:underline">
          {link[1]}
        </a>
      ) : (
        <Fragment key={i}>{link[1]}</Fragment>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}
