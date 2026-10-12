'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const fs = require('node:fs');
const path = require('node:path');

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 16 * 1024;
const LEAD_STATUSES = new Set(['new','contact_pending','contacted','coverage_check','qualified','proposal_sent','won','lost','nurture','do_not_contact']);
const CHANNELS = new Set(['whatsapp','phone','email','web']);
const COOKIE_NAME = 'pfo_crm_session';

function json(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
  }, extraHeaders));
  res.end(JSON.stringify(payload));
}

function html(res, status, body, contentType) {
  res.writeHead(status, {
    'Content-Type': contentType || 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  });
  res.end(body);
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('request body too large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON object required');
    return value;
  } catch {
    const error = new Error('invalid JSON');
    error.statusCode = 400;
    throw error;
  }
}

function normalizeColombianPhone(value) {
  const raw = String(value == null ? '' : value).trim();
  const compact = raw.replace(/[\s().-]/g, '');
  const digits = compact.replace(/\D/g, '');
  if (/^3\d{9}$/.test(digits)) return '+57' + digits;
  if (/^573\d{9}$/.test(digits)) return '+' + digits;
  if (/^\+573\d{9}$/.test(compact)) return compact;
  return null;
}

function validateLeadInput(input) {
  const fullName = String(input.full_name == null ? '' : input.full_name).trim();
  const phone = normalizeColombianPhone(input.phone == null ? input.phone_e164 : input.phone);
  const municipality = String(input.municipality == null ? '' : input.municipality).trim();
  const vereda = String(input.vereda == null ? '' : input.vereda).trim();
  const email = String(input.email == null ? '' : input.email).trim().toLowerCase();
  const preferredChannel = String(input.preferred_channel || 'whatsapp').trim();
  const privacyNoticeVersion = String(input.privacy_notice_version == null ? '' : input.privacy_notice_version).trim();
  if (fullName.length < 2 || fullName.length > 160) return { error: 'El nombre debe tener entre 2 y 160 caracteres.' };
  if (!phone) return { error: 'Ingresa un celular colombiano válido (10 dígitos o prefijo +57).' };
  if (municipality.length > 120) return { error: 'El municipio no puede superar 120 caracteres.' };
  if (vereda.length < 2 || vereda.length > 160) return { error: 'La vereda debe tener entre 2 y 160 caracteres.' };
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return { error: 'El correo electrónico no es válido.' };
  if (!CHANNELS.has(preferredChannel)) return { error: 'El canal preferido no es válido.' };
  if (input.data_processing_consent !== true) return { error: 'Se requiere registrar la autorización para tratamiento de datos.' };
  if (typeof input.marketing_consent !== 'boolean') return { error: 'Debes registrar por separado la decisión sobre comunicaciones comerciales.' };
  if (!privacyNoticeVersion || privacyNoticeVersion.length > 64) return { error: 'La versión del aviso de privacidad es obligatoria.' };
  return { value: {
    fullName, phone, municipality: municipality || null, vereda, email: email || null,
    preferredChannel, privacyNoticeVersion, marketingConsent: input.marketing_consent,
    notes: String(input.notes == null ? '' : input.notes).trim() || null,
  } };
}

function createPasswordHash(password, salt = crypto.randomBytes(16), rounds = 310000) {
  if (typeof password !== 'string' || password.length < 12) throw new Error('password must contain at least 12 characters');
  const digest = crypto.pbkdf2Sync(password, salt, rounds, 32, 'sha256');
  return 'pbkdf2_sha256$' + rounds + '$' + salt.toString('base64url') + '$' + digest.toString('base64url');
}

function verifyPassword(password, encoded) {
  try {
    const parts = String(encoded || '').split('$');
    const rounds = Number(parts[1]);
    if (parts[0] !== 'pbkdf2_sha256' || parts.length !== 4 || !Number.isInteger(rounds) || rounds < 100000) return false;
    const salt = Buffer.from(parts[2], 'base64url');
    const expected = Buffer.from(parts[3], 'base64url');
    const actual = crypto.pbkdf2Sync(String(password), salt, rounds, expected.length, 'sha256');
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function parseCookies(header) {
  const cookies = {};
  for (const item of String(header || '').split(';')) {
    const separator = item.indexOf('=');
    if (separator >= 0) cookies[item.slice(0, separator).trim()] = item.slice(separator + 1).trim();
  }
  return cookies;
}

function validId(value) {
  return /^\d+$/.test(value) && Number(value) > 0 && Number.isSafeInteger(Number(value));
}

function createCrmServer(options) {
  const pool = options.pool;
  const env = options.env || process.env;
  const staticRoot = options.staticRoot || path.join(__dirname, 'public');
  const username = String(env.PFO_CRM_USERNAME || '');
  const passwordHash = String(env.PFO_CRM_PASSWORD_HASH || '');
  const sessionSecret = String(env.PFO_CRM_SESSION_SECRET || '');
  const allowedOrigin = String(env.PFO_CRM_ALLOWED_ORIGIN || '');
  const cookiePath = String(env.PFO_CRM_COOKIE_PATH || '/crm/');
  if (username.length < 3 || !passwordHash || sessionSecret.length < 32 || !allowedOrigin) {
    throw new Error('PFO CRM authentication/origin configuration is incomplete');
  }

  const sessions = new Map();
  const loginAttempts = new Map();

  function signedToken(sessionId) {
    const signature = crypto.createHmac('sha256', sessionSecret).update(sessionId).digest('base64url');
    return sessionId + '.' + signature;
  }

  function currentUser(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    if (!token) return null;
    const separator = token.lastIndexOf('.');
    if (separator < 1) return null;
    const sessionId = token.slice(0, separator);
    const signature = token.slice(separator + 1);
    const expected = signedToken(sessionId).slice(sessionId.length + 1);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const session = sessions.get(sessionId);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      sessions.delete(sessionId);
      return null;
    }
    return session.username;
  }

  function requireOrigin(req, res) {
    if (req.headers.origin === allowedOrigin) return true;
    json(res, 403, { error: 'Origen no permitido.' });
    return false;
  }

  function requireUser(req, res) {
    const user = currentUser(req);
    if (!user) json(res, 401, { error: 'La sesión expiró o no has iniciado sesión.' });
    return user;
  }

  async function audit(client, actor, eventType, entityType, entityId, correlationId, detail) {
    await client.query(
      "INSERT INTO pfo.audit_events(actor,event_type,entity_type,entity_id,outcome,correlation_id,detail) VALUES($1,$2,$3,$4,'success',$5,$6::jsonb)",
      [actor, eventType, entityType, String(entityId), correlationId || null, JSON.stringify(detail || {})],
    );
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    if (req.method === 'GET' && pathname === '/api/health') {
      try {
        await pool.query('SELECT 1');
        return json(res, 200, { status: 'ok' });
      } catch {
        return json(res, 503, { status: 'unavailable' });
      }
    }
    if (req.method === 'GET' && pathname === '/') {
      return html(res, 200, fs.readFileSync(path.join(staticRoot, 'index.html'), 'utf8'));
    }
    if (req.method === 'GET' && pathname === '/app.js') {
      return html(res, 200, fs.readFileSync(path.join(staticRoot, 'app.js'), 'utf8'), 'text/javascript; charset=utf-8');
    }
    if (req.method === 'GET' && pathname === '/styles.css') {
      return html(res, 200, fs.readFileSync(path.join(staticRoot, 'styles.css'), 'utf8'), 'text/css; charset=utf-8');
    }

    if (req.method === 'POST' && pathname === '/api/login') {
      if (!requireOrigin(req, res)) return;
      const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map((item) => item.trim()).filter(Boolean);
      const ip = forwarded.length ? forwarded[forwarded.length - 1] : (req.socket.remoteAddress || 'unknown');
      const attempts = loginAttempts.get(ip) || { count: 0, resetAt: Date.now() + 15 * 60 * 1000 };
      if (attempts.resetAt <= Date.now()) {
        attempts.count = 0;
        attempts.resetAt = Date.now() + 15 * 60 * 1000;
      }
      if (attempts.count >= 8) return json(res, 429, { error: 'Demasiados intentos. Espera 15 minutos.' });
      let body;
      try { body = await readJson(req); } catch (error) { return json(res, error.statusCode || 400, { error: error.message }); }
      if (String(body.username || '') !== username || !verifyPassword(String(body.password || ''), passwordHash)) {
        attempts.count += 1;
        loginAttempts.set(ip, attempts);
        return json(res, 401, { error: 'Usuario o contraseña incorrectos.' });
      }
      loginAttempts.delete(ip);
      const sessionId = crypto.randomBytes(32).toString('base64url');
      sessions.set(sessionId, { username, expiresAt: Date.now() + SESSION_TTL_MS });
      return json(res, 200, { username }, {
        'Set-Cookie': COOKIE_NAME + '=' + signedToken(sessionId) + '; Path=' + cookiePath + '; HttpOnly; Secure; SameSite=Strict; Max-Age=' + Math.floor(SESSION_TTL_MS / 1000),
      });
    }

    if (req.method === 'POST' && pathname === '/api/logout') {
      if (!requireOrigin(req, res)) return;
      const token = parseCookies(req.headers.cookie)[COOKIE_NAME] || '';
      const separator = token.lastIndexOf('.');
      if (separator > 0) sessions.delete(token.slice(0, separator));
      return json(res, 200, { ok: true }, {
        'Set-Cookie': COOKIE_NAME + '=; Path=' + cookiePath + '; HttpOnly; Secure; SameSite=Strict; Max-Age=0',
      });
    }

    if (req.method === 'GET' && pathname === '/api/me') {
      const user = requireUser(req, res);
      if (!user) return;
      return json(res, 200, { username: user });
    }

    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'La sesión expiró o no has iniciado sesión.' });

    if (req.method === 'GET' && pathname === '/api/summary') {
      try {
        const result = await pool.query("SELECT count(*)::int AS total, count(*) FILTER (WHERE status='new')::int AS new_count, count(*) FILTER (WHERE status IN ('contact_pending','contacted'))::int AS in_contact, count(*) FILTER (WHERE status IN ('coverage_check','qualified','proposal_sent'))::int AS qualified, count(*) FILTER (WHERE next_follow_up_at IS NOT NULL AND next_follow_up_at <= now() AND status NOT IN ('won','lost','do_not_contact'))::int AS follow_up_due FROM pfo.leads");
        return json(res, 200, result.rows[0]);
      } catch {
        return json(res, 503, { error: 'No fue posible consultar el resumen.' });
      }
    }

    if (req.method === 'GET' && pathname === '/api/leads') {
      const status = String(url.searchParams.get('status') || '').trim();
      const query = String(url.searchParams.get('q') || '').trim().slice(0, 120);
      if (status && !LEAD_STATUSES.has(status)) return json(res, 400, { error: 'Filtro de estado no válido.' });
      const values = [];
      const conditions = [];
      if (status) {
        values.push(status);
        conditions.push('l.status = $' + values.length);
      }
      if (query) {
        values.push('%' + query.replace(/[\\%_]/g, '\\$&') + '%');
        const n = '$' + values.length;
        conditions.push('(c.full_name ILIKE ' + n + " OR c.phone_e164 ILIKE " + n + " OR l.vereda ILIKE " + n + " OR COALESCE(l.municipality,'') ILIKE " + n + ')');
      }
      const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
      try {
        const result = await pool.query(
          'SELECT l.id,l.source,l.municipality,l.vereda,l.status,l.assigned_to,l.next_follow_up_at,l.created_at,c.full_name,c.phone_e164,c.email ' +
          'FROM pfo.leads l JOIN pfo.contacts c ON c.id=l.contact_id ' + where +
          ' ORDER BY l.created_at DESC,l.id DESC LIMIT 200', values);
        return json(res, 200, { leads: result.rows });
      } catch {
        return json(res, 503, { error: 'No fue posible consultar los interesados.' });
      }
    }

    const eventsMatch = pathname.match(/^\/api\/leads\/(\d+)\/events$/);
    if (req.method === 'GET' && eventsMatch) {
      if (!validId(eventsMatch[1])) return json(res, 400, { error: 'Identificador no válido.' });
      try {
        const result = await pool.query(
          'SELECT id,event_type,old_status,new_status,actor,detail,created_at FROM pfo.lead_events WHERE lead_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100',
          [Number(eventsMatch[1])]);
        return json(res, 200, { events: result.rows });
      } catch {
        return json(res, 503, { error: 'No fue posible consultar el historial.' });
      }
    }

    const leadMatch = pathname.match(/^\/api\/leads\/(\d+)$/);
    if (req.method === 'GET' && leadMatch) {
      if (!validId(leadMatch[1])) return json(res, 400, { error: 'Identificador no válido.' });
      try {
        const result = await pool.query(
          'SELECT l.*,c.full_name,c.phone_e164,c.email,c.preferred_channel,c.data_processing_consent,c.marketing_consent,c.do_not_contact,c.privacy_notice_version ' +
          'FROM pfo.leads l JOIN pfo.contacts c ON c.id=l.contact_id WHERE l.id=$1',
          [Number(leadMatch[1])]);
        if (!result.rowCount) return json(res, 404, { error: 'Interesado no encontrado.' });
        return json(res, 200, { lead: result.rows[0] });
      } catch {
        return json(res, 503, { error: 'No fue posible consultar el interesado.' });
      }
    }

    if (req.method === 'POST' && pathname === '/api/leads') {
      if (!requireOrigin(req, res)) return;
      let body;
      try { body = await readJson(req); } catch (error) { return json(res, error.statusCode || 400, { error: error.message }); }
      const validation = validateLeadInput(body);
      if (validation.error) return json(res, 400, { error: validation.error });
      const value = validation.value;
      const idempotencyKey = String(req.headers['idempotency-key'] || '').trim();
      if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) return json(res, 400, { error: 'Falta una clave de idempotencia válida.' });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const prior = await client.query('SELECT l.id,l.status,l.vereda,l.municipality,c.phone_e164 FROM pfo.leads l JOIN pfo.contacts c ON c.id=l.contact_id WHERE l.idempotency_key=$1 FOR UPDATE OF l', [idempotencyKey]);
        if (prior.rowCount) {
          const existing = prior.rows[0];
          const sameRequest = existing.phone_e164 === value.phone && String(existing.vereda).trim().toLowerCase() === value.vereda.toLowerCase() && String(existing.municipality || '').trim().toLowerCase() === String(value.municipality || '').toLowerCase();
          await client.query('COMMIT');
          if (!sameRequest) return json(res, 409, { error: 'La clave de idempotencia ya se usó con otros datos.' });
          return json(res, 200, { lead: { id: existing.id, status: existing.status, vereda: existing.vereda, municipality: existing.municipality }, replayed: true });
        }
        const contact = await client.query('SELECT id FROM pfo.contacts WHERE phone_e164=$1 FOR UPDATE', [value.phone]);
        let contactId;
        if (contact.rowCount) {
          contactId = contact.rows[0].id;
          await client.query(
            "UPDATE pfo.contacts SET full_name=$2,email=$3,preferred_channel=$4,data_processing_consent=TRUE,data_processing_consent_at=now(),data_processing_consent_source='crm',consent_recorded_at=now(),consent_source='crm',privacy_notice_version=$5,marketing_consent=$6,marketing_consent_recorded_at=now(),marketing_consent_source='crm',marketing_notice_version=$5,updated_at=now() WHERE id=$1",
            [contactId, value.fullName, value.email, value.preferredChannel, value.privacyNoticeVersion, value.marketingConsent]);
        } else {
          const inserted = await client.query(
            "INSERT INTO pfo.contacts(full_name,phone_e164,email,preferred_channel,data_processing_consent,data_processing_consent_at,data_processing_consent_source,consent_recorded_at,consent_source,privacy_notice_version,marketing_consent,marketing_consent_recorded_at,marketing_consent_source,marketing_notice_version) VALUES($1,$2,$3,$4,TRUE,now(),'crm',now(),'crm',$5,$6,now(),'crm',$5) RETURNING id",
            [value.fullName, value.phone, value.email, value.preferredChannel, value.privacyNoticeVersion, value.marketingConsent]);
          contactId = inserted.rows[0].id;
        }
        const duplicate = await client.query(
          "SELECT id,status FROM pfo.leads WHERE contact_id=$1 AND lower(trim(vereda))=lower(trim($2)) AND COALESCE(lower(trim(municipality)),'')=COALESCE(lower(trim($3)),'') AND status NOT IN ('won','lost','do_not_contact') ORDER BY created_at DESC LIMIT 1",
          [contactId, value.vereda, value.municipality]);
        if (duplicate.rowCount) {
          await client.query('ROLLBACK');
          return json(res, 409, { error: 'Ya existe un interesado activo para este contacto y vereda.', existing_lead_id: duplicate.rows[0].id });
        }
        const insertedLead = await client.query(
          "INSERT INTO pfo.leads(contact_id,source,municipality,vereda,status,notes,idempotency_key) VALUES($1,'crm',$2,$3,'new',$4,$5) RETURNING *",
          [contactId, value.municipality, value.vereda, value.notes, idempotencyKey]);
        const lead = insertedLead.rows[0];
        await client.query(
          "INSERT INTO pfo.lead_events(lead_id,event_type,new_status,actor,detail) VALUES($1,'lead_created','new',$2,$3::jsonb)",
          [lead.id, user, JSON.stringify({ source: 'crm' })]);
        await audit(client, user, 'crm.lead.created', 'lead', lead.id, lead.idempotency_key, { status: 'new' });
        await client.query('COMMIT');
        return json(res, 201, { lead: { id: lead.id, status: lead.status, vereda: lead.vereda, municipality: lead.municipality } });
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error.code === '23505') return json(res, 409, { error: 'Ya existe un registro con esos datos.' });
        return json(res, 503, { error: 'No fue posible guardar el interesado.' });
      } finally {
        client.release();
      }
    }

    if (req.method === 'PATCH' && leadMatch) {
      if (!requireOrigin(req, res)) return;
      if (!validId(leadMatch[1])) return json(res, 400, { error: 'Identificador no válido.' });
      let body;
      try { body = await readJson(req); } catch (error) { return json(res, error.statusCode || 400, { error: error.message }); }
      const allowed = new Set(['status','assigned_to','next_follow_up_at','notes','lost_reason']);
      const keys = Object.keys(body);
      if (!keys.length || keys.some((key) => !allowed.has(key))) return json(res, 400, { error: 'Solo se pueden modificar estado, responsable, próximo seguimiento, notas y motivo de pérdida.' });
      if (Object.hasOwn(body, 'status') && !LEAD_STATUSES.has(body.status)) return json(res, 400, { error: 'Estado no válido.' });
      if (Object.hasOwn(body, 'assigned_to') && body.assigned_to !== null && (typeof body.assigned_to !== 'string' || body.assigned_to.trim().length > 128)) return json(res, 400, { error: 'Responsable no válido.' });
      if (Object.hasOwn(body, 'notes') && body.notes !== null && (typeof body.notes !== 'string' || body.notes.length > 4000)) return json(res, 400, { error: 'Las notas no pueden superar 4000 caracteres.' });
      if (Object.hasOwn(body, 'lost_reason') && body.lost_reason !== null && (typeof body.lost_reason !== 'string' || body.lost_reason.length > 500)) return json(res, 400, { error: 'El motivo no puede superar 500 caracteres.' });
      let followUp;
      if (Object.hasOwn(body, 'next_follow_up_at')) {
        if (body.next_follow_up_at === null || body.next_follow_up_at === '') followUp = null;
        else {
          const parsed = new Date(body.next_follow_up_at);
          if (!Number.isFinite(parsed.getTime())) return json(res, 400, { error: 'Fecha de seguimiento no válida.' });
          followUp = parsed.toISOString();
        }
      }
      const id = Number(leadMatch[1]);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const currentResult = await client.query('SELECT * FROM pfo.leads WHERE id=$1 FOR UPDATE', [id]);
        if (!currentResult.rowCount) {
          await client.query('ROLLBACK');
          return json(res, 404, { error: 'Interesado no encontrado.' });
        }
        const current = currentResult.rows[0];
        const status = Object.hasOwn(body, 'status') ? body.status : current.status;
        const assignedTo = Object.hasOwn(body, 'assigned_to') ? (body.assigned_to === null ? null : body.assigned_to.trim() || null) : current.assigned_to;
        const nextFollowUp = Object.hasOwn(body, 'next_follow_up_at') ? followUp : current.next_follow_up_at;
        const notes = Object.hasOwn(body, 'notes') ? body.notes : current.notes;
        const lostReason = Object.hasOwn(body, 'lost_reason') ? body.lost_reason : current.lost_reason;
        const updatedResult = await client.query(
          'UPDATE pfo.leads SET status=$2,assigned_to=$3,next_follow_up_at=$4,notes=$5,lost_reason=$6,updated_at=now() WHERE id=$1 RETURNING *',
          [id, status, assignedTo, nextFollowUp, notes, lostReason]);
        const updated = updatedResult.rows[0];
        const statusChanged = current.status !== updated.status;
        await client.query(
          'INSERT INTO pfo.lead_events(lead_id,event_type,old_status,new_status,actor,detail) VALUES($1,$2,$3,$4,$5,$6::jsonb)',
          [id, statusChanged ? 'status_changed' : 'lead_updated', current.status, updated.status, user, JSON.stringify({ changed_fields: keys })]);
        await audit(client, user, statusChanged ? 'crm.lead.status_changed' : 'crm.lead.updated', 'lead', id, null, { changed_fields: keys, status: updated.status });
        await client.query('COMMIT');
        return json(res, 200, { lead: updated });
      } catch {
        await client.query('ROLLBACK').catch(() => {});
        return json(res, 503, { error: 'No fue posible actualizar el interesado.' });
      } finally {
        client.release();
      }
    }

    return json(res, 404, { error: 'Ruta no encontrada.' });
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) json(res, 500, { error: 'Error interno.' });
      else res.end();
    });
  });
  server.crmSessions = sessions;
  return server;
}

if (require.main === module) {
  const pool = new Pool({
    host: process.env.PGHOST || 'postgres',
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || 'pura_fibra',
    user: process.env.PGUSER || 'pura_fibra_app',
    password: process.env.PGPASSWORD,
    max: 5,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
    application_name: 'pfo-crm',
  });
  let server;
  try {
    server = createCrmServer({ pool });
  } catch (error) {
    process.stderr.write(error.message + '\n');
    process.exit(1);
  }
  const port = Number(process.env.PORT || 8091);
  server.listen(port, '0.0.0.0', () => process.stdout.write('PFO CRM listening on ' + port + '\n'));
  const shutdown = async () => server.close(async () => {
    await pool.end().catch(() => {});
    process.exit(0);
  });
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = { createCrmServer, createPasswordHash, normalizeColombianPhone, validateLeadInput, verifyPassword };
