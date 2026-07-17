// Team Hub stores card descriptions as rich text (HTML). These helpers
// convert between that and the plain text the rest of the app works with.

const TAG_PATTERN = /<[a-z][a-z0-9]*(\s[^>]*)?>/i;

export function isHtml(content: string): boolean {
  return TAG_PATTERN.test(content);
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

function decodeEntities(text: string): string {
  return text.replace(/&[a-z#0-9]+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? entity);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Reduce an HTML description to readable plain text: paragraph and line
// breaks become newlines, tags are dropped, entities are decoded.
export function htmlToText(content: string): string {
  if (!isHtml(content)) return content;
  const text = content
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(text).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Append plain-text lines to a card description, matching its format:
// HTML descriptions get paragraphs, plain ones get newlines.
export function appendToContent(content: string, lines: string[]): string {
  if (isHtml(content)) {
    const paragraphs = lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('');
    return content + paragraphs;
  }
  const base = content.trimEnd();
  const addition = lines.join('\n');
  return base ? `${base}\n${addition}` : addition;
}

// Build the description for a card the app creates. Written as HTML so it
// renders as tidy paragraphs in Team Hub.
export function buildHtmlContent(lines: string[]): string {
  return lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('');
}

// Find URLs in a description: href attributes first (rich text links),
// then any bare URLs in the visible text.
export function extractUrls(content: string): string[] {
  const urls: string[] = [];
  for (const match of content.matchAll(/href="([^"]+)"/gi)) {
    urls.push(decodeEntities(match[1]));
  }
  for (const match of htmlToText(content).matchAll(/https?:\/\/[^\s)<>"]+/gi)) {
    urls.push(match[0]);
  }
  return [...new Set(urls)];
}
