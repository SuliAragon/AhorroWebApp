import {
  STORAGE_KEY, available, balance, categories, collectConcepts, conceptKey, contributionTotal, displayDate,
  emptyAccount, fundingNeeded, localDate, money, monthLabel, monthSummary, movementTotals, parseAmount, shiftMonth, uid, validDate, validateAccount,
} from './account.js';
import { bankMovements, exportCSV, guessColumns, importBackup, isBackup, readCSV } from './csv.js';
import { demoAccount } from './demo.js';
import { installApp, isStandalone } from './pwa.js';
import { categoryIcons, iconPaths } from './icons.js';
import { decodePhoto, encodePhoto, getPhoto, photoIds, preparePhoto, writePhotos } from './photos.js';
import { THEME_KEY, applyTheme } from './theme.js';

const $ = (selector, parent = document) => parent.querySelector(selector);
const all = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const setText = (id, text) => { $('#' + id).textContent = text; };
const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const icon = (name, size = 17) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${iconPaths[name]}"/></svg>`;
const dialog = $('#dialog');
const dialogContent = $('#dialog-content');
const current = () => localDate().slice(0, 7);
let month = current();
let page = 'resumen';
let account = emptyAccount();
let demo = null;
let storageError = false;
let notificationTimer;
let dialogPhotoUrl;
const MAX_CSV_BYTES = 64 * 1024 * 1024;

function storedAccount(raw = localStorage.getItem(STORAGE_KEY)) {
  return raw ? validateAccount(JSON.parse(raw)) : emptyAccount();
}

function loadAccount() {
  try {
    account = storedAccount();
    storageError = false;
  } catch {
    storageError = true;
  }
  const banner = $('#storage-banner');
  banner.hidden = !storageError;
  if (storageError) banner.textContent = 'No se ha podido leer la cuenta guardada. Las ediciones están desactivadas para proteger tus datos.';
}

const data = () => demo ?? account;
const monthMax = () => data().movements.reduce((latest, entry) => {
  const value = entry.date.slice(0, 7);
  return value > latest ? value : latest;
}, current());
const entriesNewest = (entries) => [...entries].reverse().sort((a, b) => b.date.localeCompare(a.date));
const plural = (count, singular, pluralForm = singular + 's') => count + ' ' + (count === 1 ? singular : pluralForm);
const movementTypes = { expense: 'Gasto', income: 'Ingreso', deposit: 'Depósito de ahorro' };

async function changeAccount(change, photos = new Map()) {
  if (demo || storageError) throw new Error('La cuenta actual está en modo de solo lectura.');
  const save = async () => {
    const raw = localStorage.getItem(STORAGE_KEY);
    const latest = storedAccount(raw);
    const before = photoIds(latest);
    change(latest);
    validateAccount(latest);
    if (photos.size) await writePhotos(photos);
    try {
      if (photos.size && localStorage.getItem(STORAGE_KEY) !== raw) {
        throw new Error('La cuenta cambió mientras se guardaba la foto. Vuelve a guardar el movimiento.');
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(latest));
    } catch (error) {
      if (photos.size) await removeStoredPhotos([...photos.keys()]);
      if (error instanceof DOMException) throw new Error('No se pudo guardar el cambio. Comprueba el espacio y los permisos del navegador.');
      throw error;
    }
    account = latest;
    const kept = new Set(photoIds(latest));
    await removeStoredPhotos(before.filter((id) => !kept.has(id)));
  };
  if (navigator.locks) await navigator.locks.request(STORAGE_KEY, save);
  else await save();
  render();
}

async function removeStoredPhotos(ids) {
  if (!ids.length) return;
  try {
    await writePhotos(new Map(), ids);
  } catch {
    console.warn('No se pudieron limpiar fotos antiguas del almacenamiento local.');
  }
}

function notify(message) {
  clearTimeout(notificationTimer);
  setText('toast', message);
  notificationTimer = setTimeout(() => setText('toast', ''), 4600);
}

function button(action, label, { type = 'outline', id = '', symbol = '' } = {}) {
  return `<button class="button ${type}" type="button" data-action="${action}" ${id ? `data-id="${esc(id)}"` : ''} data-editable>${symbol ? icon(symbol) : ''}${label}</button>`;
}

function empty(title, copy) {
  return `<div class="empty"><h3>${title}</h3><p>${copy}</p></div>`;
}

function movementsMarkup(movements, showDetails = false) {
  if (!movements.length) {
    return data().movements.length && !showDetails
      ? empty('Sin coincidencias', 'Prueba con otro concepto, tipo o mes.')
      : '<p class="feed-empty">Todavía no hay movimientos.</p>';
  }
  const groups = new Map();
  for (const entry of movements) {
    if (!groups.has(entry.date)) groups.set(entry.date, []);
    groups.get(entry.date).push(entry);
  }
  const now = new Date();
  const today = localDate(now);
  const yesterday = localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  return [...groups].map(([date, entries]) => {
    const label = date === today ? 'Hoy' : date === yesterday ? 'Ayer' : displayDate(date, {
      weekday: 'short', day: 'numeric', month: 'short', ...(date.slice(0, 4) !== today.slice(0, 4) && {year: 'numeric'}),
    });
    return `<div class="movement-day"><h3><time datetime="${date}">${label}</time></h3>
      <ul class="list">${entries.map((entry) => movementRow(entry, showDetails)).join('')}</ul></div>`;
  }).join('');
}

function movementRow(entry, showDetails) {
  const name = esc(entry.name);
  const categoryIcon = categoryIconsByName.get(normal(entry.category.trim()));
  const symbol = categoryIcon ?? icon(entry.type === 'deposit' ? 'plus' : entry.type === 'income' ? 'down' : 'up', 17);
  const item = `<span class="movement-icon" aria-hidden="true">${symbol}</span>
    <span class="movement-name"><strong>${name}</strong><span class="movement-meta">${esc(entry.category || movementTypes[entry.type])}</span></span>
    <strong class="movement-amount ${entry.type === 'expense' ? 'amount-out' : 'amount-in'}">${entry.type === 'expense' ? '−' : '+'}${money(entry.amount)}</strong>`;
  const main = showDetails && (demo || storageError) ? `<div class="movement-main">${item}</div>`
    : `<button type="button" class="movement-main" data-action="${showDetails ? 'edit-movement' : 'open-movement-concept'}" data-id="${entry.id}"><span class="sr-only">${showDetails ? 'Editar ' : 'Ver concepto de '} </span>${item}</button>`;
  const photo = entry.photoId ? `<button type="button" class="icon-button photo-link" data-action="view-photo" data-id="${entry.id}" aria-label="Ver foto de ${name}" title="Ver foto">${icon('camera', 16)}</button>` : '';
  return `<li class="movement-row">${main}${photo}</li>`;
}

function renderSummary() {
  const state = data();
  const { income, expenses } = movementTotals(state.movements);
  setText('total-balance', money(balance(state)));
  setText('total-income', money(income));
  setText('total-expenses', money(expenses));
  $('#home-movements').innerHTML = movementsMarkup(entriesNewest(state.movements).slice(0, 12));
}

function renderAnalysis() {
  const state = data();
  if (month > monthMax()) month = monthMax();
  setText('month-label', monthLabel(month));
  $('[data-action="next-month"]').disabled = month >= monthMax();
  $('[data-action="previous-month"]').disabled = month <= '1900-01';
  const { income, expenses, savings } = monthSummary(state, month);
  setText('month-income', money(income));
  setText('month-expenses', money(expenses));
  setText('month-savings', money(savings));
}

const categoryValue = (name) => 'category:' + conceptKey(name);

function historyCategoryGroups(movements) {
  const groups = new Map();
  for (const entry of movements) {
    const value = categoryValue(entry.category);
    if (!groups.has(value)) groups.set(value, { label: entry.category.trim() || 'Sin categoría', movements: [] });
    groups.get(value).movements.push(entry);
  }
  return groups;
}

function renderHistoryChart(movements) {
  const groups = [...historyCategoryGroups(movements).values()]
    .map(({ label, movements }) => ({ label, ...movementTotals(movements) }))
    .sort((a, b) => (b.income + b.expenses) - (a.income + a.expenses) || a.label.localeCompare(b.label, 'es'));
  const max = groups.length ? groups[0].income + groups[0].expenses : 1;
  const bars = $('#history-chart-bars');
  bars.innerHTML = groups.map(({ label, income, expenses }) => `<li class="history-bar">
    <div class="history-bar-track" aria-hidden="true">
      <span class="history-bar-income" style="height: ${income / max * 100}%"></span>
      <span class="history-bar-expense" style="height: ${expenses / max * 100}%"></span>
    </div>
    <div class="history-bar-label"><strong>${esc(label)}</strong><div class="history-bar-amounts">
      ${income ? `<span class="history-value-income"><span class="sr-only">Ingresos </span>+${money(income)}</span>` : ''}
      ${expenses ? `<span class="history-value-expense"><span class="sr-only">Gastos </span>−${money(expenses)}</span>` : ''}
    </div></div>
  </li>`).join('');
  bars.hidden = !groups.length;
  $('#history-chart-legend').hidden = !groups.length;
  $('#history-chart-empty').hidden = Boolean(groups.length);
}

function renderMovements() {
  const state = data();
  const monthSelect = $('#movement-month');
  const selectedMonth = monthSelect.value;
  const months = [...new Set(state.movements.map((entry) => entry.date.slice(0, 7)))].sort().reverse();
  monthSelect.innerHTML = '<option value="">Todos los meses</option>' + months.map((value) => `<option value="${value}">${monthLabel(value)}</option>`).join('');
  monthSelect.value = months.includes(selectedMonth) ? selectedMonth : '';
  const categorySelect = $('#movement-category');
  const selectedCategory = categorySelect.value;
  const groups = historyCategoryGroups(state.movements);
  const options = [...groups].sort(([, a], [, b]) => a.label.localeCompare(b.label, 'es'));
  categorySelect.innerHTML = option('', 'Todas las categorías') + options.map(([value, { label }]) => option(value, label)).join('');
  categorySelect.value = groups.has(selectedCategory) ? selectedCategory : '';
  categorySelect.disabled = !groups.size;
  const query = normal($('#movement-query').value.trim());
  const type = $('#movement-type').value;
  const found = entriesNewest(state.movements).filter((entry) => (
    (!type || type === entry.type) && (!monthSelect.value || entry.date.startsWith(monthSelect.value)) &&
    (!categorySelect.value || categoryValue(entry.category) === categorySelect.value) &&
    (!query || normal(entry.name + ' ' + entry.category).includes(query))
  ));
  const count = plural(found.length, 'movimiento');
  setText('filtered-count', count);
  const indicator = $('#filter-indicator');
  indicator.textContent = count;
  indicator.hidden = !query && !type && !monthSelect.value && !categorySelect.value;
  renderHistoryChart(found);
  $('#all-movements').innerHTML = movementsMarkup(found);
}

function updateControls() {
  for (const element of all('[data-editable]')) {
    const action = element.dataset.action;
    if (action === 'toggle-demo') element.hidden = Boolean(demo);
    else if (action !== 'history') element.disabled = Boolean(demo || storageError);
  }
  $('[data-action="export-photos"]').hidden = !photoIds(account).length;
}

function render() {
  $('#demo-banner').hidden = !demo;
  if (page === 'resumen') renderSummary();
  if (page === 'movimientos') renderMovements();
  if (page === 'analisis') renderAnalysis();
  updateControls();
}

function navigate(focus = false) {
  const requested = window.location.hash.slice(1);
  if (requested === 'contenido') return;
  const views = all('[data-page]');
  page = views.find((view) => view.id === requested)?.id ?? 'resumen';
  for (const view of views) view.hidden = view.id !== page;
  for (const link of all('[data-nav]')) {
    if (link.dataset.nav === page) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  render();
  if (focus) {
    const heading = $('[data-page="' + page + '"] h1');
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
}

const normal = (value) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const categoryIconsByName = new Map(Object.entries(categoryIcons).map(([name, svg]) => [normal(name), svg]));
const categoryShortcuts = `<div class="category-shortcuts" role="group" aria-label="Categorías rápidas">${Object.entries(categoryIcons).map(([name, svg]) =>
  `<button type="button" data-category="${esc(name)}" aria-pressed="false"><span aria-hidden="true">${svg}</span>${esc(name)}</button>`).join('')}</div>`;
const input = (label, name, attributes = '') => `<label>${label}<input name="${name}" ${attributes}></label>`;
const select = (label, name, options) => `<label>${label}<select name="${name}">${options}</select></label>`;
const option = (value, label, selected) => `<option value="${esc(value)}"${selected ? ' selected' : ''}>${esc(label)}</option>`;

function releaseDialogPhoto() {
  if (dialogPhotoUrl) URL.revokeObjectURL(dialogPhotoUrl);
  dialogPhotoUrl = null;
}

function previewDialogPhoto(image, blob) {
  releaseDialogPhoto();
  dialogPhotoUrl = URL.createObjectURL(blob);
  image.src = dialogPhotoUrl;
  image.hidden = false;
}

dialog.addEventListener('close', () => {
  if (!dialog.open) releaseDialogPhoto();
});

function openDialog(title, content, wide = false) {
  releaseDialogPhoto();
  dialog.classList.toggle('wide-dialog', wide);
  setText('dialog-title', title);
  dialogContent.innerHTML = content;
  if (!dialog.open) dialog.showModal();
  ($('input:not([hidden]), select, [data-autofocus]', dialogContent) || $('.dialog-head button', dialog)).focus();
}

const conceptsByName = () => [...collectConcepts(data()).values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
const conceptForMovement = (id) => conceptsByName().find((concept) => concept.movements.some((entry) => entry.id === id));

function showConceptList(type) {
  const isIncome = type !== 'expense';
  const concepts = conceptsByName().filter((concept) => isIncome || concept.expenses > 0);
  openDialog(isIncome ? 'Ingresos por concepto' : 'Gastos por concepto', `
    <button class="button solid concept-add" type="button" data-action="new-concept-movement" data-type="${isIncome ? 'income' : 'expense'}" data-editable>${icon('plus', 16)} ${isIncome ? 'Añadir ingreso' : 'Añadir gasto'}</button>
    ${concepts.length ? '<label class="concept-search">Buscar concepto<input type="search" id="concept-search" placeholder="Ej. Analogue Pocket"></label>' : ''}
    <ul class="list concept-list" aria-label="Conceptos"></ul>
    <p class="feed-empty" id="concept-list-empty" hidden></p>`);
  const list = $('.concept-list', dialogContent);
  const noResults = $('#concept-list-empty');
  const search = $('#concept-search');
  const updateList = () => {
    const query = conceptKey(search?.value ?? '');
    const visible = concepts.filter(({ key }) => key.includes(query));
    list.innerHTML = visible.map((concept) => `<li><button type="button" class="concept-row" data-action="open-concept" data-concept="${esc(concept.key)}" data-type="${type}">
      <span>${esc(concept.name)}</span><strong class="${isIncome ? 'amount-in' : 'amount-out'}">${money(isIncome ? concept.income : concept.expenses)}</strong>${icon('right', 15)}
    </button></li>`).join('');
    noResults.hidden = Boolean(visible.length);
    noResults.textContent = concepts.length ? 'Sin coincidencias.' : 'Todavía no hay conceptos.';
  };
  search?.addEventListener('input', updateList);
  updateList();
  updateControls();
}

function showConcept(concept, returnTo = '') {
  const { key, name, income, expenses, assigned, movements, goals, targetPrice } = concept;
  const add = (type, label) => `<button class="button ${type === 'income' ? 'solid' : 'outline'}" type="button" data-action="new-concept-movement" data-concept="${esc(key)}" data-type="${type}" data-editable>${label}</button>`;
  const priceAction = `data-action="edit-target-price" data-concept="${esc(key)}" data-return-to="${esc(returnTo)}" data-editable`;
  openDialog(name, `
    ${returnTo ? `<button class="text-button concept-back" type="button" data-action="list-concepts" data-type="${esc(returnTo)}">${icon('left', 14)} Conceptos</button>` : ''}
    <div class="concept-totals">
      <div><span class="metric-caption">Ingresado</span><strong class="metric-value amount-in">${money(income)}</strong></div>
      <div><span class="metric-caption">Gastado</span><strong class="metric-value amount-out">${money(expenses)}</strong></div>
      <div><span class="metric-caption">Destinado</span><strong class="metric-value">${money(assigned)}</strong></div>
    </div>
    ${targetPrice ? `<div class="concept-target">
      <div><span>${money(assigned)} ahorrados de ${money(targetPrice)}</span>
        <strong>${assigned >= targetPrice ? 'Objetivo alcanzado' : `Te faltan ${money(targetPrice - assigned)}`}</strong></div>
      <button class="icon-button" type="button" ${priceAction} aria-label="Editar precio objetivo">${icon('pencil', 16)}</button>
    </div>` : `<button class="text-button concept-target-link" type="button" ${priceAction}>${icon('target', 16)} Fijar precio objetivo</button>`}
    <div class="concept-actions">${add('income', 'Añadir ingreso')}${add('expense', 'Añadir gasto')}</div>
    <section aria-label="Historial del concepto" class="concept-history">${movementsMarkup(entriesNewest(movements), true)}</section>
    ${goals.length ? `<details class="concept-reservations"><summary>Reservas anteriores · ${money(concept.priorReserve)}</summary>
      ${goals.map((goal) => `<div><strong>${esc(goal.name)} · ${money(contributionTotal(data(), goal.id))}</strong>
        ${button('history', 'Aportaciones', { id: goal.id })}${button('edit-goal', 'Editar reserva', { id: goal.id })}
      </div>`).join('')}
    </details>` : ''}`);
  updateControls();
}

function editTargetPrice(concept, returnTo) {
  const { key, name, targetPrice } = concept;
  openForm('Precio objetivo', `
    <p class="dialog-copy">${esc(name)}</p>
    ${input('Precio objetivo (€)', 'price', `inputmode="decimal" maxlength="22" placeholder="0,00" value="${targetPrice ? centsInput(targetPrice) : ''}"`)}
    ${targetPrice ? '<p class="dialog-copy">Deja el campo vacío para quitar el precio objetivo.</p>' : ''}`, 'Guardar', async ({ price }) => {
    const amount = price.trim() ? checkedAmount(price) : null;
    await changeAccount((state) => {
      state.targets = (state.targets ?? []).filter((target) => conceptKey(target.name) !== key);
      if (amount !== null) state.targets.push({ name, amount });
    });
    const updated = collectConcepts(data()).get(key);
    if (updated) showConcept(updated, returnTo);
    else showConceptList(returnTo);
  });
}

function setAppearance(mode) {
  const selected = applyTheme(mode);
  const toggle = $('[data-action="theme"]');
  toggle.setAttribute('aria-pressed', String(selected === 'light'));
  toggle.title = selected === 'light' ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro';
  return selected;
}

function openSettings() {
  openDialog('Ajustes', `<div class="settings-list">
    <button class="settings-item" type="button" data-action="opening" data-editable>${icon('pencil')} <span>Editar ahorro inicial</span>${icon('right', 14)}</button>
    <a class="settings-item" href="#copias" data-action="close-dialog">${icon('file')} <span>Copias CSV</span>${icon('right', 14)}</a>
    ${isStandalone() ? '' : `<button class="settings-item" type="button" data-action="install">${icon('download')} <span>Instalar app</span>${icon('right', 14)}</button>`}
    <button class="settings-item" type="button" data-action="toggle-demo" data-editable>${icon('mark')} <span>Ver ejemplo</span>${icon('right', 14)}</button>
  </div>`);
  updateControls();
}

function formError(error, form) {
  const box = $('.dialog-error', form);
  box.hidden = false;
  box.textContent = error.message || 'No se ha podido completar la operación.';
}

function openForm(title, fields, submit, onSubmit, onRemove, { compact = false } = {}) {
  openDialog(title, `<form class="dialog-form">
    <div class="form-fields">${fields}</div>
    <p class="dialog-error" role="alert" hidden></p>
    <div class="dialog-actions">
      ${!compact && onRemove ? '<button class="button outline remove" type="button" data-remove>Eliminar</button>' : ''}
      ${compact ? '' : '<button class="button outline" type="button" data-action="close-dialog">Cancelar</button>'}
      <button class="button solid" type="submit"${!fields.includes('<input') && !fields.includes('<select') ? ' data-autofocus' : ''}>${submit}</button>
    </div>
  </form>`);
  const form = $('form', dialogContent);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    const submitButton = $('button[type="submit"]', form);
    submitButton.disabled = true;
    try {
      await onSubmit(values, form);
    } catch (error) {
      formError(error, form);
    } finally {
      submitButton.disabled = false;
    }
  });
  if (onRemove) $('[data-remove]', form).addEventListener('click', onRemove);
}

function checkedAmount(value, options) {
  const amount = parseAmount(value, options);
  if (amount === null) throw new Error('Introduce un importe válido con un máximo de dos decimales.');
  return amount;
}

function requiredText(value) {
  if (!value.trim()) throw new Error('Introduce un nombre o concepto.');
  return value.trim();
}

const requiredDate = (value) => {
  if (!validDate(value)) throw new Error('Selecciona una fecha válida.');
  return value;
};
const centsInput = (value) => (value / 100).toFixed(2).replace('.', ',');
const update = (items, id, fields) => {
  const item = items.find((entry) => entry.id === id);
  if (!item) throw new Error('El registro ya no está disponible. Vuelve a abrirlo.');
  Object.assign(item, fields);
};

function finish(message) {
  dialog.close();
  notify(message);
}

function confirmAction(title, copy, label, mutation, message) {
  openForm(title, `<p class="dialog-copy">${esc(copy)}</p>`, label, async () => {
    await changeAccount(mutation);
    finish(message);
  });
}

function editOpening() {
  openForm('Ahorro inicial', `<p class="dialog-copy">Indica cuánto tenías ahorrado antes del primer movimiento que registres o importes.</p>
    ${input('Ahorro inicial (€)', 'opening', `required inputmode="decimal" maxlength="22" value="${centsInput(account.opening)}"`)}`, 'Guardar', async ({ opening }) => {
    const amount = checkedAmount(opening, { signed: true, zero: true });
    await changeAccount((state) => { state.opening = amount; });
    finish('Ahorro inicial actualizado.');
  });
}

const photoFields = `<div class="photo-field" hidden>
  <p>Foto del gasto</p>
  <div class="photo-detail">
    <img class="photo-preview" alt="Vista previa de la foto del gasto" hidden>
    <div class="photo-actions">
      <button type="button" class="text-button" data-photo-pick="camera">${icon('camera', 17)} Hacer foto</button>
      <button type="button" class="text-button" data-photo-pick="gallery">Elegir imagen</button>
      <button type="button" class="text-button" data-photo-remove hidden>Quitar foto</button>
      <button type="button" class="text-button" data-photo-undo hidden>Deshacer</button>
    </div>
    <input type="file" accept="image/*" capture="environment" data-photo-input="camera" aria-label="Hacer foto" hidden>
    <input type="file" accept="image/*" data-photo-input="gallery" aria-label="Elegir imagen" hidden>
    <p class="photo-status" role="status"></p>
  </div>
</div>`;

function configurePhotoField(form, existingId) {
  const field = $('.photo-field', form);
  const image = $('.photo-preview', field);
  const status = $('.photo-status', field);
  const remove = $('[data-photo-remove]', field);
  const undo = $('[data-photo-undo]', field);
  const warning = $('.photo-warning', form);
  let blob = null;
  let removed = false;
  let processing = false;
  let revision = 0;

  const updateView = () => {
    const hasPhoto = Boolean(blob || (existingId && !removed));
    field.hidden = form.elements.type.value !== 'expense';
    warning.hidden = !field.hidden || !hasPhoto;
    remove.hidden = !hasPhoto;
    undo.hidden = !removed || !existingId;
  };
  const resetPreview = () => {
    releaseDialogPhoto();
    image.removeAttribute('src');
    image.hidden = true;
  };
  const loadExisting = async () => {
    if (!existingId) return;
    const started = revision;
    try {
      const saved = await getPhoto(existingId);
      if (started !== revision || !form.isConnected || !dialog.open) return;
      if (!saved) throw new Error('La foto ya no está disponible en este navegador.');
      previewDialogPhoto(image, saved);
    } catch (error) {
      if (started === revision && form.isConnected && dialog.open) status.textContent = error.message;
    }
  };
  for (const picker of all('[data-photo-pick]', field)) {
    const fileInput = $('[data-photo-input="' + picker.dataset.photoPick + '"]', field);
    picker.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      const started = ++revision;
      processing = true;
      status.textContent = 'Preparando foto…';
      try {
        const prepared = await preparePhoto(file);
        if (started !== revision || !form.isConnected || !dialog.open) return;
        blob = prepared;
        removed = false;
        previewDialogPhoto(image, blob);
        status.textContent = 'Foto preparada. Guarda el gasto para adjuntarla.';
      } catch (error) {
        if (started === revision && form.isConnected && dialog.open) {
          status.textContent = error.message;
          if (!blob && !removed) loadExisting();
        }
      } finally {
        if (started === revision) {
          processing = false;
          updateView();
        }
      }
    });
  }
  remove.addEventListener('click', () => {
    revision += 1;
    processing = false;
    blob = null;
    removed = true;
    resetPreview();
    status.textContent = '';
    updateView();
  });
  undo.addEventListener('click', () => {
    removed = false;
    status.textContent = '';
    loadExisting();
    updateView();
  });
  form.elements.type.addEventListener('change', updateView);
  loadExisting();
  updateView();
  return () => {
    if (processing) throw new Error('Espera a que termine de prepararse la foto.');
    return { blob, removed };
  };
}

async function viewPhoto(movement) {
  openDialog('Foto del gasto', `<p class="dialog-copy">${esc(movement.name)} · ${money(movement.amount)}</p>
    <img class="photo-viewer" alt="Foto adjunta al gasto" hidden>
    <p class="photo-status" role="status">Abriendo foto…</p>`, true);
  const image = $('.photo-viewer', dialogContent);
  const status = $('.photo-status', dialogContent);
  try {
    const blob = await getPhoto(movement.photoId);
    if (!blob) throw new Error('La foto ya no está disponible en este navegador.');
    if (!image.isConnected || !dialog.open) return;
    previewDialogPhoto(image, blob);
    status.textContent = '';
  } catch (error) {
    if (status.isConnected && dialog.open) status.textContent = error.message;
  }
}

function editMovement(entry, defaultType = 'expense', destination) {
  if (entry) entry = { ...entry };
  const type = entry?.type ?? defaultType;
  const concepts = conceptsByName();
  const conceptPicker = '<details class="concept-picker" hidden><summary>Elegir un concepto</summary><ul class="list" aria-label="Conceptos registrados"></ul></details>';
  openForm(entry ? 'Editar movimiento' : defaultType === 'deposit' ? 'Depositar ahorro' : 'Nuevo movimiento', `
    <div class="form-grid">
      ${input('Importe (€)', 'amount', `required inputmode="decimal" maxlength="22" placeholder="0,00" value="${entry ? centsInput(entry.amount) : ''}"`)}
      ${select('Tipo', 'type', Object.entries(movementTypes).map(([key, label]) => option(key, label, key === type)).join(''))}
    </div>
    ${input('Concepto', 'name', `required maxlength="120" placeholder="Ej. Analogue Pocket" value="${esc(entry?.name ?? destination?.name ?? (defaultType === 'deposit' ? movementTypes.deposit : ''))}"`)}
    ${entry ? '' : conceptPicker}
    <details class="movement-details">
      <summary>Más detalles</summary>
      <div class="form-grid">
        ${input('Fecha', 'date', `required type="date" min="1900-01-01" value="${entry?.date || localDate()}"`)}
        ${input('Categoría (opcional)', 'category', `list="categories" maxlength="64" value="${esc(entry?.category)}"`)}
      </div>
      ${categoryShortcuts}
      ${entry ? conceptPicker : ''}
      ${photoFields}
      ${entry ? '<button class="text-button remove-movement" type="button" data-remove>Eliminar movimiento</button>' : ''}
    </details>
    <p class="dialog-copy photo-warning" hidden>La foto se quitará al guardar el movimiento con este tipo.</p>`, 'Guardar', async (fields) => {
    const movement = { type: fields.type, amount: checkedAmount(fields.amount), name: requiredText(fields.name), date: requiredDate(fields.date), category: fields.category.trim() };
    const { blob, removed } = readPhoto();
    const photos = new Map();
    if (blob && fields.type === 'expense') {
      movement.photoId = uid();
      photos.set(movement.photoId, blob);
    }
    await changeAccount((state) => {
      if (entry) {
        const current = state.movements.find((item) => item.id === entry.id);
        if (current && (removed || fields.type !== 'expense')) delete current.photoId;
        update(state.movements, entry.id, movement);
      } else state.movements.push({ ...movement, id: uid(), source: '' });
    }, photos);
    const message = entry ? 'Movimiento actualizado.' : fields.type === 'deposit' ? 'Depósito añadido a tu ahorro.' : 'Movimiento guardado.';
    const concept = destination && (entry ? conceptForMovement(entry.id) : collectConcepts(data()).get(conceptKey(movement.name)));
    if (concept) {
      showConcept(concept);
      notify(message);
    } else finish(message);
  }, entry && (() => confirmAction('Eliminar movimiento', entry.photoId ? 'Se eliminarán el gasto y su foto adjunta.' : 'Se eliminará este registro y se recalculará tu ahorro.', 'Eliminar', (state) => {
    state.movements = state.movements.filter((movement) => movement.id !== entry.id);
  }, 'Movimiento eliminado.')), { compact: true });
  const form = $('form', dialogContent);
  const details = $('.movement-details', form);
  details.addEventListener('invalid', () => { details.open = true; }, true);
  const readPhoto = configurePhotoField(form, entry?.photoId);
  const picker = $('.concept-picker', form);
  const conceptInput = form.elements.name;
  const conceptItems = $('.list', picker);
  conceptItems.innerHTML = concepts.map(({ name }) => `<li><button type="button" class="concept-choice" data-choice="${esc(name)}">${esc(name)}</button></li>`).join('');
  const updateConceptPicker = () => {
    picker.hidden = !concepts.length || form.elements.type.value !== 'income';
    picker.open = !picker.hidden && !entry && !destination;
  };
  form.elements.type.addEventListener('change', updateConceptPicker);
  updateConceptPicker();
  conceptItems.addEventListener('click', (event) => {
    const choice = event.target.closest('[data-choice]');
    if (!choice) return;
    conceptInput.value = choice.dataset.choice;
    picker.open = false;
    conceptInput.focus();
  });
  const categoryField = form.elements.category;
  const shortcuts = all('[data-category]', form);
  const updateCategory = () => {
    const selected = normal(categoryField.value.trim());
    for (const shortcut of shortcuts) shortcut.setAttribute('aria-pressed', String(normal(shortcut.dataset.category) === selected));
  };
  for (const shortcut of shortcuts) shortcut.addEventListener('click', () => {
    categoryField.value = shortcut.dataset.category;
    updateCategory();
  });
  categoryField.addEventListener('input', updateCategory);
  updateCategory();
}

function editGoal(goal) {
  openForm('Editar reserva anterior', `
    ${input('Nombre del objetivo', 'name', `required maxlength="80" placeholder="Ej. Fondo de emergencia" value="${esc(goal?.name)}"`)}
    <div class="form-grid">
      ${input('Importe objetivo (€)', 'target', `required inputmode="decimal" maxlength="22" placeholder="0,00" value="${goal ? centsInput(goal.target) : ''}"`)}
      ${input('Fecha límite (opcional)', 'deadline', `type="date" min="1900-01-01" value="${goal?.deadline || ''}"`)}
    </div>`, 'Guardar', async (fields) => {
    const values = { name: requiredText(fields.name), target: checkedAmount(fields.target), deadline: fields.deadline ? requiredDate(fields.deadline) : '' };
    await changeAccount((state) => update(state.goals, goal.id, values));
    finish('Reserva anterior actualizada.');
  }, () => confirmAction('Eliminar reserva anterior', 'Sus aportaciones volverán al ahorro disponible.', 'Eliminar', (state) => {
    state.goals = state.goals.filter((entry) => entry.id !== goal.id);
    state.contributions = state.contributions.filter((entry) => entry.goalId !== goal.id);
  }, 'Reserva anterior eliminada.'));
}

function editContribution(goal, entry) {
  let reviewed = account;
  const showFunding = (form) => {
    const amount = parseAmount(form.elements.amount.value) ?? 0;
    const previous = reviewed.contributions.find((item) => item.id === entry?.id)?.amount ?? 0;
    const deposit = fundingNeeded(reviewed, amount, previous);
    const notice = $('#funding-notice', form);
    $('#funding-available', form).textContent = `Ahorro disponible · ${money(Math.max(0, available(reviewed)))}`;
    notice.textContent = deposit ? `Se añadirá un depósito de ${money(deposit)} para completar la aportación.` : '';
    $('button[type="submit"]', form).textContent = deposit ? 'Depositar y aportar' : 'Guardar';
    return deposit;
  };
  openForm('Editar aportación', `
    <p class="dialog-copy">${esc(goal.name)}<br /><span id="funding-available"></span></p>
    <div class="form-grid">
      ${input('Importe (€)', 'amount', `required inputmode="decimal" maxlength="22" value="${entry ? centsInput(entry.amount) : ''}" placeholder="0,00"`)}
      ${input('Fecha', 'date', `required type="date" min="1900-01-01" value="${entry?.date || localDate()}"`)}
    </div><p class="dialog-copy funding-note" id="funding-notice" aria-live="polite"></p>`, 'Guardar', async (fields, form) => {
    const amount = checkedAmount(fields.amount);
    const date = requiredDate(fields.date);
    const expectedDeposit = showFunding(form);
    await changeAccount((state) => {
      const previous = state.contributions.find((item) => item.id === entry?.id);
      const deposit = fundingNeeded(state, amount, previous?.amount);
      if (deposit !== expectedDeposit) {
        reviewed = state;
        showFunding(form);
        throw new Error('El ahorro disponible cambió. Revisa el importe del depósito y vuelve a guardar.');
      }
      update(state.contributions, entry.id, { amount, date });
      if (deposit) state.movements.push({ id: uid(), type: 'deposit', amount: deposit, date, name: 'Depósito para ' + goal.name, category: '', source: '' });
    });
    finish(expectedDeposit ? `Aportación guardada con un depósito de ${money(expectedDeposit)}.` : 'Aportación actualizada.');
  }, () => confirmAction('Eliminar aportación', 'El importe volverá al ahorro disponible.', 'Eliminar', (state) => {
    state.contributions = state.contributions.filter((item) => item.id !== entry.id);
  }, 'Aportación eliminada.'));
  const form = $('form', dialogContent);
  form.elements.amount.addEventListener('input', () => showFunding(form));
  showFunding(form);
}

function showHistory(goal) {
  const entries = entriesNewest(data().contributions.filter((entry) => entry.goalId === goal.id));
  openDialog('Aportaciones', `<p class="dialog-copy">${esc(goal.name)} · ${money(contributionTotal(data(), goal.id))}</p>
    ${entries.length ? `<ul class="list history-list">${entries.map((entry) => `<li>
      <span class="dialog-copy">${displayDate(entry.date)}</span><strong>${money(entry.amount)}</strong>
      ${demo || storageError ? '' : `<button class="icon-button" type="button" data-action="edit-contribution" data-id="${entry.id}" aria-label="Editar aportación">${icon('pencil', 16)}</button>`}
    </li>`).join('')}</ul>` : '<p class="dialog-copy">Todavía no hay aportaciones.</p>'}
    <div class="dialog-actions"><button class="button outline" data-action="close-dialog" type="button">Cerrar</button></div>`);
}

async function downloadAccount(withPhotos) {
  try {
    const snapshot = storedAccount();
    const attachments = new Map();
    if (withPhotos) {
      let encodedLength = 0;
      for (const { id, photoId } of snapshot.movements) {
        if (!photoId) continue;
        const photo = await getPhoto(photoId);
        if (!photo) throw new Error('Falta una foto en el almacenamiento local. Puedes descargar el CSV sin fotos.');
        const encoded = await encodePhoto(photo);
        encodedLength += encoded.length;
        if (encodedLength > MAX_CSV_BYTES) throw new Error('La copia con fotos supera los 64 MB. Puedes descargar el CSV sin fotos.');
        attachments.set(id, encoded);
      }
    }
    const file = new Blob([exportCSV(snapshot, attachments)], { type: 'text/csv;charset=utf-8' });
    if (file.size > MAX_CSV_BYTES) throw new Error('La copia supera los 64 MB.');
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'aparta-copia-' + (attachments.size ? 'con-fotos-' : '') + localDate() + '.csv';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify(attachments.size ? 'Copia CSV con fotos descargada.' : 'Copia CSV descargada.');
  } catch (error) {
    notify(error.message);
  }
}

function previewBackup({ account: restored, photos }) {
  const counts = [
    plural(restored.movements.length, 'movimiento'),
    plural(restored.goals.length, 'objetivo'),
    plural(restored.contributions.length, 'aportación', 'aportaciones'),
  ];
  if (restored.targets.length) counts.push(plural(restored.targets.length, 'precio objetivo', 'precios objetivo'));
  const reviewed = JSON.stringify(account);
  const hadPhotos = photoIds(account).length > 0;
  openForm('Restaurar copia de Aparta', `
    <p class="dialog-copy">La copia contiene ${counts.join(', ')} y ${plural(photos.size, 'foto')}. Ahorro inicial de ${money(restored.opening)}.</p>
    <p class="dialog-copy">Al restaurarla se reemplazará tu cuenta de este navegador${hadPhotos ? ', incluidas las fotos actuales' : ''}.</p>
    <div><button type="button" class="button outline" data-action="${hadPhotos ? 'export-photos' : 'export'}">${hadPhotos ? 'Descargar mi copia con fotos' : 'Descargar mi copia actual'}</button></div>`, 'Restaurar cuenta', async () => {
    const decoded = new Map();
    for (const [id, image] of photos) decoded.set(id, await decodePhoto(image));
    await changeAccount((state) => {
      if (JSON.stringify(state) !== reviewed) throw new Error('La cuenta cambió después de abrir esta copia. Vuelve a seleccionarla para revisar los datos actuales.');
      Object.assign(state, restored);
    }, decoded);
    finish('Cuenta restaurada.');
  });
}

function mapBankColumns(rows, filename) {
  const header = rows[0];
  if (header.length < 3 || rows.length < 2) throw new Error('El CSV bancario necesita una cabecera y al menos un movimiento.');
  const guessed = guessColumns(header);
  const split = guessed.amount < 0 && guessed.credit >= 0 && guessed.debit >= 0;
  const field = (name, label, optional = false) => select(label, name, option(-1, optional ? 'Ninguna' : 'Selecciona columna', guessed[name] < 0) +
    header.map((title, index) => option(index, title.trim() || 'Columna ' + (index + 1), guessed[name] === index)).join(''));
  openForm('Importar movimientos', `
    <p class="dialog-copy">${esc(filename)} · ${plural(rows.length - 1, 'fila de datos', 'filas de datos')}</p>
    <div class="form-grid">${field('date', 'Fecha')}${field('name', 'Concepto')}</div>
    ${select('Formato de los importes', 'mode', option('signed', 'Un importe con signo', !split) + option('split', 'Cargos y abonos en columnas separadas', split))}
    <div id="mapping-signed">${field('amount', 'Importe con signo')}</div>
    <div class="form-grid" id="mapping-split">${field('debit', 'Cargos o gastos')}${field('credit', 'Abonos o ingresos')}</div>
    ${field('category', 'Categoría (opcional)', true)}
    <p class="dialog-copy">En una columna con signo, los números negativos se leen como gastos y los positivos como ingresos.</p>`, 'Revisar importación', (values) => {
    const mapping = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, key === 'mode' ? value : Number(value)]));
    previewBankImport(rows, mapping);
  });
  const mode = $('[name="mode"]', dialogContent);
  const showMode = () => {
    $('#mapping-signed').hidden = mode.value === 'split';
    $('#mapping-split').hidden = mode.value !== 'split';
  };
  mode.addEventListener('change', showMode);
  showMode();
}

function previewBankImport(rows, mapping) {
  const { movements, duplicates, invalid } = bankMovements(rows, mapping, account.movements);
  const summary = `<p class="dialog-copy">${plural(movements.length, 'movimiento nuevo')}, ${plural(duplicates, 'duplicado')} y ${plural(invalid.length, 'fila sin datos válidos', 'filas sin datos válidos')}.</p>
    ${invalid.length ? `<p class="dialog-copy">Filas omitidas: ${invalid.slice(0, 12).join(', ')}${invalid.length > 12 ? '…' : ''}.</p>` : ''}`;
  if (!movements.length) {
    openDialog('Revisar importación', summary + '<div class="dialog-actions"><button class="button outline" type="button" data-action="close-dialog">Cerrar</button></div>');
    return;
  }
  openForm('Revisar importación', summary + `
    <ul class="list history-list">${movements.slice(0, 3).map((entry) => `<li><span class="dialog-copy">${esc(entry.name)}</span><strong>${entry.type === 'expense' ? '−' : '+'}${money(entry.amount)}</strong></li>`).join('')}</ul>
    <p class="dialog-copy">Se añadirán los movimientos válidos a tu cuenta actual.</p>`, 'Añadir movimientos', async () => {
    let added;
    await changeAccount((state) => {
      const latest = bankMovements(rows, mapping, state.movements);
      added = latest.movements.length;
      if (added !== movements.length) throw new Error('La cuenta cambió durante la revisión. Vuelve a abrir el CSV para actualizar la vista previa.');
      state.movements = state.movements.concat(latest.movements);
    });
    finish(plural(added, 'movimiento importado', 'movimientos importados') + '.');
  });
}

async function importFile(file) {
  if (!file) return;
  try {
    if (file.size > MAX_CSV_BYTES) throw new Error('El CSV supera el tamaño máximo de 64 MB.');
    const bytes = await file.arrayBuffer();
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      text = new TextDecoder('windows-1252').decode(bytes);
    }
    if (file.size > 5 * 1024 * 1024 && !text.trimStart().startsWith('webapp_ahorro')) {
      throw new Error('El CSV bancario supera el tamaño máximo de 5 MB.');
    }
    const rows = readCSV(text);
    if (isBackup(rows)) previewBackup(importBackup(rows));
    else mapBankColumns(rows, file.name);
  } catch (error) {
    openDialog('No se pudo leer el CSV', `<p class="dialog-copy">${esc(error.message)}</p>
      <div class="dialog-actions"><button class="button outline" type="button" data-action="close-dialog">Cerrar</button></div>`);
  }
}

document.addEventListener('click', async (event) => {
  const trigger = event.target.closest('[data-action]');
  if (!trigger || trigger.disabled) return;
  const { action, id } = trigger.dataset;
  const state = data();
  const goal = id ? state.goals.find((entry) => entry.id === id) : null;
  switch (action) {
    case 'settings': openSettings(); break;
    case 'theme': {
      const mode = setAppearance(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
      try { localStorage.setItem(THEME_KEY, mode); } catch { /* The current page can still use the selected theme. */ }
      break;
    }
    case 'new-movement': editMovement(); break;
    case 'new-deposit': editMovement(null, 'deposit'); break;
    case 'list-concepts': showConceptList(trigger.dataset.type); break;
    case 'open-concept': {
      const concept = collectConcepts(state).get(trigger.dataset.concept);
      if (concept) showConcept(concept, trigger.dataset.type);
      break;
    }
    case 'open-movement-concept': {
      const concept = conceptForMovement(id);
      if (concept) showConcept(concept);
      break;
    }
    case 'edit-target-price': {
      const concept = collectConcepts(state).get(trigger.dataset.concept);
      if (concept) editTargetPrice(concept, trigger.dataset.returnTo);
      break;
    }
    case 'new-concept-movement': {
      const concept = collectConcepts(state).get(trigger.dataset.concept);
      editMovement(null, trigger.dataset.type === 'income' ? 'income' : 'expense', concept);
      break;
    }
    case 'edit-movement': {
      const entry = state.movements.find((item) => item.id === id);
      if (entry) editMovement(entry, entry.type, conceptForMovement(id));
      break;
    }
    case 'view-photo': {
      const entry = state.movements.find((item) => item.id === id);
      if (entry?.photoId) viewPhoto(entry);
      break;
    }
    case 'opening': editOpening(); break;
    case 'edit-goal': if (goal) editGoal(goal); break;
    case 'edit-contribution': {
      const entry = state.contributions.find((item) => item.id === id);
      const parent = entry && state.goals.find((item) => item.id === entry.goalId);
      if (parent) editContribution(parent, entry);
      break;
    }
    case 'history': if (goal) showHistory(goal); break;
    case 'previous-month':
    case 'next-month':
      month = shiftMonth(month, action === 'previous-month' ? -1 : 1);
      renderAnalysis();
      updateControls();
      break;
    case 'toggle-demo':
      if (dialog.open) dialog.close();
      demo = demoAccount();
      month = current();
      render();
      $('#demo-banner button').focus();
      break;
    case 'exit-demo':
      demo = null;
      month = current();
      render();
      $('[data-action="settings"]').focus();
      break;
    case 'export':
    case 'export-photos':
      trigger.disabled = true;
      await downloadAccount(action === 'export-photos');
      trigger.disabled = false;
      break;
    case 'import': $('#csv-file').click(); break;
    case 'close-dialog': dialog.close(); break;
    case 'install': {
      if (await installApp().catch(() => false)) break;
      openDialog('Instalar Aparta', `
        <p class="dialog-copy"><strong>Chrome, Edge o Safari en Mac</strong> · Abre el menú del navegador y busca «Instalar» o «Añadir al Dock».</p>
        <p class="dialog-copy"><strong>Safari en iPhone o iPad</strong> · Pulsa Compartir y después «Añadir a pantalla de inicio».</p>
        <p class="dialog-copy"><strong>Chrome en Android</strong> · Abre el menú y elige «Añadir a pantalla de inicio» o «Instalar aplicación».</p>
        <div class="dialog-actions"><button class="button outline" type="button" data-action="close-dialog">Cerrar</button></div>`);
      break;
    }
  }
});

$('#csv-file').addEventListener('change', (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  importFile(file);
});
for (const id of ['movement-query', 'movement-type', 'movement-month', 'movement-category']) {
  $('#' + id).addEventListener(id === 'movement-query' ? 'input' : 'change', () => {
    renderMovements();
    updateControls();
  });
}
$('#categories').innerHTML = [...categories, ...Object.keys(categoryIcons)].map((name) => option(name, name)).join('');
window.addEventListener('hashchange', () => navigate(true));
window.addEventListener('storage', (event) => {
  if (event.key === THEME_KEY || event.key === null) setAppearance(event.newValue);
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  loadAccount();
  render();
});
loadAccount();
setAppearance(document.documentElement.dataset.theme);
navigate();
