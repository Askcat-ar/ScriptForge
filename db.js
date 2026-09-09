// db.js
// Base de datos simple basada en un archivo JSON (data/db.json).
// No requiere motores externos (Postgres/Mongo/etc.), ideal para arrancar
// rápido. Si el proyecto crece, esto se puede migrar a SQLite/Postgres
// manteniendo la misma interfaz (getDB/saveDB).

const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "data", "db.json");

const DEFAULT_DB = {
  users: [],          // { id, username, passwordHash, recoveryKey }
  publicScripts: []    // { id, originalId, author, title, mode, category, blocks, likes, dislikes, date }
};

function ensureDB() {
  if (!fs.existsSync(DB_PATH)) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(DEFAULT_DB, null, 2));
  }
}

function getDB() {
  ensureDB();
  const raw = fs.readFileSync(DB_PATH, "utf-8");
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.users) parsed.users = [];
    if (!parsed.publicScripts) parsed.publicScripts = [];
    // Normaliza registros creados antes de que existieran estos campos,
    // para no romper con datos "viejos".
    parsed.users.forEach((u) => {
      if (!Array.isArray(u.followers)) u.followers = [];
      if (!Array.isArray(u.following)) u.following = [];
    });
    parsed.publicScripts.forEach((s) => {
      if (!Array.isArray(s.viewedBy)) s.viewedBy = [];
      if (typeof s.anonymousViews !== "number") s.anonymousViews = 0;
    });
    return parsed;
  } catch (e) {
    return { ...DEFAULT_DB };
  }
}

// Cola simple para serializar escrituras y evitar que dos requests
// concurrentes se pisen al leer-modificar-escribir el mismo archivo.
let writeQueue = Promise.resolve();

function saveDB(db) {
  writeQueue = writeQueue.then(
    () =>
      new Promise((resolve, reject) => {
        fs.writeFile(DB_PATH, JSON.stringify(db, null, 2), (err) => {
          if (err) reject(err);
          else resolve();
        });
      })
  );
  return writeQueue;
}

module.exports = { getDB, saveDB };
