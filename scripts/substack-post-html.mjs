/** Read data, never execute the JavaScript surrounding it. */
export function parsePostHtml(html) {
  for (const [, attrs, contents] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (/\bid\s*=\s*(["'])preloads-json\1/i.test(attrs)) {
      const data = JSON.parse(contents);
      if (!data?.post) throw new Error('preloads-json has no post');
      return data.post;
    }
  }

  // Older Substack pages embed a JSON string literal in JSON.parse("...").
  // Track escapes rather than guessing where that literal ends. In particular,
  // a closing quote after an EVEN number of backslashes is not escaped.
  const match = /window\._preloads\s*=\s*JSON\.parse\(\s*(")/.exec(html);
  if (match) {
    const start = match.index + match[0].length - 1;
    let escaped = false;
    for (let i = start + 1; i < html.length; i++) {
      if (escaped) { escaped = false; continue; }
      if (html[i] === '\\') { escaped = true; continue; }
      if (html[i] !== '"') continue;
      const data = JSON.parse(JSON.parse(html.slice(start, i + 1)));
      if (!data?.post) throw new Error('legacy preloads has no post');
      return data.post;
    }
  }
  throw new Error('No supported Substack post payload (expected script#preloads-json or legacy preloads)');
}

