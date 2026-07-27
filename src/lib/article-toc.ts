/**
 * Table-of-contents builder for article pages.
 *
 * ─── WHY IT WORKS ON A STRING ─────────────────────────────────────────────
 * The article body is sanitized HTML stored in the snapshot. There is no DOM
 * at build time, so this reads the headings with a regular expression rather
 * than parsing. That is normally a bad idea for HTML — but this input is not
 * arbitrary: it has already been through sanitize-html against a strict
 * allowlist, so the heading tags are known-simple (`<h2>` / `<h3>`, no
 * attributes beyond what we add ourselves).
 *
 * ─── WHAT IT RETURNS ──────────────────────────────────────────────────────
 * Entries plus a rewritten body. Each heading gains an `id`, and each entry
 * points at it, so clicking a ToC link anchor-scrolls to that section. Ids are
 * de-duplicated because two sections can legitimately share a title.
 */

export interface TocEntry {
  /** The heading's anchor id. */
  id: string;
  /** The heading's visible text. */
  text: string;
  /** 2 or 3 — used to indent h3s under their h2. */
  level: number;
}

/** Strip tags and entities from a heading's inner HTML. */
function plain(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** URL-safe anchor id from heading text. */
function toId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function buildToc(bodyHtml: string): { entries: TocEntry[]; html: string } {
  if (!bodyHtml) return { entries: [], html: '' };

  const entries: TocEntry[] = [];
  const used = new Set<string>();

  const html = bodyHtml.replace(
    /<h([23])([^>]*)>([\s\S]*?)<\/h\1>/gi,
    (match, levelRaw: string, attrs: string, inner: string) => {
      const text = plain(inner);
      if (!text) return match;

      // De-duplicate: two sections may share a heading, and duplicate ids
      // would make the second anchor unreachable.
      const base = toId(text) || `section-${entries.length + 1}`;
      let id = base;
      let n = 2;
      while (used.has(id)) id = `${base}-${n++}`;
      used.add(id);

      entries.push({ id, text, level: Number(levelRaw) });

      // Don't clobber an id the body already carries.
      if (/\bid=/.test(attrs)) return match;
      return `<h${levelRaw}${attrs} id="${id}">${inner}</h${levelRaw}>`;
    },
  );

  return { entries, html };
}
