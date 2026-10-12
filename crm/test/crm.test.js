'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createCrmServer, createPasswordHash, normalizeColombianPhone,
  validateLeadInput, verifyPassword,
} = require('../server');

const TEST_PASSWORD = 'Test-only-PFO-CRM-2026!';
const TEST_ORIGIN = 'https://crm.test.invalid';

async function startTestServer(t) {
  const passwordHash = createPasswordHash(TEST_PASSWORD);
  const pool = {
    async query() { return { rows: [{ ok: 1 }], rowCount: 1 }; },
  };
  const server = createCrmServer({
    pool,
    env: {
      PFO_CRM_USERNAME: 'test-admin',
      PFO_CRM_PASSWORD_HASH: passwordHash,
      PFO_CRM_SESSION_SECRET: 'test-session-secret-with-at-least-thirty-two-bytes',
      PFO_CRM_ALLOWED_ORIGIN: TEST_ORIGIN,
      PFO_CRM_COOKIE_PATH: '/',
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { base: 'http://127.0.0.1:' + server.address().port, passwordHash };
}

test('normalizes supported Colombian mobile number formats', () => {
  assert.equal(normalizeColombianPhone('300 123 4567'), '+573001234567');
  assert.equal(normalizeColombianPhone('573001234567'), '+573001234567');
  assert.equal(normalizeColombianPhone('+57 300-123-4567'), '+573001234567');
  assert.equal(normalizeColombianPhone('601 555 1234'), null);
  assert.equal(normalizeColombianPhone('not a phone'), null);
});

test('requires explicit data-processing consent, separate marketing choice and notice version', () => {
  const base = {
    full_name: 'Persona de prueba',
    phone: '3001234567',
    vereda: 'Vereda de prueba',
    data_processing_consent: true,
    marketing_consent: false,
    privacy_notice_version: 'privacy-v1',
  };
  assert.equal(validateLeadInput(base).value.phone, '+573001234567');
  assert.match(validateLeadInput({ ...base, data_processing_consent: false }).error, /autorización/);
  assert.match(validateLeadInput({ ...base, marketing_consent: undefined }).error, /comunicaciones comerciales/);
  assert.match(validateLeadInput({ ...base, privacy_notice_version: '' }).error, /versión del aviso/);
});

test('password hashes are salted, verifiable and reject invalid passwords', () => {
  const hash = createPasswordHash(TEST_PASSWORD);
  assert.equal(verifyPassword(TEST_PASSWORD, hash), true);
  assert.equal(verifyPassword('wrong password', hash), false);
  assert.equal(verifyPassword(TEST_PASSWORD, 'plaintext'), false);
  assert.throws(() => createPasswordHash('short'), /12 characters/);
});

test('configuration fails closed when authentication settings are absent', () => {
  assert.throws(() => createCrmServer({
    pool: { query: async () => ({ rows: [], rowCount: 0 }) },
    env: {},
  }), /configuration is incomplete/);
});

test('CRM requires a session for lead data and protects login against foreign origins', async (t) => {
  const { base } = await startTestServer(t);
  const anonymous = await fetch(base + '/api/leads');
  assert.equal(anonymous.status, 401);

  const blocked = await fetch(base + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.invalid' },
    body: JSON.stringify({ username: 'test-admin', password: TEST_PASSWORD }),
  });
  assert.equal(blocked.status, 403);
});

test('valid login issues an HttpOnly Secure SameSite cookie and opens a session', async (t) => {
  const { base } = await startTestServer(t);
  const response = await fetch(base + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: TEST_ORIGIN },
    body: JSON.stringify({ username: 'test-admin', password: TEST_PASSWORD }),
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);

  const me = await fetch(base + '/api/me', { headers: { Cookie: cookie.split(';')[0] } });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).username, 'test-admin');
});

test('invalid lead data is rejected before touching the database', async (t) => {
  const { base } = await startTestServer(t);
  const login = await fetch(base + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: TEST_ORIGIN },
    body: JSON.stringify({ username: 'test-admin', password: TEST_PASSWORD }),
  });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const response = await fetch(base + '/api/leads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: TEST_ORIGIN, Cookie: cookie },
    body: JSON.stringify({
      full_name: 'Persona de prueba', phone: '3001234567', vereda: 'Vereda de prueba',
      data_processing_consent: false, marketing_consent: false, privacy_notice_version: 'privacy-v1',
    }),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /autorización/);
});
