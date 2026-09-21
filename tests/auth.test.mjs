/**
 * The sign-in, as far as it can be checked without Zitadel: the note, the
 * roles, the attempt. The exchange itself needs a foreign instance and is
 * therefore not here — what stands here is what WE could get wrong.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mintSession, readSession, mintAttempt, readAttempt, rolesOf, challengeOf, createAuth, cookiesOf } from '../src/auth.mjs';

const SECRET = 'a-secret-with-more-than-thirty-two-characters';

test('a note holds only with its own signature', () => {
  const until = Date.now() + 60_000;
  const note = mintSession(SECRET, { sub: 'u1', name: 'David', roles: ['dev'], until });
  assert.equal(readSession(SECRET, note).name, 'David');
  assert.equal(readSession('another-secret-that-is-long-enough-too', note), null, 'another hand does not sign it');
  assert.equal(readSession(SECRET, `${note}x`), null, 'one character more is another note');
});

test('an expired note does not hold', () => {
  const note = mintSession(SECRET, { sub: 'u1', name: 'David', roles: [], until: Date.now() - 1 });
  assert.equal(readSession(SECRET, note), null);
});

test('the payload is readable but not forgeable', () => {
  const note = mintSession(SECRET, { sub: 'u1', name: 'David', roles: ['dev'], until: Date.now() + 60_000 });
  const [payload] = note.split('.');
  const gefaelscht = Buffer.from(JSON.stringify({ sub: 'u1', name: 'Felix', roles: ['beta-admin'], until: Date.now() + 60_000 })).toString('base64url');
  assert.notEqual(payload, gefaelscht);
  assert.equal(readSession(SECRET, `${gefaelscht}.${note.split('.')[1]}`), null, 'foreign payload, old signature');
});

test('an attempt carries the verifier and the destination', () => {
  const attempt = mintAttempt(SECRET, { verifier: 'abc', target: '/cards', until: Date.now() + 60_000 });
  assert.deepEqual(readAttempt(SECRET, attempt), { verifier: 'abc', target: '/cards' });
  const note = mintSession(SECRET, { sub: 'u1', name: 'x', roles: [], until: Date.now() + 60_000 });
  assert.equal(readAttempt(SECRET, note), null, 'a session is not an attempt');
});

test("the roles come out of Zitadel's field with the colons", () => {
  assert.deepEqual(rolesOf({ 'urn:zitadel:iam:org:project:roles': { dev: {}, beta: {} } }), ['dev', 'beta']);
  assert.deepEqual(rolesOf({}), []);
});

test('the roles come from ANY provider, not only from Zitadel', () => {
  // Four providers, four shapes, one reader. Whoever hard-wires the Zitadel
  // shape builds a tool for exactly one company.
  assert.deepEqual(
    rolesOf({ realm_access: { roles: ['dev', 'admin'] } }, 'realm_access.roles'),
    ['dev', 'admin'],
    'Keycloak: a list behind a path',
  );
  assert.deepEqual(rolesOf({ groups: ['dev'] }, 'groups'), ['dev'], 'Authentik/Entra: a plain list');
  assert.deepEqual(rolesOf({ roles: 'dev admin' }, 'roles'), ['dev', 'admin'], 'a string with spaces');
  assert.deepEqual(
    rolesOf({ 'https://firma.de/roles': ['dev'] }, 'https://firma.de/roles'),
    ['dev'],
    'a name with dots in it is NOT split into a path',
  );
  assert.deepEqual(rolesOf({ realm_access: {} }, 'realm_access.roles'), [], 'a path that leads nowhere is no role');
  assert.deepEqual(rolesOf({ a: { b: 1 } }, 'a.b.c.d'), [], 'a path into nothing is no role');
});

test('the challenge is the fingerprint of the verifier', () => {
  assert.equal(challengeOf('abc'), 'ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0');
});

test('without configuration there is no door', () => {
  assert.equal(createAuth({}), null);
  assert.throws(() => createAuth({ issuer: 'https://a', clientId: '1', audience: '2', secret: 'kurz', origin: 'https://b' }), /32\+/);
});

test('the beginning discovers endpoints and lays an attempt cookie', async () => {
  const auth = createAuth({ issuer: 'https://auth.example/', clientId: 'client-1', audience: 'project-9', secret: SECRET, origin: 'https://gradula.example', fetchImpl:async()=>({ok:true,json:async()=>({issuer:'https://auth.example',authorization_endpoint:'https://auth.example/authorize',token_endpoint:'https://auth.example/token',jwks_uri:'https://auth.example/keys'})}) });
  const { ort, cookie } = await auth.start('/tafel');
  const url = new URL(ort);
  assert.equal(url.origin + url.pathname, 'https://auth.example/authorize');
  assert.equal(url.searchParams.get('client_id'), 'client-1');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://gradula.example/auth');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.match(url.searchParams.get('scope'), /urn:zitadel:iam:org:project:id:project-9:aud/);
  assert.match(cookie, /^__Host-gradula-attempt=.+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=600; Secure$/);
  assert.equal(readAttempt(SECRET, cookie.split('=')[1].split(';')[0]).target, '/tafel');
});

test('cookies are read, several of them too', () => {
  assert.deepEqual(cookiesOf({ headers: { cookie: 'a=1; __Host-gradula=xy; b=2' } })['__Host-gradula'], 'xy');
  assert.deepEqual(cookiesOf({ headers: {} }), {});
});

test('generic OIDC verifies state, nonce, issuer and roles; local cookies work without __Host prefix', async () => {
 const {generateKeyPair,SignJWT,createLocalJWKSet,exportJWK}=await import('jose');
 const {privateKey,publicKey}=await generateKeyPair('RS256');const jwks=createLocalJWKSet({keys:[await exportJWK(publicKey)]});
 let idToken,exchanges=0;
 const fetchImpl=async url=>url.includes('openid-configuration')?{ok:true,json:async()=>({issuer:'https://identity.test',authorization_endpoint:'https://identity.test/realm/login',token_endpoint:'https://identity.test/realm/token',jwks_uri:'https://identity.test/realm/keys'})}:{ok:true,json:async()=>{exchanges++;return {id_token:idToken};}};
 const secret='x'.repeat(40),auth=createAuth({issuer:'https://identity.test',clientId:'client',secret,origin:'http://localhost:3200',role:'gradula',rollenClaim:'roles',secure:false,jwks,fetchImpl});
 const started=await auth.start('//evil.test'),url=new URL(started.ort),attempt=started.cookie.split(';')[0].split('=')[1];
 assert.match(started.cookie,/^gradula-attempt-local=/);assert.equal(url.searchParams.get('scope'),'openid profile email');
 await assert.rejects(auth.finish('code',attempt,{state:'wrong'}),/state/);assert.equal(exchanges,0);
 const token=async(nonce,roles=['gradula'])=>new SignJWT({nonce,roles,name:'Alice'}).setProtectedHeader({alg:'RS256'}).setIssuer('https://identity.test').setAudience('client').setSubject('alice').setExpirationTime('5m').sign(privateKey);
 idToken=await token('wrong');await assert.rejects(auth.finish('code',attempt,{state:url.searchParams.get('state')}),/nonce/);
 idToken=await token(url.searchParams.get('nonce'),[]);await assert.rejects(auth.finish('code',attempt,{state:url.searchParams.get('state')}),/role/);
 idToken=await token(url.searchParams.get('nonce'));const finished=await auth.finish('code',attempt,{state:url.searchParams.get('state')});assert.equal(finished.target,'/');
 assert.equal(auth.who({headers:{cookie:finished.cookies[0].split(';')[0]}}).sub,'alice');
});

test('discovery refuses another issuer and insecure remote endpoints',async()=>{
 for(const override of [{issuer:'https://impostor.test'},{token_endpoint:'http://remote.test/token'}]){
 const auth=createAuth({issuer:'https://identity.test',clientId:'client',secret:'x'.repeat(40),origin:'https://board.test',fetchImpl:async()=>({ok:true,json:async()=>({issuer:'https://identity.test',authorization_endpoint:'https://identity.test/login',token_endpoint:'https://identity.test/token',jwks_uri:'https://identity.test/keys',...override})})});
 await assert.rejects(auth.start());
 }
});
