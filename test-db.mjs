import mysql from 'mysql2/promise';

const db = await mysql.createConnection({
  host: 'srv123.hostgator.com',
  user: 'abdiel19_remote',
  password: 'NovaSenha@2025',
  database: 'abdiel19_auditor'
});

const [rows] = await db.execute('SELECT 1 + 1 AS result');
console.log(rows);
await db.end();
