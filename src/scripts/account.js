export const VERSION = 1;
export const LIMIT = 99_999_999_999;
export const STORAGE_KEY = 'webapp-ahorro:v1';

export const emptyAccount = () => ({ version: VERSION, opening: 0, movements: [], goals: [], contributions: [], targets: [] });
export const uid = () => globalThis.crypto.randomUUID();
export const sum = (list) => list.reduce((total, value) => total + value, 0);
export const net = (movement) => movement.type === 'expense' ? -movement.amount : movement.amount;
export const balance = (account) => account.opening + sum(account.movements.map(net));
export const reserved = (account) => sum(account.contributions.map((entry) => entry.amount));
export const available = (account) => balance(account) - reserved(account);
export const contributionTotal = (account, id) => sum(account.contributions.filter((entry) => entry.goalId === id).map((entry) => entry.amount));
export const fundingNeeded = (account, amount, previousAmount = 0) => Math.max(0, amount - previousAmount - Math.max(0, available(account)));

const euros = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
export const money = (cents) => euros.format(cents / 100);

export function localDate(date = new Date()) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((part) => String(part).padStart(2, '0')).join('-');
}

export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01') return false;
  const date = new Date(value + 'T12:00:00Z');
  return !Number.isNaN(+date) && date.toISOString().slice(0, 10) === value;
}

export function displayDate(value, options = { day: 'numeric', month: 'short', year: 'numeric' }) {
  return new Intl.DateTimeFormat('es-ES', options).format(new Date(value + 'T12:00:00'));
}

export function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  return localDate(new Date(y, m - 1 + delta, 1)).slice(0, 7);
}

export function monthLabel(month, format = 'long') {
  return displayDate(month + '-01', { month: format, ...(format === 'long' && { year: 'numeric' }) });
}

export function parseAmount(input, { signed = false, zero = false } = {}) {
  let text = String(input).trim().replace(/[\s\u00a0\u202f€]/g, '').replace(/^−/, '-');
  // Treat the last separator as decimal when both styles occur.
  const comma = text.lastIndexOf(',');
  const dot = text.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    const separator = comma > dot ? ',' : '.';
    const groups = separator === ',' ? '.' : ',';
    text = text.replaceAll(groups, '').replace(separator, '.');
  } else if (/^[+-]?\d{1,3}(?:[.,]\d{3})+$/.test(text)) {
    text = text.replace(/[.,]/g, '');
  } else {
    text = text.replace(',', '.');
  }
  if (!/^[+-]?\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.replace(/^[+-]/, '').split('.');
  const amount = (Number(whole) * 100 + Number(fraction.padEnd(2, '0'))) * (text.startsWith('-') ? -1 : 1);
  if (!Number.isSafeInteger(amount) || Math.abs(amount) > LIMIT || (!signed && amount < 0) || (!zero && amount === 0)) return null;
  return amount || 0;
}

export function monthSummary(account, month) {
  return movementTotals(account.movements.filter((movement) => movement.date.startsWith(month)));
}

export function movementTotals(movements) {
  const income = sum(movements.filter((entry) => entry.type !== 'expense').map((entry) => entry.amount));
  const expenses = sum(movements.filter((entry) => entry.type === 'expense').map((entry) => entry.amount));
  return { income, expenses, savings: income - expenses };
}

export const conceptKey = (name) => name.trim().replace(/\s+/g, ' ').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export function collectConcepts(account) {
  const concepts = new Map();
  const legacyGoals = new Map();
  const legacyPrefix = 'deposito para ';
  const get = (name) => {
    const key = conceptKey(name);
    if (!concepts.has(key)) {
      concepts.set(key, { key, name, movements: [], goals: [], contributions: [], legacyFunding: 0 });
    }
    return concepts.get(key);
  };
  for (const goal of account.goals) {
    const concept = get(goal.name);
    concept.goals.push(goal);
    legacyGoals.set(goal.id, concept);
  }
  for (const record of account.contributions) legacyGoals.get(record.goalId)?.contributions.push(record);
  for (const movement of account.movements) {
    const key = conceptKey(movement.name);
    const legacy = movement.type === 'deposit' && key.startsWith(legacyPrefix) ? concepts.get(key.slice(legacyPrefix.length)) : undefined;
    const concept = legacy?.goals.length ? legacy : get(movement.name);
    concept.movements.push(movement);
    if (concept === legacy) concept.legacyFunding += movement.amount;
  }
  for (const target of account.targets ?? []) get(target.name).targetPrice = target.amount;
  for (const concept of concepts.values()) {
    const totals = movementTotals(concept.movements);
    const priorReserve = sum(concept.contributions.map((entry) => entry.amount));
    Object.assign(concept, totals, {
      priorReserve,
      // Legacy funding is also represented in the corresponding reservations.
      assigned: Math.max(0, totals.savings - concept.legacyFunding + priorReserve),
    });
  }
  return concepts;
}

const validId = (value) => typeof value === 'string' && /^[\w-]{1,80}$/.test(value);
const validText = (value, max, required = false) => typeof value === 'string' && value.length <= max && (!required || value.trim().length > 0);
const validAmount = (amount, min = 1) => Number.isSafeInteger(amount) && amount >= min && amount <= LIMIT;

export function validateAccount(account) {
  if (account?.version !== VERSION || !validAmount(account.opening, -LIMIT) ||
      !Array.isArray(account.movements) || !Array.isArray(account.goals) || !Array.isArray(account.contributions) ||
      (account.targets !== undefined && !Array.isArray(account.targets))) {
    throw new Error('El formato de la cuenta no es válido.');
  }
  const ids = new Set();
  const uniqueId = (id) => {
    if (!validId(id) || ids.has(id)) return false;
    ids.add(id);
    return true;
  };
  for (const movement of account.movements) {
    if (!movement || !uniqueId(movement.id) || !validDate(movement.date) || !validAmount(movement.amount) ||
        !['income', 'expense', 'deposit'].includes(movement.type) || !validText(movement.name, 120, true) ||
        !validText(movement.category, 64) || !validText(movement.source, 1024) ||
        (movement.photoId !== undefined && (movement.type !== 'expense' || !uniqueId(movement.photoId)))) {
      throw new Error('Hay un movimiento incompleto, duplicado o con valores incorrectos.');
    }
  }
  const goals = new Set();
  for (const goal of account.goals) {
    if (!goal || !uniqueId(goal.id) || !validText(goal.name, 80, true) || !validAmount(goal.target) ||
        (goal.deadline !== '' && !validDate(goal.deadline))) {
      throw new Error('Hay un objetivo incompleto, duplicado o con valores incorrectos.');
    }
    goals.add(goal.id);
  }
  for (const entry of account.contributions) {
    if (!entry || !uniqueId(entry.id) || !goals.has(entry.goalId) || !validAmount(entry.amount) || !validDate(entry.date)) {
      throw new Error('Hay una aportación incorrecta o sin objetivo asociado.');
    }
  }
  const targetKeys = new Set();
  for (const target of account.targets ?? []) {
    if (!target || !validText(target.name, 120, true) || !validAmount(target.amount)) {
      throw new Error('Hay un precio objetivo incorrecto.');
    }
    const key = conceptKey(target.name);
    if (targetKeys.has(key)) throw new Error('Hay más de un precio objetivo para el mismo concepto.');
    targetKeys.add(key);
  }
  return account;
}

export const categories = ['Alimentación', 'Hogar', 'Transporte', 'Ocio', 'Salud', 'Compras', 'Sueldo', 'Otros'];
