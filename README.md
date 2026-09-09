# ScriptForge — Backend simple

Este backend reemplaza la simulación de cuentas/comunidad que antes vivía
solo en el `localStorage` del navegador. Ahora hay un servidor real que
todos comparten: si dos personas abren la app desde distintos dispositivos,
ambas ven la misma comunidad de guiones publicados.

## Qué cambia respecto a la versión original

| Antes (solo frontend)                          | Ahora                                              |
|-------------------------------------------------|-----------------------------------------------------|
| Usuarios y contraseñas en `localStorage`, en texto plano | Usuarios en el servidor, contraseñas con hash `bcrypt` |
| "Comunidad" aislada por navegador               | Comunidad real y compartida vía API REST            |
| Sesión = un string en `localStorage`            | Sesión = token JWT firmado por el servidor          |
| Guiones **personales** (borradores del editor)  | Siguen siendo locales — no necesitan servidor        |

## Estructura del proyecto

```
scriptforge-backend/
├── server.js        → servidor Express + rutas de la API
├── db.js            → acceso a la "base de datos" (archivo data/db.json)
├── package.json
├── data/
│   └── db.json       → aquí se guardan usuarios y guiones publicados
└── public/
    └── index.html     → el frontend (ScriptForge), ya conectado a la API
```

## Cómo correrlo

Necesitas [Node.js](https://nodejs.org) instalado (versión 18 o superior).

```bash
cd scriptforge-backend
npm install
npm start
```

Abre **http://localhost:3000** en el navegador — ahí se sirve la app completa
(frontend + API en el mismo servidor, para no complicarte con CORS).

## Cómo probarlo con dos "usuarios" distintos

Abre la app en una ventana normal y en una ventana de incógnito (o en dos
navegadores distintos). Regístrate con un usuario en cada una, publica un
guion desde una, y actualiza la pestaña "Comunidad" en la otra — deberías
verlo ahí. Esa es la diferencia clave: ahora sí es una comunidad compartida.

## Endpoints de la API

| Método | Ruta                        | Auth | Descripción                                  |
|--------|-----------------------------|------|-----------------------------------------------|
| POST   | `/api/auth/register`        | No   | Crea cuenta, devuelve token + clave de recuperación |
| POST   | `/api/auth/login`           | No   | Inicia sesión, devuelve token                 |
| POST   | `/api/auth/recover`         | No   | Cambia contraseña con la clave de recuperación|
| GET    | `/api/auth/me`               | Sí   | Verifica el token (usado al recargar la página)|
| DELETE | `/api/auth/account`         | Sí   | Borra tu cuenta y tus publicaciones           |
| GET    | `/api/scripts`               | No   | Lista los guiones publicados (incluye `views`) |
| POST   | `/api/scripts`               | Sí   | Publica o actualiza un guion propio           |
| DELETE | `/api/scripts/:id`           | Sí   | Elimina una publicación propia                |
| POST   | `/api/scripts/:id/vote`      | Sí   | Da/quita like o dislike                       |
| POST   | `/api/scripts/:id/view`      | Opcional | Registra una visita de lectura            |
| GET    | `/api/users/:username`       | Opcional | Perfil público (seguidores, siguiendo, guiones) |
| POST   | `/api/users/:username/follow`| Sí   | Sigue/deja de seguir a ese usuario            |

### Sobre las visitas y el sistema de seguir

- **Visitas**: cada vez que alguien abre "Leer completo" se registra una
  visita. Si el lector tiene sesión iniciada, se cuenta **una sola vez por
  usuario** (aunque relea el guion varias veces); si no tiene sesión, se
  suma cada vez (visita anónima). El autor no suma visitas al leer su
  propio guion.
- **Seguir**: puedes seguir a otros usuarios desde la tarjeta de su
  publicación, desde el modal de lectura, o desde su perfil (clic en su
  `@usuario`). El filtro "🔔 Siguiendo" en la Comunidad muestra solo
  publicaciones de gente que sigues.

Las rutas con "Auth: Sí" requieren el header:
`Authorization: Bearer <token>`

## Notas importantes antes de usarlo con gente real

1. **`JWT_SECRET`**: en `server.js` hay un secreto por defecto para que
   funcione de inmediato. Si vas a exponer esto a internet (no solo
   `localhost`), cambia ese valor por uno largo y aleatorio, idealmente
   como variable de entorno: `JWT_SECRET=algo-largo-y-random node server.js`.
2. **`data/db.json` es un archivo plano**: perfecto para probar la idea o
   para pocos usuarios. Si el proyecto crece (muchos usuarios concurrentes),
   lo natural sería migrar esto a SQLite o Postgres — la función `getDB()`/
   `saveDB()` en `db.js` es el único lugar que habría que cambiar; el resto
   del servidor no se entera.
3. **No hay HTTPS**: si lo despliegas en un servidor real (no solo tu
   computadora), necesitas ponerlo detrás de algo con HTTPS (por ejemplo,
   un proxy como Nginx o un servicio como Render/Railway que ya lo incluye),
   para que las contraseñas no viajen en texto plano por la red.
