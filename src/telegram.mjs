/**
 * Telegram — the first herald, and therefore the template for every other.
 *
 * It can do exactly two things: introduce itself and say something. That is
 * the whole contract of a herald, and it is deliberately smaller than a
 * connection's: a herald fetches nothing, reads nothing and writes back
 * nowhere.
 *
 * FOUR DECISIONS:
 *
 * TEXT ONLY, NO MARKDOWN. Telegram's `MarkdownV2` demands that a dozen
 * characters be escaped — the hyphen and the full stop among them. A card
 * title contains both almost always. Whoever formats here will one day send
 * `Bad Request: can't parse entities` instead of a message, and precisely
 * when it matters.
 *
 * NO PREVIEW. An address inside a title would otherwise drag someone else's
 * page into the channel.
 *
 * IT DOES NOT THROW. Every answer is `{ sent, reason }` — the move that
 * triggered the message must never notice any of it.
 *
 * THE KEY STANDS IN THE ADDRESS BUT NEVER IN THE LOG. Telegram builds its API
 * that way; we cannot change it, but we can clean every message coming from
 * it before it lands anywhere.
 */

const BASIS = 'https://api.telegram.org';

/** A key that ends up in a sentence by accident is made unreadable. */
export const withoutKey = (text) => String(text ?? '').replace(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g, 'bot…');

async function call(token, path, payload, fetchImpl) {
  const response = await fetchImpl(`${BASIS}/bot${token}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

/**
 * Which chats can this bot see? After a bot is invited into a group, Telegram
 * sends it a `my_chat_member` event — so being invited is enough, and nobody
 * has to copy a number out of anywhere.
 */
export async function chats({ token }, { fetchImpl = fetch } = {}) {
  if (!token) return { ok: false, reason: 'no key' };
  try {
    const { status, body } = await call(token, 'getUpdates',
      { allowed_updates: ['message', 'my_chat_member', 'channel_post'] }, fetchImpl);
    if (!body?.ok) return { ok: false, reason: withoutKey(body?.description ?? `HTTP ${status}`) };
    const found = new Map();
    for (const update of body.result ?? []) {
      const chat = (update.message ?? update.channel_post ?? update.my_chat_member ?? {}).chat;
      if (chat?.id) found.set(String(chat.id), { id: String(chat.id), kind: chat.type, name: chat.title ?? chat.first_name ?? '' });
    }
    return { ok: true, chats: [...found.values()] };
  } catch (error) {
    return { ok: false, reason: withoutKey(error.message) };
  }
}

/**
 * Do the credentials hold? Reads, changes nothing — the `verify()` from the
 * contract. The bot's name comes back so a person can see whom they just set
 * up.
 */
export async function verify({ token, chat = null }, { fetchImpl = fetch } = {}) {
  if (!token) return { ok: false, reason: 'no key' };
  try {
    const { status, body } = await call(token, 'getMe', {}, fetchImpl);
    if (status === 401) return { ok: false, reason: 'The key is not valid (401).' };
    if (!body?.ok) return { ok: false, reason: withoutKey(body?.description ?? `HTTP ${status}`) };
    return { ok: true, bot: body.result?.username ?? null, chat };
  } catch (error) {
    return { ok: false, reason: withoutKey(error.message) };
  }
}

/**
 * Say something. A herald can do no more, and should be able to do no more.
 *
 * Telegram's limit is 4096 characters; we cut at 3900 and put a mark behind
 * it rather than collecting a 400.
 */
export async function send({ token, chat }, text, { fetchImpl = fetch, html = false, preview = false } = {}) {
  if (!token || !chat) return { sent: false, reason: 'not set up' };
  const payload = {
    chat_id: chat,
    text: String(text).slice(0, 3900),
    disable_web_page_preview: !preview,
    // HTML, not MarkdownV2. Markdown wants a dozen characters escaped,
    // including the dot and the hyphen — a card title has both almost always,
    // and then you get `can't parse entities` instead of the message, exactly
    // when it matters. HTML needs three: & < >. Those we escape ourselves, in
    // src/report.mjs, and never anywhere else.
    ...(html ? { parse_mode: 'HTML' } : {}),
  };
  try {
    const { status, body } = await call(token, 'sendMessage', payload, fetchImpl);
    if (body?.ok) return { sent: true };
    // 429 is not an error, it is a request. We do NOT retry — a herald that
    // pushes again by itself clogs the channel it serves.
    if (status === 429) {
      return { sent: false, reason: `too fast, first in ${body?.parameters?.retry_after ?? '?'} s again` };
    }
    return { sent: false, reason: withoutKey(body?.description ?? `HTTP ${status}`) };
  } catch (error) {
    return { sent: false, reason: withoutKey(error.message) };
  }
}
