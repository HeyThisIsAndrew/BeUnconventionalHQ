/*
  ─── THE ONE RULE FOR A LOCAL CMS WRITE: NEVER BLANK THE STORE ──────────────

  `/api/local-cms/videos` and `/api/local-cms/articles` both POST a whole file
  and overwrite it. Their only guard was `JSON.parse(body)` inside a try/catch,
  which checks SYNTAX and nothing else - so every one of these was accepted and
  written verbatim:

      null      -> src/data/articles.json becomes the four bytes `null`
      []        -> src/data/videos.json loses all 211 documents
      {}        -> the store becomes an object the loaders cannot read
      "hi", 7   -> likewise

  All four were reproduced against a running dev server, not reasoned about.
  `[]` is the one that matters: it is valid JSON, it is the right TYPE, and it
  is exactly what a React editor holds when a fetch failed and its state
  initialised to an empty list. One POST and the store is gone.

  And gone is not recoverable by re-running the syncs. videos.json carries
  three classes of field (CLAUDE.md hard rule 5) and the EDITORIAL ones -
  featured, notes, hubCategory, brandColor, youtubeSyncKeywords - are seeded
  once and never overwritten by a sync, by design. A wipe takes them for good.

  So the contract this enforces is the same one the article sync already
  states: loud, non-fatal failure, and the store on disk is never the thing
  that pays for a bad request.

  Deliberately NOT enforced: how much a write may remove. Deleting an article
  is a thing an editor legitimately does, and a rule that guesses at intent
  would block real edits to catch a case the empty check already covers.
*/

/** @param {unknown} value */
function describe(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'object') return 'an object';
  return `a ${typeof value}`;
}

/**
 * Decides whether a POSTed body may overwrite a local content store.
 *
 * @param {string} raw           the request body, verbatim
 * @param {string} storeName     the file being written, for the error message
 * @returns {{ ok: true, parsed: unknown[] } | { ok: false, status: number, error: string }}
 */
export function validateStorePayload(raw, storeName) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, status: 400, error: `Invalid JSON, ${storeName} left untouched.` };
  }

  if (!Array.isArray(parsed)) {
    return {
      ok: false,
      status: 400,
      error: `Expected an array of documents, got ${describe(parsed)}. ${storeName} left untouched.`,
    };
  }

  if (parsed.length === 0) {
    return {
      ok: false,
      status: 400,
      error:
        `Refusing to write an empty array: that would blank ${storeName}, and the ` +
        'editorial fields in it are seeded once and never restored by a sync. ' +
        'Left untouched.',
    };
  }

  return { ok: true, parsed };
}
