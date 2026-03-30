const sqlite3 = require("sqlite3").verbose();

const db = new sqlite3.Database("./database.sqlite");

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      phone TEXT,
      role TEXT,
      content TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

function saveMessage(id, phone, role, content) {
  db.run(
    `INSERT INTO conversations (id, phone, role, content) VALUES (?, ?, ?, ?)`,
    [id, phone, role, content]
  );
}

function getConversation(phone) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT role, content FROM conversations WHERE phone = ? ORDER BY timestamp ASC LIMIT 20`,
      [phone],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      }
    );
  });
}

module.exports = { saveMessage, getConversation };