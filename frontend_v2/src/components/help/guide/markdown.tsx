// A small, safe markdown renderer for module guides: headings, paragraphs, lists, tables,
// quotes, bold, italics and inline code. Text is rendered as React text, never as HTML.

import * as React from "react";

function inline(text: string, key: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // No underscore emphasis: role codes and parameters (SUPER_ADMIN, ?lang=hi&page=x_y) keep their underscores.
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const token = match[0];
    const id = `${key}-${index++}`;
    if (token.startsWith("**")) parts.push(<strong key={id} className="font-semibold text-content-1">{token.slice(2, -2)}</strong>);
    else if (token.startsWith("`")) parts.push(<code key={id} className="rounded bg-surface-2 px-1 py-px font-mono text-[0.92em] text-content-1">{token.slice(1, -1)}</code>);
    else parts.push(<em key={id}>{token.slice(1, -1)}</em>);
    last = match.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

type Block =
  | { kind: "h"; level: number; text: string }
  | { kind: "p"; text: string }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "table"; rows: string[][] }
  | { kind: "code"; text: string };

function parse(source: string): Block[] {
  // Every line break form (\r\n, \r, Unicode line/paragraph separators) becomes \n, so each branch below
  // always consumes at least one line.
  const lines = String(source || "").replace(/\r\n?|\u2028|\u2029/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    if (line.trim().startsWith("```")) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) body.push(lines[i++]);
      i += 1;
      blocks.push({ kind: "code", text: body.join("\n") });
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: "h", level: heading[1].length, text: heading[2].trim() });
      i += 1;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        const cells = lines[i].trim().slice(1, -1).split("|").map((cell) => cell.trim());
        if (!cells.every((cell) => /^:?-{2,}:?$/.test(cell))) rows.push(cells);
        i += 1;
      }
      blocks.push({ kind: "table", rows });
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*]\s+/, ""));
      blocks.push({ kind: "ul", items });
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ""));
      blocks.push({ kind: "ol", items });
      continue;
    }
    if (line.startsWith(">")) {
      const body: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) body.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push({ kind: "quote", text: body.join(" ") });
      continue;
    }
    const body: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !/^\s*([-*]|\d+[.)])\s+/.test(lines[i]) &&
      !/^\s*\|.*\|\s*$/.test(lines[i]) &&
      !lines[i].startsWith(">") &&
      !lines[i].trim().startsWith("```")
    ) {
      body.push(lines[i++].trim());
    }
    blocks.push({ kind: "p", text: body.join(" ") });
  }
  return blocks;
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks = parse(source);
  return (
    <div className={className}>
      {blocks.map((block, index) => {
        const key = `b${index}`;
        switch (block.kind) {
          case "h": {
            const size = block.level <= 1 ? "text-[22px]" : block.level === 2 ? "text-[18px]" : block.level === 3 ? "text-[15.5px]" : "text-[14px]";
            return (
              <div key={key} role="heading" aria-level={Math.min(6, block.level + 1)} className={`mt-6 font-semibold tracking-[-0.01em] text-content-1 first:mt-0 ${size}`}>
                {inline(block.text, key)}
              </div>
            );
          }
          case "ul":
            return (
              <ul key={key} className="mt-2 list-disc space-y-1 pl-5 text-[14px] leading-6 text-content-2">
                {block.items.map((item, itemIndex) => (
                  <li key={`${key}-${itemIndex}`}>{inline(item, `${key}-${itemIndex}`)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={key} className="mt-2 list-decimal space-y-1 pl-5 text-[14px] leading-6 text-content-2">
                {block.items.map((item, itemIndex) => (
                  <li key={`${key}-${itemIndex}`}>{inline(item, `${key}-${itemIndex}`)}</li>
                ))}
              </ol>
            );
          case "quote":
            return (
              <p key={key} className="mt-3 rounded-[12px] border border-info-border bg-info-bg px-3.5 py-2.5 text-[13.5px] leading-6 text-content-1">
                {inline(block.text, key)}
              </p>
            );
          case "code":
            return (
              <pre key={key} className="mt-3 overflow-x-auto rounded-[12px] bg-surface-2 p-3 font-mono text-[12.5px] text-content-1">
                {block.text}
              </pre>
            );
          case "table": {
            const [head, ...body] = block.rows;
            return (
              <div key={key} className="mt-3 overflow-x-auto rounded-[12px] border border-line">
                <table className="w-full text-left text-[13px]">
                  {head ? (
                    <thead className="bg-surface-2 text-content-2">
                      <tr>
                        {head.map((cell, cellIndex) => (
                          <th key={cellIndex} className="px-3 py-2 font-semibold">{inline(cell, `${key}-h${cellIndex}`)}</th>
                        ))}
                      </tr>
                    </thead>
                  ) : null}
                  <tbody className="divide-y divide-line">
                    {body.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.map((cell, cellIndex) => (
                          <td key={cellIndex} className="px-3 py-2 align-top text-content-2">{inline(cell, `${key}-${rowIndex}-${cellIndex}`)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }
          default:
            return (
              <p key={key} className="mt-2.5 text-[14px] leading-6 text-content-2">
                {inline(block.text, key)}
              </p>
            );
        }
      })}
    </div>
  );
}
