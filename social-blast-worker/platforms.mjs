/**
 * The live publishers (issue #282). Official APIs only:
 *   Bluesky    AT Protocol (createSession, uploadBlob, createRecord)
 *   Threads    Threads API, two-step container then publish
 *   Facebook   Graph API, POST /{page-id}/feed
 *   Instagram  Instagram Content Publishing API, image container then publish
 *   X, Substack Notes  Buffer's GraphQL API (createPost, shareNow): X charges
 *              per post and Substack has no public posting API, and Buffer is
 *              an official partner of both. Free plan: 3 channels.
 *
 * Each publisher takes ({ item, text, env, fetchImpl, getImage, session }) and
 * returns { id, url }, or throws a PostError. `maybePosted` on the error says
 * whether the platform might have published anyway (the final request was
 * sent and no answer came back): the engine never retries those, because a
 * missing post is fixed by hand in a minute and a duplicate is public.
 *
 * Meta's documented calls carry the token as an `access_token` parameter, so
 * that is how they are sent. No URL is ever logged, and every error message is
 * scrubbed of every secret before it leaves this module.
 */

export class PostError extends Error {
  constructor(message, { maybePosted = false, status = null } = {}) {
    super(message);
    this.name = 'PostError';
    this.maybePosted = maybePosted;
    this.status = status;
  }
}

const TIMEOUT_MS = 20000;
/** Bluesky's lexicon caps a link-card thumbnail at 1,000,000 bytes. */
export const BLUESKY_THUMB_MAX_BYTES = 1000000;

/** Removes every configured secret from a string before it is logged or emailed. */
export function scrub(text, env) {
  let out = String(text ?? '');
  for (const key of ['BLUESKY_APP_PASSWORD', 'THREADS_ACCESS_TOKEN', 'FB_PAGE_ACCESS_TOKEN', 'IG_ACCESS_TOKEN', 'BUFFER_API_KEY', 'RESEND_API_KEY', 'WEBSUB_SECRET']) {
    const value = env?.[key];
    if (value && value.length >= 6) out = out.split(value).join('[redacted]');
  }
  for (const value of env?.__extraSecrets ?? []) {
    if (value && value.length >= 6) out = out.split(value).join('[redacted]');
  }
  return out.slice(0, 600);
}

/**
 * One HTTP call. `final` marks the request that actually publishes: if it
 * fails without a response, the post may exist, so the error says so.
 */
async function call(fetchImpl, url, init, { env, label, final = false }) {
  let response;
  try {
    response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new PostError(scrub(`${label}: ${error?.message ?? error}`, env), { maybePosted: final });
  }
  const body = await response.text();
  let json = null;
  try { json = body ? JSON.parse(body) : null; } catch { /* not JSON */ }
  if (!response.ok) {
    const detail = json?.error?.message ?? json?.message ?? json?.error ?? body;
    throw new PostError(scrub(`${label}: HTTP ${response.status} ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`, env), {
      status: response.status,
    });
  }
  return json ?? {};
}

const form = (fields) => new URLSearchParams(Object.entries(fields).filter(([, v]) => v !== undefined && v !== null));

// ─── Bluesky ────────────────────────────────────────────────────────────

const encoder = new TextEncoder();
const byteLength = (s) => encoder.encode(s).length;

/**
 * Rich-text facets. Bluesky does not linkify plain text: a URL or #tag is
 * only clickable with a facet giving its UTF-8 BYTE range.
 */
export function blueskyFacets(text) {
  const facets = [];
  const add = (match, index, feature) => {
    const byteStart = byteLength(text.slice(0, index));
    facets.push({ index: { byteStart, byteEnd: byteStart + byteLength(match) }, features: [feature] });
  };
  for (const m of text.matchAll(/https?:\/\/[^\s]+/g)) {
    const uri = m[0].replace(/[.,;:!?)]+$/, '');
    add(uri, m.index, { $type: 'app.bsky.richtext.facet#link', uri });
  }
  for (const m of text.matchAll(/(^|\s)#([\p{L}\p{N}_]+)/gu)) {
    const index = m.index + m[1].length;
    add(`#${m[2]}`, index, { $type: 'app.bsky.richtext.facet#tag', tag: m[2] });
  }
  return facets;
}

export async function blueskySession(env, fetchImpl) {
  const service = env.BLUESKY_SERVICE || 'https://bsky.social';
  const session = await call(fetchImpl, `${service}/xrpc/com.atproto.server.createSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: env.BLUESKY_IDENTIFIER, password: env.BLUESKY_APP_PASSWORD }),
  }, { env, label: 'Bluesky sign-in' });
  if (!session.accessJwt || !session.did) throw new PostError('Bluesky sign-in: no session returned');
  return { service, accessJwt: session.accessJwt, did: session.did };
}

export async function postBluesky({ item, text, env, fetchImpl, getImage, session }) {
  const s = session ?? await blueskySession(env, fetchImpl);
  const auth = { Authorization: `Bearer ${s.accessJwt}` };
  const external = { uri: item.link, title: item.title, description: item.summary ?? '' };
  // The card's picture is the composed 1200x675 dispatch image. A card with
  // no thumbnail still links correctly, so a missing image never blocks a post.
  const image = await getImage?.(item.imageUrl).catch(() => null);
  if (image && image.bytes.byteLength <= BLUESKY_THUMB_MAX_BYTES) {
    const uploaded = await call(fetchImpl, `${s.service}/xrpc/com.atproto.repo.uploadBlob`, {
      method: 'POST', headers: { ...auth, 'Content-Type': image.type || 'image/jpeg' }, body: image.bytes,
    }, { env, label: 'Bluesky image upload' });
    if (uploaded.blob) external.thumb = uploaded.blob;
  }
  const record = {
    $type: 'app.bsky.feed.post',
    text,
    createdAt: new Date().toISOString(),
    langs: ['en'],
    embed: { $type: 'app.bsky.embed.external', external },
  };
  const facets = blueskyFacets(text);
  if (facets.length) record.facets = facets;
  const created = await call(fetchImpl, `${s.service}/xrpc/com.atproto.repo.createRecord`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo: s.did, collection: 'app.bsky.feed.post', record }),
  }, { env, label: 'Bluesky post', final: true });
  const rkey = String(created.uri ?? '').split('/').pop();
  return { id: created.uri ?? null, url: rkey ? `https://bsky.app/profile/${s.did}/post/${rkey}` : null };
}

// ─── Threads ────────────────────────────────────────────────────────────

const THREADS_API = 'https://graph.threads.net/v1.0';

/**
 * A TEXT post with `link_attachment`, which Threads renders as a preview
 * card. An IMAGE post would show the picture but make the link plain text
 * with no card, and the card is what people tap.
 */
export async function postThreads({ item, text, env, fetchImpl, token, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const accessToken = token || env.THREADS_ACCESS_TOKEN;
  const user = env.THREADS_USER_ID;
  const container = await call(fetchImpl, `${THREADS_API}/${user}/threads`, {
    method: 'POST',
    body: form({ media_type: 'TEXT', text, link_attachment: item.link, access_token: accessToken }),
  }, { env, label: 'Threads container' });
  if (!container.id) throw new PostError('Threads container: no id returned');
  // Text containers are usually ready at once; wait briefly if not.
  for (let attempt = 0; attempt < 5; attempt++) {
    const status = await call(fetchImpl, `${THREADS_API}/${container.id}?${form({ fields: 'status,error_message', access_token: accessToken })}`, {},
      { env, label: 'Threads container status' });
    if (status.status === 'FINISHED' || !status.status) break;
    if (status.status === 'ERROR' || status.status === 'EXPIRED') {
      throw new PostError(scrub(`Threads container ${status.status}: ${status.error_message ?? ''}`, env));
    }
    if (attempt === 4) throw new PostError('Threads container never finished processing');
    await sleep(3000);
  }
  const published = await call(fetchImpl, `${THREADS_API}/${user}/threads_publish`, {
    method: 'POST', body: form({ creation_id: container.id, access_token: accessToken }),
  }, { env, label: 'Threads publish', final: true });
  let url = null;
  try {
    const meta = await call(fetchImpl, `${THREADS_API}/${published.id}?${form({ fields: 'permalink', access_token: accessToken })}`, {},
      { env, label: 'Threads permalink' });
    url = meta.permalink ?? null;
  } catch { /* the post is up; the link is a nicety */ }
  return { id: published.id ?? null, url };
}

/**
 * Long-lived Threads tokens last 60 days and can be refreshed once they are
 * a day old. Returns { token, expiresIn }.
 */
export async function refreshThreadsToken(token, env, fetchImpl) {
  const result = await call(fetchImpl, `https://graph.threads.net/refresh_access_token?${form({ grant_type: 'th_refresh_token', access_token: token })}`, {},
    { env: { ...env, __extraSecrets: [token] }, label: 'Threads token refresh' });
  if (!result.access_token) throw new PostError('Threads token refresh: no token returned');
  return { token: result.access_token, expiresIn: Number(result.expires_in) || null };
}

// ─── Facebook Page ──────────────────────────────────────────────────────

export async function postFacebook({ item, text, env, fetchImpl }) {
  const version = env.GRAPH_API_VERSION || 'v24.0';
  const created = await call(fetchImpl, `https://graph.facebook.com/${version}/${env.FB_PAGE_ID}/feed`, {
    method: 'POST', body: form({ message: text, link: item.link, access_token: env.FB_PAGE_ACCESS_TOKEN }),
  }, { env, label: 'Facebook post', final: true });
  return { id: created.id ?? null, url: created.id ? `https://www.facebook.com/${created.id}` : null };
}

// ─── Instagram ──────────────────────────────────────────────────────────

/**
 * A single-image feed post: the composed 1200x675 dispatch image (16:9 sits
 * inside Instagram's 1.91:1 limit; JPEG, the only format it accepts) with the
 * text as its caption. Meta FETCHES the image from its URL, so it must be
 * public. Captions cannot carry links, so the URL in the text is plain.
 * IG_GRAPH_HOST is graph.facebook.com for an account connected through a
 * Facebook Page (the same Meta app as Threads and Facebook), or
 * graph.instagram.com for Instagram Login.
 */
export async function postInstagram({ item, text, env, fetchImpl, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  if (!/^https:\/\//.test(item.imageUrl ?? '')) throw new PostError('Instagram: the story has no image to post');
  const base = `https://${env.IG_GRAPH_HOST || 'graph.facebook.com'}/${env.GRAPH_API_VERSION || 'v24.0'}`;
  const token = env.IG_ACCESS_TOKEN;
  const container = await call(fetchImpl, `${base}/${env.IG_USER_ID}/media`, {
    method: 'POST', body: form({ image_url: item.imageUrl, caption: text, access_token: token }),
  }, { env, label: 'Instagram container' });
  if (!container.id) throw new PostError('Instagram container: no id returned');
  for (let attempt = 0; attempt < 6; attempt++) {
    const status = await call(fetchImpl, `${base}/${container.id}?${form({ fields: 'status_code', access_token: token })}`, {},
      { env, label: 'Instagram container status' });
    if (status.status_code === 'FINISHED' || !status.status_code) break;
    if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') {
      throw new PostError(`Instagram container ${status.status_code}: Meta could not use the image (is it public?)`);
    }
    if (attempt === 5) throw new PostError('Instagram container never finished processing');
    await sleep(3000);
  }
  const published = await call(fetchImpl, `${base}/${env.IG_USER_ID}/media_publish`, {
    method: 'POST', body: form({ creation_id: container.id, access_token: token }),
  }, { env, label: 'Instagram publish', final: true });
  let url = null;
  try {
    const meta = await call(fetchImpl, `${base}/${published.id}?${form({ fields: 'permalink', access_token: token })}`, {},
      { env, label: 'Instagram permalink' });
    url = meta.permalink ?? null;
  } catch { /* the post is up; the link is a nicety */ }
  return { id: published.id ?? null, url };
}

// ─── Buffer (X, Substack Notes) ─────────────────────────────────────────

export const BUFFER_API = 'https://api.buffer.com';

const CREATE_POST = 'mutation CreatePost($input: CreatePostInput!) { createPost(input: $input) { __typename ... on PostActionSuccess { post { id } } ... on MutationError { message } } }';

/**
 * One `createPost` on a Buffer channel, published at once (`shareNow`).
 * Checked against Buffer's schema (2026-11-07 audit, two independent reads):
 * `CreatePostInput` declares `assets` non-null with a default of [], sent
 * explicitly anyway; `needsApproval` defaults to false and is "only valid
 * when your posting policy on the target channel requires approval", so it
 * is left out.
 * Buffer answers HTTP 200 even for a refused post: the refusal is a
 * MutationError in the body, so the body is always read. `metadata` carries
 * a service's link attachment (Substack); X builds its own card from the URL
 * in the text. Buffer returns its post id, not the platform's, so the report
 * links to Buffer's dashboard rather than the post. "Created" means queued
 * for immediate posting, not confirmed delivered.
 */
export async function postBuffer({ text, env, fetchImpl, channelId, label, metadata }) {
  const input = { text, channelId, schedulingType: 'automatic', mode: 'shareNow', assets: [] };
  if (metadata) input.metadata = metadata;
  const result = await call(fetchImpl, BUFFER_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.BUFFER_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: CREATE_POST, variables: { input } }),
  }, { env, label, final: true });
  if (result.errors?.length) throw new PostError(scrub(`${label}: ${result.errors.map((e) => e.message).join('; ')}`, env));
  const outcome = result.data?.createPost;
  if (outcome?.post?.id) return { id: outcome.post.id, url: 'https://publish.buffer.com', via: 'buffer' };
  throw new PostError(scrub(`${label}: ${outcome?.message ?? 'Buffer did not create the post'}`, env));
}

export const postX = (args) => postBuffer({ ...args, channelId: args.env.BUFFER_X_CHANNEL_ID, label: 'X via Buffer' });
/**
 * A Substack Note with the story as a link card. A raw URL in the text is not
 * documented to become a card, so the link goes in Buffer's
 * `metadata.substack.linkAttachment` (allowed because `assets` is empty) and
 * the text carries no URL (copy-engine CARD_PLATFORMS).
 */
export const postSubstack = (args) => {
  const linkAttachment = { url: args.item.link, title: args.item.title };
  if (args.item.summary) linkAttachment.description = args.item.summary;
  return postBuffer({ ...args, channelId: args.env.BUFFER_SUBSTACK_CHANNEL_ID, label: 'Substack Note via Buffer', metadata: { substack: { linkAttachment } } });
};

/**
 * Which credentials each live platform needs. A platform missing any is
 * reported, never attempted. The Buffer channel ids are plain vars in
 * wrangler.jsonc (not secret); the key is a secret.
 */
export const PLATFORM_SECRETS = {
  bluesky: ['BLUESKY_IDENTIFIER', 'BLUESKY_APP_PASSWORD'],
  threads: ['THREADS_USER_ID', 'THREADS_ACCESS_TOKEN'],
  facebook: ['FB_PAGE_ID', 'FB_PAGE_ACCESS_TOKEN'],
  instagram: ['IG_USER_ID', 'IG_ACCESS_TOKEN'],
  x: ['BUFFER_API_KEY', 'BUFFER_X_CHANNEL_ID'],
  substack: ['BUFFER_API_KEY', 'BUFFER_SUBSTACK_CHANNEL_ID'],
};

export const PUBLISHERS = { bluesky: postBluesky, threads: postThreads, facebook: postFacebook, instagram: postInstagram, x: postX, substack: postSubstack };
