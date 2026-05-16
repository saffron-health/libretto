import { condenseDom } from "../condense-dom/condense-dom.js";

const DEFAULT_CONTEXT_LINES = 4;
const DEFAULT_MATCH_LIMIT = 8;

export type SearchHtmlMatch = {
  startLine: number;
  endLine: number;
  lines: string[];
};

export function formatHtmlForSearch(html: string): string {
  const condensed = condenseDom(html).html;
  const separated = condensed
    .replace(/>\s+</g, ">\n<")
    .replace(/(<[^/!][^>]*>)([^<\n][\s\S]*?)(<\/[^>]+>)/g, "$1\n$2\n$3");

  const lines = separated
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let indent = 0;
  return lines
    .map((line) => {
      if (/^<\//.test(line)) indent = Math.max(0, indent - 1);
      const formatted = `${"  ".repeat(indent)}${line}`;
      if (isOpeningTag(line)) indent += 1;
      return formatted;
    })
    .join("\n");
}

export function searchFormattedHtml(
  formattedHtml: string,
  pattern: string,
  contextLines = DEFAULT_CONTEXT_LINES,
  matchLimit = DEFAULT_MATCH_LIMIT,
): SearchHtmlMatch[] {
  const regex = new RegExp(pattern);
  const lines = formattedHtml.split("\n");
  const matchingIndexes = lines
    .map((line, index) => (regex.test(line) ? index : -1))
    .filter((index) => index >= 0)
    .slice(0, matchLimit);

  const matches: SearchHtmlMatch[] = [];
  for (const matchingIndex of matchingIndexes) {
    const startLine = Math.max(0, matchingIndex - contextLines);
    const endLine = Math.min(lines.length - 1, matchingIndex + contextLines);
    const previous = matches.at(-1);
    if (previous && startLine <= previous.endLine + 1) {
      previous.endLine = Math.max(previous.endLine, endLine + 1);
      previous.lines = lines.slice(previous.startLine - 1, previous.endLine);
      continue;
    }
    matches.push({
      startLine: startLine + 1,
      endLine: endLine + 1,
      lines: lines.slice(startLine, endLine + 1),
    });
  }
  return matches;
}

function isOpeningTag(line: string): boolean {
  return (
    /^<[^/!?][^>]*>$/.test(line) &&
    !/\/>$/.test(line) &&
    !/^<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)\b/i.test(
      line,
    ) &&
    !/^<[^>]+>.*<\/[^>]+>$/.test(line)
  );
}
