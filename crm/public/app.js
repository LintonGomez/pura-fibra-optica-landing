'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const loginView = $('#login-view');
const appView = $('#app-view');
const loginForm = $('#login-form');
const loginError = $('#login-error');
const leadsBody = $('#leads-body');
const appMessage = $('#app-message');
const leadDialog = $('#lead-dialog');
const detailDialog = $('#detail-dialog');
const statusLabels = {
  new: 'Nuevo',
  contact_pending: 'Contacto pendiente',
  contacted: 'Contactado',
  coverage_check: 'Validar cobertura',
  qualified: 'Calificado',
  proposal_sent: 'Propuesta enviada',
  won: 'Ganado',
  lost: 'Perdido',
  nurture: 'Seguimiento futuro',
  do_not_contact: 'No contactar',
};
let searchTimer = null;
let currentLeadId = null;

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function formatDate(value, withTime = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-CO', withTime
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { dateStyle: 'medium' }).format(date);
}

function toLocalInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function setMessage(element, message, kind = '') {
  element.textContent = message || '';
  element.className = 'message' + (kind ? ' ' + kind : '');
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
  });
  let body = {};
  try { body = await response.json(); } catch { /* non-JSON response */ }
  if (response.status === 401 && !url.endsWith('/api/login')) {
    showLogin();
    throw new Error('Tu sesión terminó. Inicia sesión nuevamente.');
  }
  if (!response.ok) throw new Error(body.error || 'No fue posible completar la operación.');
  return body;
}

function showLogin() {
  appView.hidden = true;
  loginView.hidden = false;
  loginForm.reset();
  setMessage(loginError, '');
}

function showApp(username) {
  loginView.hidden = true;
  appView.hidden = false;
  $('#current-user').textContent = username || '';
  refreshAll().catch((error) => setMessage(appMessage, error.message, 'error'));
}

async function refreshAll() {
  setMessage(appMessage, '');
  const [summary, list] = await Promise.all([
    api('/api/summary'),
    api('/api/leads?' + new URLSearchParams({
      q: $('#search-input').value.trim(),
      status: $('#status-filter').value,
    })),
  ]);
  $('#stat-total').textContent = summary.total ?? 0;
  $('#stat-new').textContent = summary.new_count ?? 0;
  $('#stat-contact').textContent = summary.in_contact ?? 0;
  $('#stat-due').textContent = summary.follow_up_due ?? 0;
  renderLeads(list.leads || []);
}

function renderLeads(leads) {
  $('#result-count').textContent = leads.length + (leads.length === 1 ? ' registro' : ' registros');
  if (!leads.length) {
    leadsBody.innerHTML = '<tr><td colspan="6" class="empty-state"><strong>Aún no hay interesados en este CRM.</strong><br><span>Este panel consulta el nuevo registro comercial. Los registros históricos o de prueba no se importan automáticamente.</span></td></tr>';
    return;
  }
  leadsBody.innerHTML = leads.map((lead) => {
    const place = [lead.vereda, lead.municipality].filter(Boolean).map(escapeHtml).join(' · ');
    const status = statusLabels[lead.status] || lead.status;
    return '<tr>' +
      '<td><div class="lead-name">' + escapeHtml(lead.full_name) + '</div><a class="phone-link" href="tel:' + escapeHtml(lead.phone_e164) + '">' + escapeHtml(lead.phone_e164) + '</a></td>' +
      '<td><span class="place-name">' + (place || '—') + '</span><small class="source-label">' + escapeHtml(lead.source || '—') + '</small></td>' +
      '<td><span class="status-pill status-' + escapeHtml(lead.status) + '">' + escapeHtml(status) + '</span></td>' +
      '<td>' + escapeHtml(lead.assigned_to || 'Sin asignar') + '</td>' +
      '<td>' + escapeHtml(formatDate(lead.next_follow_up_at, true)) + '</td>' +
      '<td><button class="button tiny subtle" type="button" data-open-lead="' + Number(lead.id) + '">Abrir →</button></td>' +
      '</tr>';
  }).join('');
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage(loginError, '');
  const data = new FormData(loginForm);
  const button = $('button[type="submit"]', loginForm);
  button.disabled = true;
  try {
    const result = await api('/api/login', { method: 'POST', body: JSON.stringify({
      username: data.get('username'), password: data.get('password'),
    }) });
    showApp(result.username);
  } catch (error) {
    setMessage(loginError, error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

$('#logout-button').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST', body: '{}' }); } catch { /* session may already be gone */ }
  showLogin();
});

$('#refresh-button').addEventListener('click', () => refreshAll().catch((error) => setMessage(appMessage, error.message, 'error')));
$('#status-filter').addEventListener('change', () => refreshAll().catch((error) => setMessage(appMessage, error.message, 'error')));
$('#search-input').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => refreshAll().catch((error) => setMessage(appMessage, error.message, 'error')), 250);
});

$('#new-lead-button').addEventListener('click', () => {
  $('#lead-form').reset();
  $('#lead-form').dataset.idempotencyKey = crypto.randomUUID();
  setMessage($('#lead-form-error'), '');
  leadDialog.showModal();
});
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));

$('#lead-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const marketing = data.get('marketing_consent');
  if (marketing !== 'true' && marketing !== 'false') {
    setMessage($('#lead-form-error'), 'Debes registrar una decisión explícita sobre comunicaciones comerciales.', 'error');
    return;
  }
  const button = $('button[type="submit"]', form);
  button.disabled = true;
  setMessage($('#lead-form-error'), '');
  try {
    await api('/api/leads', { method: 'POST', headers: { 'Idempotency-Key': form.dataset.idempotencyKey }, body: JSON.stringify({
      full_name: data.get('full_name'),
      phone: data.get('phone'),
      email: data.get('email'),
      municipality: data.get('municipality'),
      vereda: data.get('vereda'),
      preferred_channel: data.get('preferred_channel'),
      privacy_notice_version: data.get('privacy_notice_version'),
      data_processing_consent: data.get('data_processing_consent') === 'on',
      marketing_consent: marketing === 'true',
      notes: data.get('notes'),
    }) });
    leadDialog.close();
    setMessage(appMessage, 'Interesado registrado correctamente.', 'success');
    await refreshAll();
  } catch (error) {
    setMessage($('#lead-form-error'), error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

leadsBody.addEventListener('click', (event) => {
  const button = event.target.closest('[data-open-lead]');
  if (button) openLead(button.dataset.openLead).catch((error) => setMessage(appMessage, error.message, 'error'));
});

async function openLead(id) {
  currentLeadId = Number(id);
  setMessage($('#detail-form-error'), '');
  $('#lead-events').innerHTML = '<li class="muted small">Cargando historial…</li>';
  const [result, history] = await Promise.all([
    api('/api/leads/' + currentLeadId),
    api('/api/leads/' + currentLeadId + '/events'),
  ]);
  const lead = result.lead;
  $('#detail-title').textContent = lead.full_name;
  $('#detail-subtitle').textContent = 'Registro #' + lead.id + ' · Creado ' + formatDate(lead.created_at, true);
  $('#detail-contact').innerHTML =
    '<div><span>Celular</span><strong>' + escapeHtml(lead.phone_e164) + '</strong></div>' +
    '<div><span>Correo</span><strong>' + escapeHtml(lead.email || '—') + '</strong></div>' +
    '<div><span>Zona</span><strong>' + escapeHtml([lead.vereda, lead.municipality].filter(Boolean).join(' · ') || '—') + '</strong></div>' +
    '<div><span>Consentimiento comercial</span><strong>' + (lead.marketing_consent ? 'Autorizado' : 'No autorizado') + '</strong></div>';
  const form = $('#detail-form');
  form.elements.id.value = lead.id;
  form.elements.status.value = lead.status;
  form.elements.assigned_to.value = lead.assigned_to || '';
  form.elements.next_follow_up_at.value = toLocalInput(lead.next_follow_up_at);
  form.elements.notes.value = lead.notes || '';
  form.elements.lost_reason.value = lead.lost_reason || '';
  const events = history.events || [];
  $('#lead-events').innerHTML = events.length ? events.map((item) =>
    '<li><span class="event-dot"></span><div><strong>' + escapeHtml(eventLabel(item.event_type, item.new_status)) +
    '</strong><small>' + escapeHtml(formatDate(item.created_at, true)) + ' · ' + escapeHtml(item.actor || 'sistema') +
    '</small></div></li>').join('') : '<li class="muted small">Sin eventos registrados.</li>';
  detailDialog.showModal();
}

function eventLabel(type, status) {
  if (type === 'lead_created') return 'Interesado registrado';
  if (type === 'status_changed') return 'Estado actualizado: ' + (statusLabels[status] || status || '');
  if (type === 'lead_updated') return 'Ficha comercial actualizada';
  return type || 'Actividad';
}

$('#detail-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const button = $('button[type="submit"]', form);
  button.disabled = true;
  setMessage($('#detail-form-error'), '');
  const dateValue = data.get('next_follow_up_at');
  try {
    await api('/api/leads/' + currentLeadId, { method: 'PATCH', body: JSON.stringify({
      status: data.get('status'),
      assigned_to: String(data.get('assigned_to') || '').trim() || null,
      next_follow_up_at: dateValue ? new Date(dateValue).toISOString() : null,
      notes: data.get('notes') || null,
      lost_reason: data.get('lost_reason') || null,
    }) });
    detailDialog.close();
    setMessage(appMessage, 'Cambios guardados y registrados en el historial.', 'success');
    await refreshAll();
  } catch (error) {
    setMessage($('#detail-form-error'), error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

(async function initialize() {
  try {
    const session = await api('/api/me');
    showApp(session.username);
  } catch {
    showLogin();
  }
})();
