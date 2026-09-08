"use client";

// Markdown-lite renderer for assistant messages.
// Safe by construction: produces React elements only, no dangerouslySetInnerHTML,
// links are restricted to http(s) with rel=noopener.

import { AlertCircle, Check, Copy } from "lucide-react";
import { type ReactNode, memo, useEffect, useMemo, useRef, useState } from "react";
import type { Locale } from "./i18n";

type Block =
  | { kind: "code"; lang: string; content: string }
  | { kind: "heading"; level: number; text: string }
  | { kind: "list"; ordered: boolean; start: number; items: string[] }
  | { kind: "table"; headers: string[]; align: ("left" | "center" | "right" | undefined)[]; rows: string[][] }
  | { kind: "quote"; text: string }
  | { kind: "hr" }
  | { kind: "p"; text: string };

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})([\w+#.-]*)[ \t]*$/;
const HEADING = /^(#{1,4})\s+(.*)$/;
const HR = /^\s*(-{3,}|\*{3,})\s*$/;
const BULLET = /^\s*[-*•]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const BLANK = /^\s*$/;

const INLINE =
  /(\*\*([^*]+)\*\*)|(\*([^*\n]+)\*)|(`([^`\n]+)`)|(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = new RegExp(INLINE.source, "gi");
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const key = `${keyPrefix}-${index++}`;
    if (match[1]) {
      nodes.push(<strong key={key}>{match[2]}</strong>);
    } else if (match[3]) {
      nodes.push(<em key={key}>{match[4]}</em>);
    } else if (match[5]) {
      nodes.push(
        <code className="md-inline-code" key={key}>
          {match[6]}
        </code>,
      );
    } else if (match[7]) {
      let safeUrl: string | null = null;
      try {
        const url = new URL(match[9]);
        if ((url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password) safeUrl = url.href;
      } catch {
        // Incomplete streamed URLs stay readable until they become valid.
      }
      nodes.push(safeUrl ? (
        <a className="md-link" key={key} href={safeUrl} target="_blank" rel="noopener noreferrer nofollow">
          {match[8]}
        </a>
      ) : match[0]);
    }
    last = pattern.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function tableCells(line: string): string[] {
  const trimmed = line.trim();
  const cells: string[] = [];
  let cell = "";
  let codeTicks = 0;
  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    if (character === "\\" && trimmed[index + 1] === "|") {
      cell += "|";
      index += 1;
    } else if (character === "`") {
      let ticks = 1;
      while (trimmed[index + ticks] === "`") ticks += 1;
      if (!codeTicks) codeTicks = ticks;
      else if (codeTicks === ticks) codeTicks = 0;
      cell += "`".repeat(ticks);
      index += ticks - 1;
    } else if (character === "|" && !codeTicks) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  if (trimmed.startsWith("|") && cells[0] === "") cells.shift();
  if (trimmed.endsWith("|") && cells[cells.length - 1] === "") cells.pop();
  return cells;
}

function tableHeader(lines: string[], index: number) {
  if (index + 1 >= lines.length || !lines[index].includes("|")) return null;
  const headers = tableCells(lines[index]);
  const delimiters = tableCells(lines[index + 1]);
  if (!headers.length || headers.length !== delimiters.length || !delimiters.every((cell) => /^:?-{3,}:?$/.test(cell))) return null;
  const align = delimiters.map((cell): "left" | "center" | "right" | undefined =>
    cell.startsWith(":") ? (cell.endsWith(":") ? "center" : "left") : cell.endsWith(":") ? "right" : undefined,
  );
  return { headers, align };
}

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    const fence = line.match(FENCE_OPEN);
    if (fence) {
      const lang = fence[2] || "";
      const closingFence = new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}[ \t]*$`);
      const buffer: string[] = [];
      i += 1;
      while (i < lines.length && !closingFence.test(lines[i])) {
        buffer.push(lines[i]);
        i += 1;
      }
      i += 1; // skip the closing fence (or run past EOF)
      blocks.push({ kind: "code", lang, content: buffer.join("\n") });
      continue;
    }

    if (BLANK.test(line)) {
      i += 1;
      continue;
    }

    const table = tableHeader(lines, i);
    if (table) {
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && !BLANK.test(lines[i]) && lines[i].includes("|") && !FENCE_OPEN.test(lines[i]) && !HEADING.test(lines[i]) && !QUOTE.test(lines[i]) && !BULLET.test(lines[i]) && !ORDERED.test(lines[i])) {
        const cells = tableCells(lines[i]);
        rows.push(table.headers.map((_, column) => cells[column] || ""));
        i += 1;
      }
      blocks.push({ kind: "table", ...table, rows });
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      i += 1;
      continue;
    }

    if (HR.test(line)) {
      blocks.push({ kind: "hr" });
      i += 1;
      continue;
    }

    const bullet = line.match(BULLET);
    const ordered = line.match(ORDERED);
    if (bullet || ordered) {
      const isOrdered = Boolean(ordered);
      const pattern = isOrdered ? ORDERED : BULLET;
      const items: string[] = [];
      while (i < lines.length) {
        const item = lines[i].match(pattern);
        if (!item) break;
        items.push(item[1]);
        i += 1;
      }
      blocks.push({ kind: "list", ordered: isOrdered, start: isOrdered ? Number.parseInt(line.trim(), 10) : 1, items });
      continue;
    }

    const quote = line.match(QUOTE);
    if (quote) {
      const buffer = [quote[1]];
      i += 1;
      while (i < lines.length) {
        const nested = lines[i].match(QUOTE);
        if (!nested) break;
        buffer.push(nested[1]);
        i += 1;
      }
      blocks.push({ kind: "quote", text: buffer.join(" ") });
      continue;
    }

    const paragraph = [line];
    i += 1;
    while (
      i < lines.length &&
      !BLANK.test(lines[i]) &&
      !FENCE_OPEN.test(lines[i]) &&
      !HEADING.test(lines[i]) &&
      !HR.test(lines[i]) &&
      !tableHeader(lines, i) &&
      !BULLET.test(lines[i]) &&
      !ORDERED.test(lines[i]) &&
      !QUOTE.test(lines[i])
    ) {
      paragraph.push(lines[i]);
      i += 1;
    }
    blocks.push({ kind: "p", text: paragraph.join("\n") });
  }

  return blocks;
}

const markdownLabels: Record<Locale, { copy: string; copied: string; failed: string; table: string }> = {
  fa: { copy: "کپی کد", copied: "کپی شد", failed: "کپی انجام نشد؛ کد را انتخاب و دستی کپی کنید.", table: "جدول پاسخ؛ برای دیدن ستون‌ها پیمایش کنید" },
  en: { copy: "Copy code", copied: "Copied", failed: "Could not copy. Select the code and copy it manually.", table: "Response table; scroll to see all columns" },
  ar: { copy: "نسخ الكود", copied: "تم النسخ", failed: "تعذر النسخ. حدد الكود وانسخه يدويًا.", table: "جدول الإجابة؛ مرر لرؤية جميع الأعمدة" },
  zh: { copy: "复制代码", copied: "已复制", failed: "复制失败。请选择代码并手动复制。", table: "回答表格；滚动查看所有列" },
};

function CodeBlock({ lang, content, locale }: { lang: string; content: string; locale: Locale }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const timerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const copyVersion = useRef(0);
  const labels = markdownLabels[locale];
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      copyVersion.current += 1;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const copy = async () => {
    const version = ++copyVersion.current;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    try {
      await navigator.clipboard.writeText(content);
      if (!mountedRef.current || version !== copyVersion.current) return;
      setCopyState("copied");
      timerRef.current = window.setTimeout(() => setCopyState("idle"), 1800);
    } catch {
      if (mountedRef.current && version === copyVersion.current) setCopyState("failed");
    }
  };
  const copyLabel = copyState === "copied" ? labels.copied : labels.copy;

  return (
    <div className="md-code" dir="ltr">
      <div className="md-code-bar">
        <span>{lang || "code"}</span>
        <button type="button" onClick={copy} aria-label={copyLabel} title={copyLabel}>
          {copyState === "copied" ? <Check size={15} aria-hidden="true" /> : copyState === "failed" ? <AlertCircle size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
        </button>
      </div>
      <span className="md-copy-status" role="status" dir="auto" data-state={copyState}>
        {copyState === "failed" ? labels.failed : copyState === "copied" ? labels.copied : ""}
      </span>
      <pre tabIndex={0} aria-label={lang || "code"}>
        <code>{content}</code>
      </pre>
    </div>
  );
}

export const MarkdownLite = memo(function MarkdownLite({ text, locale = "fa" }: { text: string; locale?: Locale }) {
  const blocks = useMemo(() => parseBlocks(text), [text]);

  return (
    <div className="md-body">
      {blocks.map((block, index) => {
        const key = `b-${index}`;
        switch (block.kind) {
          case "code":
            return <CodeBlock key={key} lang={block.lang} content={block.content} locale={locale} />;
          case "heading": {
            const Tag = block.level <= 1 ? "h3" : block.level === 2 ? "h4" : "h5";
            return (
              <Tag className={`md-heading md-heading-${block.level}`} key={key}>
                {renderInline(block.text, key)}
              </Tag>
            );
          }
          case "list": {
            const Tag = block.ordered ? "ol" : "ul";
            return (
              <Tag className={`md-list ${block.ordered ? "md-ol" : "md-ul"}`} key={key} {...(block.ordered ? { start: block.start } : {})}>
                {block.items.map((item, itemIndex) => (
                  <li key={`${key}-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}`)}</li>
                ))}
              </Tag>
            );
          }
          case "table":
            return (
              <div className="md-table-wrap" key={key} role="region" tabIndex={0} aria-label={markdownLabels[locale].table}>
                <table className="md-table">
                  <thead><tr>{block.headers.map((cell, column) => (
                    <th scope="col" key={column} style={{ textAlign: block.align[column] }}>{renderInline(cell, `${key}-h-${column}`)}</th>
                  ))}</tr></thead>
                  <tbody>{block.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>{row.map((cell, column) => (
                      <td key={column} style={{ textAlign: block.align[column] }}>{renderInline(cell, `${key}-${rowIndex}-${column}`)}</td>
                    ))}</tr>
                  ))}</tbody>
                </table>
              </div>
            );
          case "quote":
            return (
              <blockquote className="md-quote" key={key}>
                {renderInline(block.text, key)}
              </blockquote>
            );
          case "hr":
            return <hr className="md-hr" key={key} />;
          default:
            return (
              <p className="md-p" key={key}>
                {renderInline(block.text, key)}
              </p>
            );
        }
      })}
    </div>
  );
});
