import { emptyAccount, localDate, shiftMonth } from './account.js';

export function demoAccount() {
  const account = emptyAccount();
  account.opening = 100000;
  const now = localDate();
  const month = now.slice(0, 7);
  for (const [offset, expenses] of [129500, 169000, 103000, 155000, 115600, 108250].entries()) {
    const prefix = shiftMonth(month, offset - 5);
    const date = (day) => prefix + '-' + String(prefix === month ? Math.min(day, Number(now.slice(8))) : day).padStart(2, '0');
    const add = (id, day, name, category, type, amount) => account.movements.push({id: 'demo-' + offset + '-' + id, date: date(day), name, category, type, amount, source: ''});
    add('pay', 1, 'Nómina', 'Sueldo', 'income', 185000);
    add('rent', 3, 'Alquiler', 'Hogar', 'expense', 73500);
    add('shop', 8, 'Compra semanal', 'Alimentación', 'expense', 8550);
    add('train', 12, 'Transporte', 'Transporte', 'expense', 4200);
    add('other', 16, 'Otros gastos', 'Otros', 'expense', expenses - 86250);
  }
  account.goals = [
    { id: 'demo-emergency', name: 'Fondo de emergencia', target: 300000, deadline: '' },
    { id: 'demo-holiday', name: 'Viaje de verano', target: 120000, deadline: '' },
    { id: 'demo-computer', name: 'Nuevo ordenador', target: 150000, deadline: '' },
  ];
  account.contributions = account.goals.map((goal, index) => ({
    id: 'demo-entry-' + index, goalId: goal.id, date: now, amount: [182000, 42000, 62500][index],
  }));
  account.targets = [{ name: 'Nuevo ordenador', amount: 150000 }];
  return account;
}
