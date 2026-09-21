/** OIDC sign-in through the installation's identity provider, with PKCE, state
 * and nonce. GitHub can be offered by that provider; repository credentials
 * stay separate from login. No account from the hosted Gradula is required. */

import { createHmac, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export const SESSION = '__Host-gradula';
export const ATTEMPT = '__Host-gradula-attempt';
const DAYS = 7;

const b64 = (buf) => Buffer.from(buf).toString('base64url');

export function cookiesOf(req) {
  return Object.fromEntries(
    String(req.headers?.cookie ?? '')
      .split(';')
      .map((part) => { const i = part.indexOf('='); return i < 0 ? null : [part.slice(0, i).trim(), part.slice(i + 1).trim()]; })
      .filter(Boolean),
  );
}

const sign = (secret, text) => createHmac('sha256', secret).update(text).digest('base64url');

/** Equal or not — without giving the length away. */
function same(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * A note: `<payload>.<signature>`. The payload is readable — it sits in the
 * browser of the person it belongs to anyway. It cannot be forged, and that
 * is what matters.
 */
export function mintSession(secret, { sub, name, roles, until }) {
  const payload = b64(JSON.stringify({ sub, name, roles, until }));
  return `${payload}.${sign(secret, payload)}`;
}

export function readSession(secret, value, now = Date.now()) {
  const raw = String(value ?? '');
  const dot = raw.lastIndexOf('.');
  if (dot < 1) return null;
  const payload = raw.slice(0, dot);
  if (!same(raw.slice(dot + 1), sign(secret, payload))) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    // The field was named `until` before this repository spoke English. A note
    // already in somebody's browser still carries the old name, and rejecting
    // it would sign every signed-in person out for a rename.
    const until = Number.isFinite(session?.until) ? session.until : session?.until;
    if (!session?.sub || !Number.isFinite(until) || until <= now) return null;
    return { ...session, until };
  } catch {
    return null;
  }
}

/**
 * The roles from a Zitadel token. They stand under a name with colons, and
 * every role is an object naming the organizations it holds in — for us it is
 * enough THAT it holds.
 */
export const ROLLEN_CLAIM = 'urn:zitadel:iam:org:project:roles';

/**
 * Read roles from a token — at ANY provider, not only at Zitadel.
 *
 * There is no standard for it. Zitadel puts an object under a long name and
 * means its KEYS; Keycloak puts a list under `realm_access.roles`; others
 * write `groups` or a string with spaces in it. Whoever hard-wires one of
 * these forms has not built a tool but one for exactly one company — and that
 * was precisely the reason this line became soft.
 *
 * The path may lead through nested objects (`realm_access.roles`). But the
 * whole name is tried as a key first: names like `https://firm.com/roles`
 * contain dots themselves, and a path that splits them finds nothing.
 */
export function rolesOf(claims, path = ROLLEN_CLAIM) {
  let raw = claims?.[path];
  if (raw === undefined && String(path).includes('.')) {
    raw = String(path).split('.').reduce((where, part) => (where == null ? undefined : where[part]), claims);
  }
  if (Array.isArray(raw)) return raw.filter((r) => typeof r === 'string');
  if (typeof raw === 'string') return raw.split(/[\s,]+/).filter(Boolean);
  if (raw && typeof raw === 'object') return Object.keys(raw);
  return [];
}

/** An attempt: the verifier for PKCE and where it goes back to afterwards. */
export function mintAttempt(secret, { verifier, target, until, state, nonce }) {
  return mintSession(secret, { sub: 'attempt', name: target, roles: [verifier, state, nonce], until });
}
export function readAttempt(secret, value, now = Date.now()) {
  const note = readSession(secret, value, now);
  if (!note || note.sub !== 'attempt') return null;
  return { verifier: note.roles?.[0], target: note.name, ...(note.roles?.[1] ? {state:note.roles[1],nonce:note.roles[2]} : {}) };
}

export const challengeOf = (verifier) => createHash('sha256').update(verifier).digest('base64url');

const cookie = (name, value, { maxAge, secure = true }) =>
  `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;

/**
 * The door. `null` when it is not set up — a service without a sign-in is an
 * honest position (the machines still come in), a door without configuration
 * would be a hole.
 */
export function createAuth({ issuer, clientId, audience, secret, origin, role = 'dev', rollenClaim = ROLLEN_CLAIM, secure = true, jwks, scope, clientSecret, fetchImpl = fetch } = {}) {
  if (!issuer || !clientId || !secret || !origin) return null;
  if (String(secret).length < 32) throw new Error('GRADULA_SESSION_SECRET needs 32+ characters');

  const base = String(issuer).replace(/\/+$/, '');
  const backTo = `${String(origin).replace(/\/+$/, '')}/auth`;
  let discovery, keys = jwks;
  const endpoint = value => {
    const url = new URL(value);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) throw Error('OIDC endpoints require HTTPS (except loopback development).');
    return url.href;
  };
  endpoint(base); endpoint(origin);
  const metadata = async () => {
    if (!discovery) discovery = (async () => {
      const res = await fetchImpl(`${base}/.well-known/openid-configuration`, {signal:AbortSignal.timeout(10000),redirect:'error'});
      if (!res.ok) throw Error(`OIDC discovery failed (${res.status})`);
      const doc = await res.json();
      if (typeof doc.issuer !== 'string' || doc.issuer.replace(/\/+$/, '') !== base) throw Error('OIDC discovery issuer mismatch');
      for (const field of ['authorization_endpoint','token_endpoint','jwks_uri']) endpoint(doc[field]);
      keys ??= createRemoteJWKSet(new URL(doc.jwks_uri));
      return doc;
    })().catch(error => {discovery = null; throw error;});
    return discovery;
  };
  const sessionName = secure ? SESSION : 'gradula-local';
  const attemptName = secure ? ATTEMPT : 'gradula-attempt-local';

  return {
    role,
    backTo,
    attemptName,

    /** The beginning: a verifier, a cookie, an address at Zitadel. */
    async start(target = '/') {
      const endpoints = await metadata();
      const state=b64(randomBytes(32)),nonce=b64(randomBytes(32));
      if (!target.startsWith('/') || target.startsWith('//') || target.includes('\\')) target='/';
      const verifier = b64(randomBytes(32));
      const until = Date.now() + 10 * 60_000;
      const suche = new URLSearchParams({
        client_id: clientId,
        redirect_uri: backTo,
        response_type: 'code',
        scope: scope || `openid profile email${audience ? ` urn:zitadel:iam:org:project:id:${audience}:aud` : ''}`,
        state, nonce,
        code_challenge: challengeOf(verifier),
        code_challenge_method: 'S256',
      });
      return {
        ort: `${endpoints.authorization_endpoint}?${suche}`,
        cookie: cookie(attemptName, mintAttempt(secret, { verifier, target, until, state, nonce }), { maxAge: 600, secure }),
      };
    },

    /** The way back: code for token, check the token, issue the note. */
    async finish(code, attemptCookie, { state, fetchImpl: exchange = fetchImpl } = {}) {
      const attempt = readAttempt(secret, attemptCookie);
      if (!attempt?.verifier || !attempt.state || !state || !same(state,attempt.state)) throw new Error('The sign-in attempt is missing, expired or has mismatched state.');
      const endpoints=await metadata();

      const res = await exchange(endpoints.token_endpoint, {
        signal:AbortSignal.timeout(10000),redirect:'error',
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: backTo,
          client_id: clientId,
          code_verifier: attempt.verifier,
          ...(clientSecret ? {client_secret:clientSecret} : {}),
        }),
      });
      if (!res.ok) throw new Error(`Identity provider answers ${res.status} on the exchange.`);
      const token = await res.json();
      if (!token.id_token) throw new Error('Identity provider sent no id_token.');

      const { payload } = await jwtVerify(token.id_token, keys, { issuer: endpoints.issuer, audience: clientId });
      if (!payload.sub || !attempt.nonce || payload.nonce !== attempt.nonce) throw Error('OIDC nonce mismatch');
      const roles = rolesOf(payload, rollenClaim);
      if (!roles.includes(role)) {
        const refusal = new Error(`Gradula needs the role "${role}".`);
        refusal.code = 'no-role';
        throw refusal;
      }

      const until = Date.now() + DAYS * 86_400_000;
      return {
        target: attempt.target || '/',
        session: { sub: payload.sub, name: payload.name ?? payload.preferred_username ?? payload.email ?? 'someone', roles, until },
        cookies: [
          cookie(sessionName, mintSession(secret, { sub: payload.sub, name: payload.name ?? payload.preferred_username ?? payload.email ?? 'someone', roles, until }), { maxAge: DAYS * 86_400, secure }),
          `${attemptName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`,
        ],
      };
    },

    /** Who is knocking? `null` for nobody, or for an expired note. */
    who(req) {
      return readSession(secret, cookiesOf(req)[sessionName]);
    },

    signOut() {
      return `${sessionName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
    },
  };
}
