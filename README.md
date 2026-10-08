# Ponte Guapa Shopping 💖

Tienda en línea de personal shopping desde Japón. Las clientas crean su cuenta, acumulan
compras, apartan con 60% de depósito y liquidan el resto + envío antes de que su pedido
salga de Japón. 100% español (dominante) + inglés. Instalable como app en el celular (PWA).

## Puesta en marcha (5 minutos)

```bash
cd ponte-guapa-shopping
npm install
cp .env.example .env   # edita tus valores
npm start
```

Abre http://localhost:3000

**Panel admin:** http://localhost:3000/admin
- Usuario inicial: `admin@ponteguapa.shop`
- Contraseña inicial: `PonteGuapa2026!`
- ⚠️ **Cámbiala de inmediato** en `/admin/config` (campo "Nueva contraseña").

## Variables de entorno (.env)

| Variable | Obligatoria | Para qué |
|---|---|---|
| `PORT` | no (default 3000) | Puerto del servidor |
| `SESSION_SECRET` | **sí en producción** | Cadena larga aleatoria para las sesiones |
| `BASE_URL` | no | URL pública (se usa en enlaces de correos y Stripe) |
| `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` | no | Sin estas, el pago con tarjeta se desactiva y solo funciona transferencia + comprobante |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | no | Sin SMTP, los correos se guardan en `data/email-fallback.log` y se revisan en `/admin → Correos` |

## Lo que Rick debe conseguir antes de abrir

1. **Dominio** (ej. ponteguapashopping.com) en cualquier registrador.
2. **Hosting con almacenamiento persistente** — la base de datos (`data/shop.db`) y las
   fotos (`src/public/uploads`) viven en disco. Opciones: Railway (recomendado, volumen
   persistente), Render (requiere disco persistente), o un VPS.
3. **Llaves de Stripe** (stripe.com) — solo si quieres cobrar con tarjeta desde el día 1.
   Sin ellas la tienda funciona con transferencia + comprobante.
4. **Credenciales SMTP** — lo más simple es una contraseña de aplicación de Gmail.
   Sin esto, los avisos se guardan en el registro interno (`/admin → Correos`).
5. Cambiar la **contraseña del admin** y revisar en `/admin/config`: correos de alerta
   (`rickvqzinfo@gmail.com` ya está), WhatsApp del negocio, límite de acumulación
   ($20,000 MXN), días para recoger (15) y tipos de cambio USD/CAD/EUR.

## Cómo funciona el negocio (ya programado)

- **Pedido → admin acepta → clienta paga 60% de anticipo** (tarjeta solo después de
  aceptado, o transferencia + comprobante) → admin compra en Japón → clienta liquida
  **40% restante + envío** → admin envía o marca listo para recoger. **Nada se envía
  sin el pago completo** (regla enforced en el servidor).
- **Semáforo de acumulación:** verde $1–9,999 · amarillo $10,000–19,999 ·
  **rojo $20,000+ MXN = envío obligatorio**: el sitio bloquea nuevos pedidos hasta
  liquidar saldo + envío y cerrar la acumulación.
- **Precios:** cada producto puede tener precio o quedar "por cotizar" (TBD); al aceptar
  el pedido, el admin fija los precios pendientes.
- **Venta final:** checkbox obligatorio — sin cancelaciones, cambios ni devoluciones.
- **Recoger en persona:** 15 días de plazo con cuenta regresiva visible.
- **Filtros por edad:** <20, 20–30, 30–40, 40–50, 50–60, 60+ (el admin etiqueta productos;
  el registro pide fecha de nacimiento para recomendar).
- **Pedidos por WhatsApp:** el admin los registra manualmente en `/admin/pedido-whatsapp`.
- **Referidos:** el registro pregunta cómo nos encontró y quién recomendó; el admin ve la
  cadena y puede aplicar crédito de agradecimiento.

## Estructura

```
src/server.js      arranque + middlewares
src/db.js          SQLite (WAL) + schema + seed
src/logic.js       reglas del negocio (semáforo, depósito 60%, transiciones)
src/mail.js        correos (SMTP o registro interno)
src/routes/        public, auth, cart, pay, account, admin
src/views/         plantillas EJS (público + admin)
src/public/        CSS kawaii, PWA (manifest + service worker + iconos)
src/i18n/          es.json / en.json (todo el texto de la UI)
data/              shop.db + email-fallback.log (no se sube a git)
```

## Rendimiento (10,000 clientas)

SQLite en modo WAL con índices en `users(email)`, `orders(user_id)`, `orders(status)`,
`order_items(order_id)` y `payments(order_id)`. better-sqlite3 maneja este volumen sin
problema en un solo servidor; si algún día se queda corto, la migración natural es
Postgres sin cambiar las rutas.

## Respaldo

Copia periódica de `data/shop.db` y `src/public/uploads/` — ahí vive todo el negocio.
