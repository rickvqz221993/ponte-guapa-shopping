# Ponte Guapa Shopping — Lista de lanzamiento 💖

Todo lo que falta para poner la tienda en línea. La app ya está construida y probada;
estos son los pasos que solo tú puedes hacer.

## 1. Dominio

**Estado:** pendiente — elige y compra tu dominio en cualquier registrador
(Namecheap, Porkbun, Cloudflare). Ideas: `ponteguapashopping.com` · `ponteguapa.shop` ·
`ponteguapashopping.mx` (verifica disponibilidad al comprar).

Después apunta el DNS al hosting (paso 2).

## 2. Hosting (elige uno)

La tienda es una app Node 18+ con base de datos SQLite (`data/shop.db`) y fotos
en disco (`src/public/uploads`). **El hosting debe tener almacenamiento
persistente** — sin eso, los pedidos se borrarían al reiniciar.

| Opción | Por qué |
|---|---|
| **Railway** (recomendado) | Despliegue simple desde GitHub, variables de entorno en el panel, volumen persistente para SQLite. |
| Render | Funciona, pero SQLite necesita disco persistente (plan de pago). |
| VPS (Hetzner / Contabo) | Control total, más configuración manual. |

## 3. Variables de entorno (archivo `.env`)

```
PORT=3000
SESSION_SECRET=<genera una cadena larga aleatoria>
BASE_URL=https://tu-dominio.com

# Stripe (opcional — sin esto, la tarjeta queda desactivada y solo
# funciona transferencia + comprobante)
STRIPE_SECRET_KEY=
STRIPE_PUBLISHABLE_KEY=

# SMTP (opcional — sin esto, los correos se guardan en
# data/email-fallback.log y se revisan en /admin → Correos)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=Ponte Guapa <hola@tu-dominio.com>
```

- **Stripe:** crea tu cuenta en stripe.com y pega las dos llaves. La tarjeta
  solo se desbloquea para la clienta *después* de que tú apruebas el pedido.
- **SMTP:** lo más simple es una contraseña de aplicación de Gmail.

## 4. Primer acceso al panel admin

- Entra a `https://tu-dominio.com/admin`
- Usuario inicial: `admin@ponteguapa.shop`
- Contraseña inicial: `PonteGuapa2026!`
- ⚠️ **Cámbiala de inmediato** en `/admin/config`.

## 5. Configura esto en `/admin/config` antes de abrir

- **Tipos de cambio** (valores iniciales — actualízalos a los reales):
  USD 17.00 · CAD 12.50 · EUR 18.50
- **Correos de aviso de pedido:** `rickvqzinfo@gmail.com` ya está configurado;
  agrega más si quieres.
- **WhatsApp del negocio:** +971 52 686 4330
- **Datos de transferencia:** escribe tus datos bancarios para el anticipo del 60%.

## 6. Prueba un pedido completo (antes de invitar clientas)

1. Crea una cuenta de prueba → agrega un producto al carrito → finaliza la compra.
2. Como admin, **aprueba** el pedido → la clienta paga el **60% de anticipo**
   (transferencia + comprobante, o tarjeta si Stripe está activo).
3. Marca el anticipo como recibido → la clienta paga el **40% restante + envío**.
4. Cierra el pedido y verifica que el aviso llegó a `rickvqzinfo@gmail.com`.

## 7. App móvil (PWA) 📱

Las clientas pueden "instalar" la tienda desde el navegador
(Agregar a pantalla de inicio) — funciona como app, sin App Store.

## 8. Reglas del negocio (ya programadas ✅)

- Anticipo mínimo del **60%** para reservar — sin anticipo no hay pedido.
- Semáforo de acumulación: 🟢 $1–9,999 · 🟡 $10,000–19,999 · 🔴 **$20,000+ MXN
  = envío obligatorio** (se bloquea acumular más hasta liquidar saldo + envío).
- Venta final: sin cancelaciones, cambios ni devoluciones una vez comprado.
- Nada se envía sin el pago completo (40% restante + costo de envío).
- Filtros por edad: menos de 20, 20–30, 30–40, 40–50, 50–60, 60+.
- Pedidos por WhatsApp: los registras tú manualmente en el admin.
