import { VERSION, emptyAccount, parseAmount, uid, validDate, validateAccount } from './account.js';

const columns = ['webapp_ahorro', 'clase', 'id', 'fecha', 'concepto', 'categoria', 'tipo', 'centimos', 'fecha_limite', 'objetivo_id', 'origen'];
const photoColumn = 'foto_jpeg_base64';
const protect = (text) => /^[\s]*[=+\-@']|^[\t\r\n]/u.test(text) ? "'" + text : text;
const unprotect = (text) => text.startsWith("'") && protect(text.slice(1)) === text ? text.slice(1) : text;
const escapeField = (value) => {
  const text = String(value ?? '');
  return /[;"\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
};

export function exportCSV(account, photos = new Map()) {
  const rows = [columns, [VERSION, 'cuenta', '', '', '', '', '', account.opening, '', '', '']];
  for (const entry of account.movements) {
    rows.push([VERSION, 'movimiento', entry.id, entry.date, protect(entry.name), protect(entry.category), entry.type, entry.amount, '', '', protect(entry.source)]);
  }
  for (const goal of account.goals) {
    rows.push([VERSION, 'objetivo', goal.id, '', protect(goal.name), '', '', goal.target, goal.deadline, '', '']);
  }
  for (const entry of account.contributions) {
    rows.push([VERSION, 'aportacion', entry.id, entry.date, '', '', '', entry.amount, '', entry.goalId, '']);
  }
  for (const target of account.targets ?? []) {
    rows.push([VERSION, 'precio_objetivo', '', '', protect(target.name), '', '', target.amount, '', '', '']);
  }
  const includePhotos = photos.size > 0;
  return '\uFEFF' + rows.map((row, index) => {
    const fields = includePhotos ? [...row, index === 0 ? photoColumn : photos.get(row[2]) ?? ''] : row;
    return fields.map(escapeField).join(';');
  }).join('\r\n') + '\r\n';
}

function detectSeparator(text) {
  const counts = new Map([[';', 0], [',', 0], ['\t', 0]]);
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === '\r' || char === '\n')) break;
    else if (!quoted && counts.has(char)) counts.set(char, counts.get(char) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0][0];
}

export function readCSV(input, separator) {
  const text = input.replace(/^\uFEFF/, '').trimStart();
  const delimiter = separator || detectSeparator(text);
  const unquoted = { ';': /[^;"\r\n]+/y, ',': /[^,"\r\n]+/y, '\t': /[^\t"\r\n]+/y }[delimiter];
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let endedQuote = false;
  const pushField = () => {
    row.push(field);
    field = '';
    endedQuote = false;
  };
  const pushRow = () => {
    pushField();
    if (row.some((cell) => cell.trim())) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char !== '"') field += char;
      else if (text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        quoted = false;
        endedQuote = true;
      }
    } else if (char === delimiter) pushField();
    else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      pushRow();
    } else if (char === '"' && !field && !endedQuote) quoted = true;
    else if (endedQuote && /\s/.test(char)) continue;
    else if (char === '"' || endedQuote) throw new Error('Hay comillas mal cerradas en el CSV.');
    else if (unquoted) {
      unquoted.lastIndex = i;
      field += unquoted.exec(text)[0];
      i = unquoted.lastIndex - 1;
    } else field += char;
  }
  if (quoted) throw new Error('Hay comillas mal cerradas en el CSV.');
  pushRow();
  if (!rows.length) throw new Error('El CSV está vacío.');
  return rows;
}

export function isBackup(rows) {
  return rows[0][0].trim().toLowerCase() === columns[0];
}

export function importBackup(rows) {
  const [header, ...data] = rows;
  const withPhotos = header.length === columns.length + 1 && header.at(-1) === photoColumn;
  if ((!withPhotos && header.length !== columns.length) || columns.some((name, index) => name !== header[index])) {
    throw new Error('Las columnas no coinciden con una copia de Aparta.');
  }
  const account = emptyAccount();
  const photos = new Map();
  let seenAccount = false;
  for (const row of data) {
    const [version, kind, id, date, name, category, type, cents, deadline, goalId, source, photo] = row;
    if (row.length !== header.length || version !== String(VERSION) || !/^-?\d+$/.test(cents) ||
        (photo && (kind !== 'movimiento' || type !== 'expense'))) {
      throw new Error('La copia contiene una fila incorrecta o usa otra versión del formato.');
    }
    const amount = Number(cents);
    if (kind === 'cuenta' && !seenAccount) {
      account.opening = amount;
      seenAccount = true;
    } else if (kind === 'movimiento') {
      const movement = { id, date, name: unprotect(name), category: unprotect(category), type, amount, source: unprotect(source) };
      if (photo) {
        movement.photoId = uid();
        photos.set(movement.photoId, photo);
      }
      account.movements.push(movement);
    } else if (kind === 'objetivo') {
      account.goals.push({ id, name: unprotect(name), target: amount, deadline });
    } else if (kind === 'aportacion') {
      account.contributions.push({ id, goalId, date, amount });
    } else if (kind === 'precio_objetivo') {
      account.targets.push({ name: unprotect(name), amount });
    } else {
      throw new Error('La copia contiene un tipo de fila desconocido o dos filas de cuenta.');
    }
  }
  if (!seenAccount) throw new Error('Falta la fila de cuenta en la copia.');
  return { account: validateAccount(account), photos };
}

function bankDate(input) {
  const text = input.trim();
  if (validDate(text)) return text;
  const dmy = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  const ymd = text.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/);
  if (!dmy && !ymd) return null;
  const [, year, month, day] = ymd || [null, dmy[3], dmy[2], dmy[1]];
  const date = [year, month.padStart(2, '0'), day.padStart(2, '0')].join('-');
  return validDate(date) ? date : null;
}

const simplify = (text) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

export function guessColumns(header) {
  const names = header.map(simplify);
  const find = (patterns) => names.findIndex((name) => patterns.some((pattern) => pattern.test(name)));
  return {
    date: find([/^fecha/, /^date/]),
    name: find([/concepto/, /descripcion/, /detalle/, /description/, /merchant/, /titular/]),
    amount: find([/^importe/, /^cantidad/, /^amount/, /^movimiento/]),
    debit: find([/cargo/, /debit/, /gasto/]),
    credit: find([/abono/, /credit/, /ingreso/]),
    category: find([/categor/]),
  };
}

export function bankMovements(rows, mapping, existing) {
  const selected = [mapping.date, mapping.name, mapping.category];
  if (mapping.mode === 'split') {
    if (mapping.credit < 0 || mapping.debit < 0) throw new Error('Selecciona las columnas de cargos y abonos.');
    selected.push(mapping.credit, mapping.debit);
  } else selected.push(mapping.amount);
  const used = selected.filter((index) => index >= 0);
  if (mapping.date < 0 || mapping.name < 0 || (mapping.mode !== 'split' && mapping.amount < 0) || new Set(used).size !== used.length) {
    throw new Error('Elige una columna distinta para cada campo obligatorio.');
  }

  const counts = new Map();
  const fingerprint = (date, amount, name) => JSON.stringify([date, amount, simplify(name).replace(/\s+/g, ' ')]);
  const seen = new Set(existing.map((entry) => entry.source).filter(Boolean));
  const movements = [];
  const invalid = [];
  let duplicates = 0;
  for (const [index, row] of rows.slice(1).entries()) {
    const date = bankDate(row[mapping.date] ?? '');
    const name = (row[mapping.name] ?? '').trim();
    const category = (row[mapping.category] ?? '').trim();
    let cents;
    if (mapping.mode === 'split') {
      const read = (idx) => row[idx]?.trim() ? parseAmount(row[idx], { signed: true, zero: true }) : 0;
      const debit = read(mapping.debit);
      const credit = read(mapping.credit);
      cents = debit === null || credit === null || (debit && credit) ? null : Math.abs(credit) - Math.abs(debit);
    } else {
      cents = parseAmount(row[mapping.amount] ?? '', { signed: true });
    }
    if (!date || !name || name.length > 120 || category.length > 64 || !cents) {
      invalid.push(index + 2);
      continue;
    }
    const key = fingerprint(date, cents, name);
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    const source = 'csv:' + key + ':' + count;
    if (seen.has(source)) {
      duplicates += 1;
      continue;
    }
    movements.push({ id: uid(), date, name, category, type: cents < 0 ? 'expense' : 'income', amount: Math.abs(cents), source });
  }
  return { movements, invalid, duplicates };
}
