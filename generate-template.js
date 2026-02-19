const XLSX = require('xlsx');

// Create template Excel file
const headers = [
  'Имя',
  'Телефон',
  'Email',
  'Категории',
  'Дата рождения',
  'Потратил, ₸',
  'Оплатил, ₸',
  'Пол',
  'Карта',
  'Скидка',
  'Последний визит',
  'Первый визит',
  'Количество посещений',
  'Комментарий',
  'Дополнительный телефон',
  'Согласен на получение рассылок',
  'Согласен на обработку персональных данных'
];

const exampleRow = [
  'Александр',
  '77001234567',
  '',
  '',
  '',
  '12000',
  '12000',
  '',
  '',
  '0',
  '2025-12-25 14:00',
  '2025-12-25 12:00',
  '2',
  '',
  '',
  'Нет',
  'Нет'
];

const ws = XLSX.utils.aoa_to_sheet([headers, exampleRow]);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Клиенты');

// Write to file
XLSX.writeFile(wb, '../anotherworld-altegio/public/clients_template.xlsx');
console.log('Template created successfully!');
