// server.js
// Backend simple para ScriptForge.
// Expone una API REST para autenticación y para la comunidad de guiones
// públicos (antes simulada con localStorage, ahora persistida en el
// servidor y compartida de verdad entre todos los usuarios).

const path = require("path");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { getDB, saveDB } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

// En producción, define esta variable de entorno con un valor secreto y
// largo. Aquí se genera uno por defecto solo para que funcione "out of the box".
const JWT_SECRET = process.env.JWT_SECRET || "scriptforge-dev-secret-cambiar-en-produccion";

const WORDS = ["script", "draft", "forge", "scene", "hook", "act", "cut", "take", "roll", "line"];

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

/* ---------- Helpers ---------- */

function generateRecoveryKey() {
  const w1 = WORDS[Math.floor(Math.random() * WORDS.length)];
  const w2 = WORDS[Math.floor(Math.random() * WORDS.length)];
  const n = Math.floor(1000 + Math.random() * 9000);
  return `${w1}-${w2}-${n}`;
}

function signToken(user) {
  return jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: "30d" });
}

// Middleware opcional: si viene un token válido, adjunta req.username.
// No rechaza la petición si no hay token (algunas rutas son públicas).
function optionalAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      req.username = payload.username;
    } catch (e) {
      // token inválido/expirado: seguimos como anónimo
    }
  }
  next();
}

// Middleware obligatorio: rechaza si no hay token válido.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "No autenticado" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.username = payload.username;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }
}

/* ---------- AUTH ---------- */

// Registro de usuario
app.post("/api/auth/register", async (req, res) => {
  const { username: rawUsername, password } = req.body || {};
  const username = (rawUsername || "").trim().toLowerCase();

  if (username.length < 3) return res.status(400).json({ error: "Mínimo 3 caracteres" });
  if (!password || password.length < 4) return res.status(400).json({ error: "Contraseña muy corta" });

  const db = getDB();
  if (db.users.some((u) => u.username === username)) {
    return res.status(409).json({ error: "El usuario ya existe" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const recoveryKey = generateRecoveryKey();

  const user = { id: "u_" + Date.now(), username, passwordHash, recoveryKey, followers: [], following: [] };
  db.users.push(user);
  await saveDB(db);

  res.json({ token: signToken(user), username, recoveryKey });
});

// Login
app.post("/api/auth/login", async (req, res) => {
  const { username: rawUsername, password } = req.body || {};
  const username = (rawUsername || "").trim().toLowerCase();

  const db = getDB();
  const user = db.users.find((u) => u.username === username);
  if (!user) return res.status(401).json({ error: "Datos incorrectos" });

  const ok = await bcrypt.compare(password || "", user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Datos incorrectos" });

  res.json({ token: signToken(user), username: user.username, following: user.following });
});

// Recuperación de contraseña con la clave secreta generada al registrarse
app.post("/api/auth/recover", async (req, res) => {
  const { username: rawUsername, recoveryKey, newPassword } = req.body || {};
  const username = (rawUsername || "").trim().toLowerCase();

  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: "Contraseña muy corta" });
  }

  const db = getDB();
  const user = db.users.find((u) => u.username === username && u.recoveryKey === recoveryKey);
  if (!user) return res.status(400).json({ error: "Datos no válidos" });

  user.passwordHash = await bcrypt.hash(newPassword, 10);
  await saveDB(db);

  res.json({ ok: true });
});

// Verifica el token actual y devuelve el usuario (para restaurar sesión al recargar la página)
app.get("/api/auth/me", requireAuth, (req, res) => {
  const db = getDB();
  const user = db.users.find((u) => u.username === req.username);
  // Si el token es válido pero el usuario ya no existe en la base de datos
  // (por ejemplo, se reinició data/db.json), forzamos el cierre de sesión
  // en vez de dejar una sesión "fantasma" que fallaría más adelante.
  if (!user) return res.status(401).json({ error: "La cuenta ya no existe" });
  res.json({ username: req.username, following: user.following });
});

// Eliminar cuenta propia (y todas sus publicaciones)
app.delete("/api/auth/account", requireAuth, async (req, res) => {
  const db = getDB();
  db.users = db.users.filter((u) => u.username !== req.username);
  db.publicScripts = db.publicScripts.filter((s) => s.author !== req.username);
  await saveDB(db);
  res.json({ ok: true });
});

/* ---------- COMUNIDAD: guiones públicos ---------- */

// Listar guiones públicos (con filtros opcionales por query params)
app.get("/api/scripts", optionalAuth, (req, res) => {
  const db = getDB();
  // No exponemos la lista cruda de quién vio qué, solo el total.
  const scripts = db.publicScripts.map((s) => ({
    ...s,
    views: s.viewedBy.length + s.anonymousViews,
    viewedBy: undefined,
    anonymousViews: undefined
  }));
  res.json(scripts);
});

// Publicar un guion nuevo, o actualizar uno propio ya publicado (por originalId)
app.post("/api/scripts", requireAuth, async (req, res) => {
  const { originalId, title, mode, category, blocks } = req.body || {};
  if (!title || !mode || !Array.isArray(blocks)) {
    return res.status(400).json({ error: "Datos de guion incompletos" });
  }

  const db = getDB();
  const existingIndex = db.publicScripts.findIndex(
    (p) => (originalId && p.originalId === originalId) || (p.author === req.username && p.title === title)
  );

  if (existingIndex !== -1) {
    const existing = db.publicScripts[existingIndex];
    if (existing.author !== req.username) {
      return res.status(403).json({ error: "No puedes editar publicaciones de otro usuario" });
    }
    existing.title = title;
    existing.mode = mode;
    existing.category = category || existing.category;
    existing.blocks = blocks;
    existing.originalId = originalId || existing.originalId;
    await saveDB(db);
    return res.json({ script: existing, updated: true });
  }

  const newScript = {
    id: "pub_" + Date.now(),
    originalId: originalId || null,
    author: req.username,
    title,
    mode,
    category: category || "General",
    blocks,
    likes: [],
    dislikes: [],
    viewedBy: [],
    anonymousViews: 0,
    date: new Date().toLocaleDateString("es-ES")
  };
  db.publicScripts.unshift(newScript);
  await saveDB(db);
  res.json({ script: newScript, updated: false });
});

// Eliminar una publicación propia
app.delete("/api/scripts/:id", requireAuth, async (req, res) => {
  const db = getDB();
  const script = db.publicScripts.find((s) => s.id === req.params.id);
  if (!script) return res.status(404).json({ error: "No encontrado" });
  if (script.author !== req.username) {
    return res.status(403).json({ error: "Solo puedes eliminar tus propias publicaciones" });
  }
  db.publicScripts = db.publicScripts.filter((s) => s.id !== req.params.id);
  await saveDB(db);
  res.json({ ok: true });
});

// Votar (like/dislike) una publicación
app.post("/api/scripts/:id/vote", requireAuth, async (req, res) => {
  const { type } = req.body || {};
  if (type !== "like" && type !== "dislike") {
    return res.status(400).json({ error: "Tipo de voto inválido" });
  }

  const db = getDB();
  const script = db.publicScripts.find((s) => s.id === req.params.id);
  if (!script) return res.status(404).json({ error: "No encontrado" });

  const likeIndex = script.likes.indexOf(req.username);
  const dislikeIndex = script.dislikes.indexOf(req.username);

  if (type === "like") {
    if (likeIndex > -1) {
      script.likes.splice(likeIndex, 1);
    } else {
      script.likes.push(req.username);
      if (dislikeIndex > -1) script.dislikes.splice(dislikeIndex, 1);
    }
  } else {
    if (dislikeIndex > -1) {
      script.dislikes.splice(dislikeIndex, 1);
    } else {
      script.dislikes.push(req.username);
      if (likeIndex > -1) script.likes.splice(likeIndex, 1);
    }
  }

  await saveDB(db);
  res.json({ script: { ...script, views: script.viewedBy.length + script.anonymousViews, viewedBy: undefined, anonymousViews: undefined } });
});

// Registrar una visita de lectura en una publicación.
// Si el lector está identificado, se deduplica (una visita cuenta una sola
// vez por usuario, aunque relea el guion); si es anónimo, se suma siempre.
// El autor no suma visitas al leer su propio guion.
app.post("/api/scripts/:id/view", optionalAuth, async (req, res) => {
  const db = getDB();
  const script = db.publicScripts.find((s) => s.id === req.params.id);
  if (!script) return res.status(404).json({ error: "No encontrado" });

  if (req.username) {
    if (req.username !== script.author && !script.viewedBy.includes(req.username)) {
      script.viewedBy.push(req.username);
      await saveDB(db);
    }
  } else {
    script.anonymousViews += 1;
    await saveDB(db);
  }

  res.json({ views: script.viewedBy.length + script.anonymousViews });
});

/* ---------- PERFILES Y SEGUIMIENTO ---------- */

// Perfil público básico de un usuario
app.get("/api/users/:username", optionalAuth, (req, res) => {
  const username = req.params.username.trim().toLowerCase();
  const db = getDB();
  const user = db.users.find((u) => u.username === username);
  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });

  const scriptsCount = db.publicScripts.filter((s) => s.author === username).length;

  res.json({
    username: user.username,
    followersCount: user.followers.length,
    followingCount: user.following.length,
    scriptsCount,
    isFollowing: req.username ? user.followers.includes(req.username) : false,
    isSelf: req.username === username
  });
});

// Seguir / dejar de seguir a un usuario (alterna el estado)
app.post("/api/users/:username/follow", requireAuth, async (req, res) => {
  const target = req.params.username.trim().toLowerCase();
  if (target === req.username) {
    return res.status(400).json({ error: "No puedes seguirte a ti mismo" });
  }

  const db = getDB();
  const targetUser = db.users.find((u) => u.username === target);
  const selfUser = db.users.find((u) => u.username === req.username);
  if (!targetUser || !selfUser) return res.status(404).json({ error: "Usuario no encontrado" });

  const alreadyFollowing = targetUser.followers.includes(req.username);

  if (alreadyFollowing) {
    targetUser.followers = targetUser.followers.filter((u) => u !== req.username);
    selfUser.following = selfUser.following.filter((u) => u !== target);
  } else {
    targetUser.followers.push(req.username);
    selfUser.following.push(target);
  }

  await saveDB(db);
  res.json({ following: !alreadyFollowing, followersCount: targetUser.followers.length });
});

/* ---------- Arranque ---------- */

app.listen(PORT, () => {
  console.log(`ScriptForge backend corriendo en http://localhost:${PORT}`);
});
