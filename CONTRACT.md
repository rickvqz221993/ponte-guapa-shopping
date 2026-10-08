# PONTE GUAPA SHOPPING — Build Contract

This file is the SINGLE SOURCE OF TRUTH for all builders. Follow it exactly.
Project root: `~/workspace/ponte-guapa-shopping/`

## 1. Stack & dependencies (package.json)

Node 18+. Dependencies (keep exactly this set, no more):
`express`, `ejs`, `better-sqlite3`, `bcryptjs`, `express-session`, `connect-sqlite3`, `multer`, `nodemailer`, `stripe`
Dev: none required. Scripts: `"start": "node src/server.js"`.

## 2. Directory layout

```
src/server.js            — boot: express app, middleware order, static, session, i18n, routes, 404/500
src/db.js                — opens data/shop.db (WAL mode), runs SCHEMA (section 3), seeds settings + admin
src/i18n.js              — loads src/i18n/es.json + en.json; middleware sets req.lang, res.locals.t; t(key,params)
src/logic.js             — pure business logic (section 4). NO express here.
src/mail.js              — sendMail(); SMTP if env present else fallback log
src/stripeUtil.js        — lazy stripe client; null when no STRIPE_SECRET_KEY
src/routes/public.js     — home, catalog, product, policy pages, lang switch, manifest/sw/offline
src/routes/auth.js       — register/login/logout
src/routes/cart.js       — cart (session) + checkout + order creation
src/routes/pay.js        — deposit/balance payment pages, transfer+proof, stripe card flow
src/routes/account.js    — mi-cuenta, mis-pedidos, avisos, reorder
src/routes/admin.js      — ALL /admin/* routes
src/i18n/es.json, src/i18n/en.json   — ALL UI strings, keys EXACTLY as section 6
src/views/*.ejs          — templates, names EXACTLY as section 7
src/public/style.css     — pink kawaii, mobile-first
src/public/app.js        — tiny client JS (mobile nav, lang, image preview, countdown)
src/public/manifest.webmanifest, src/public/sw.js, src/public/offline.html
src/public/icons/icon-192.png, icon-512.png (maskable, valid PNG)
src/public/uploads/     — product images + payment proofs (served static, gitignored content)
data/                    — shop.db + email-fallback.log (gitignored)
```

## 3. Database schema (better-sqlite3, WAL). db.js runs this verbatim.

```sql
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users(
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, whatsapp TEXT NOT NULL,
 email TEXT NOT NULL UNIQUE, phone TEXT NOT NULL, password_hash TEXT NOT NULL,
 birthdate TEXT, age INTEGER, found_via TEXT, recommended_by TEXT,
 product_interests TEXT, role TEXT NOT NULL DEFAULT 'customer', lang TEXT NOT NULL DEFAULT 'es',
 credit_mxn REAL NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE TABLE IF NOT EXISTS products(
 id INTEGER PRIMARY KEY AUTOINCREMENT, image_path TEXT, title_es TEXT NOT NULL, title_en TEXT NOT NULL,
 desc_es TEXT NOT NULL, desc_en TEXT NOT NULL, price_mxn REAL,
 age_groups TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '',
 active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(active);
CREATE TABLE IF NOT EXISTS orders(
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id),
 channel TEXT NOT NULL DEFAULT 'web', status TEXT NOT NULL DEFAULT 'pending',
 subtotal_mxn REAL NOT NULL DEFAULT 0, credit_applied REAL NOT NULL DEFAULT 0,
 deposit_due REAL NOT NULL DEFAULT 0, deposit_paid_amount REAL NOT NULL DEFAULT 0,
 balance_due REAL NOT NULL DEFAULT 0, shipping_cost_mxn REAL NOT NULL DEFAULT 0,
 currency TEXT NOT NULL DEFAULT 'MXN', ship_name TEXT, ship_phone TEXT, ship_city TEXT,
 ship_postal TEXT, ship_address TEXT, pickup INTEGER NOT NULL DEFAULT 0,
 alt_name TEXT, alt_phone TEXT, alt_city TEXT, alt_postal TEXT, alt_address TEXT,
 final_sale_accepted INTEGER NOT NULL DEFAULT 0, tracking TEXT NOT NULL DEFAULT '',
 pickup_deadline TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE TABLE IF NOT EXISTS order_items(
 id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id),
 product_id INTEGER NOT NULL REFERENCES products(id), qty INTEGER NOT NULL, unit_price_mxn REAL);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
CREATE TABLE IF NOT EXISTS payments(
 id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id),
 kind TEXT NOT NULL, method TEXT NOT NULL, amount_mxn REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'MXN',
 proof_path TEXT, stripe_ref TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
CREATE TABLE IF NOT EXISTS announcements(
 id INTEGER PRIMARY KEY AUTOINCREMENT, title_es TEXT NOT NULL, title_en TEXT NOT NULL,
 body_es TEXT NOT NULL, body_en TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
```

Seed (only when empty): settings rows —
`alert_emails=rickvqzinfo@gmail.com`, `whatsapp_number=+971 52 686 4330`,
`accumulation_cap=20000`, `pickup_days=15`, `fx_usd=17.00`, `fx_cad=12.50`, `fx_eur=18.50`
(fx = MXN per 1 unit of foreign currency; admin must update rates).
Seed admin user: email `admin@ponteguapa.shop`, password `PonteGuapa2026!` (bcryptjs hash, 10 rounds),
name `Administradora`, role `admin`. README must say: change this password immediately in /admin/config.

## 4. Business logic (src/logic.js) — implement exactly

- `ageGroup(age)`: age<20→`<20`; 20–29→`20-30`; 30–39→`30-40`; 40–49→`40-50`; 50–59→`50-60`; 60+→`60+`; null→null.
- `OPEN_STATUSES = ['pending','accepted','deposit_paid','purchased','balance_due','fully_paid','shipped','pickup_ready']`
- `accumulated(userId)`: SUM(subtotal_mxn - credit_applied) FROM orders WHERE user_id=? AND status IN OPEN_STATUSES. (closed/cancelled/rejected do NOT count.)
- `semaforo(userId, cap)`: acc<10000→`green`; 10000–19999→`yellow`; ≥cap→`red`. (cap from settings, default 20000)
- `canCheckout(userId, cap)`: semaforo !== 'red'. If red → block with `checkout.red_blocked_*` message.
- `depositDue(order)`: round2(0.60 * (subtotal_mxn - credit_applied)).
- `balanceDue(order)`: round2((subtotal_mxn - credit_applied) - deposit_paid_amount + shipping_cost_mxn).
- Order transitions (server-enforced allowlist):
  pending→accepted|rejected|cancelled · accepted→deposit_paid|rejected|cancelled ·
  deposit_paid→purchased|cancelled · purchased→balance_due · balance_due→fully_paid ·
  fully_paid→shipped|pickup_ready · shipped→closed · pickup_ready→picked_up · picked_up→closed.
- **Hard rule**: `markShipped`/`markPickupReady` allowed ONLY when status==='fully_paid'.
- `orderSubtotal(items)`: SUM(qty*unit_price_mxn) ignoring NULL prices; `hasTbd(items)`: any unit_price_mxn NULL.
- When admin accepts an order containing TBD items, admin MUST set each TBD unit price (form); then subtotal/deposit_due computed.
- Credit: `users.credit_mxn`; checkout applies min(credit, subtotal) as credit_applied, decrements user credit.
- Pickup deadline: when marking pickup_ready → pickup_deadline = now + settings.pickup_days (default 15) days, ISO string.

## 5. Routes (exact paths). Views render section-7 templates.

PUBLIC (`src/routes/public.js`)
- GET `/` → view `home` {featured[], latest[], announcements[]}
- GET `/catalogo` → view `catalog` {products[], filters{q,category,age,price}, categories[], ages[]}
- GET `/producto/:id` → view `product` {product, related[]}
- GET `/como-comprar` → view `page` {pageKey:'how_to_buy'}
- GET `/politica-envio` → view `page` {pageKey:'shipping_policy'}
- GET `/lang/:lang` (es|en) → set cookie pg_lang (1yr) + session; redirect back
- GET `/manifest.webmanifest`, GET `/sw.js`, GET `/offline.html` (static from public/)

AUTH (`src/routes/auth.js`)
- GET `/registro` → view `register`; POST `/registro` → validate (name, whatsapp, email unique+format, phone, password≥6, birthdate→age) → create user, auto-login → redirect `/`
- GET `/login` → view `login`; POST `/login` → verify → session; redirect `/` or `/admin`
- POST `/logout`

CART+CHECKOUT (`src/routes/cart.js`) — cart in `req.session.cart = [{productId, qty}]`
- POST `/carrito/agregar/:id`, POST `/carrito/quitar/:id`, GET `/carrito` → view `cart`
- GET `/checkout` (login required; canCheckout guard; empty cart → redirect) → view `checkout`
- POST `/checkout` → validate final_sale_accepted==='1', shipping fields (or pickup) → create order status `pending`, order_items (unit_price_mxn = product.price_mxn, may be NULL=TBD), decrement user credit, clear cart → mail.sendOrderAlertToAdmins(order) → redirect `/pedido/:id`

PAY (`src/routes/pay.js`, login required, owner or admin)
- GET `/pedido/:id` → view `order` {order, items[], payments[], semaforo info, countdown if pickup_ready}
- GET `/pedido/:id/pagar?kind=deposit|balance` → view `pay` {order, kind, amount, stripeEnabled, transferInstructions}
  - deposit allowed only when status==='accepted'; balance only when status==='balance_due'
- POST `/pedido/:id/pagar-transferencia` (multer single 'proof', images ≤5MB) → create payment status `pending` → redirect order page
- GET `/pedido/:id/pagar-tarjeta?kind=` → if !stripeUtil.client → 400; else create Checkout Session (mxn, amount cents), redirect session.url
- GET `/pedido/:id/pago-exito?session_id=&kind=` → retrieve session; if payment_status==='paid' → record payment status `confirmed` + advance order (accepted→deposit_paid, balance_due→fully_paid) → customer email
- POST `/pedido/:id/reordenar` → copy items into cart → redirect `/carrito`

ACCOUNT (`src/routes/account.js`, login required)
- GET `/mi-cuenta` → view `account` {user, acumulado, semaforo, inventory[] (per product: title, qty total, paid total, pending total, statuses), credit}
- GET `/mis-pedidos` → view `my-orders` {orders[]}
- GET `/avisos` → view `announcements` {announcements[]}

ADMIN (`src/routes/admin.js`, requireAdmin middleware; all POST check csrf)
- GET `/admin` → view `admin/dashboard` {pendingOrders[], redFlagCustomers[] (acc≥cap), pendingProofs[], stats{customers,orders,openRevenue}}
- GET `/admin/pedidos?status=` → view `admin/orders` {orders[]}
- GET `/admin/pedidos/:id` → view `admin/order-detail` {order, items[], payments[], customer, acumulado, semaforo}
- POST `/admin/pedidos/:id/aceptar` (body: tbd prices `price_<itemId>`) → set prices, subtotal, deposit_due, status accepted → customer email
- POST `/admin/pedidos/:id/rechazar`, POST `/admin/pedidos/:id/cancelar`
- POST `/admin/pedidos/:id/confirmar-deposito?payment=:pid` → payment confirmed → deposit_paid_amount+=, status deposit_paid → email
- POST `/admin/pedidos/:id/marcar-comprado` → status purchased
- POST `/admin/pedidos/:id/fijar-envio` (body: shipping_cost_mxn) → balance_due computed, status balance_due → customer email (balance due)
- POST `/admin/pedidos/:id/marcar-enviado` (body: tracking) → guard fully_paid → status shipped → email
- POST `/admin/pedidos/:id/listo-recoger` → guard fully_paid → status pickup_ready, pickup_deadline set → email
- POST `/admin/pedidos/:id/marcar-recogido` → picked_up; POST `/admin/pedidos/:id/cerrar` → closed
- GET `/admin/productos` → view `admin/products`; GET `/admin/productos/nuevo` + GET `/admin/productos/:id/editar` → view `admin/product-form`; POST `/admin/productos` + POST `/admin/productos/:id` (multer image ≤5MB, price empty=TBD, age_groups[] checkboxes, active) ; POST `/admin/productos/:id/eliminar` → active=0
- GET `/admin/clientes?q=` → view `admin/customers` {customers[] with acumulado+semaforo}
- GET `/admin/clientes/:id` → view `admin/customer-detail` {customer, orders[], patterns{totalOrders,totalSpent,avgOrder,ordersPerMonth,topCategories}, acumulado, semaforo, referral info}
- POST `/admin/clientes/:id/nota` (body notes), POST `/admin/clientes/:id/credito` (body amount, adds to credit_mxn)
- GET `/admin/pedido-whatsapp` → view `admin/whatsapp-order` {customers[], products[]}; POST → creates order channel='whatsapp', status pending (admin then accepts it)
- GET `/admin/avisos` → view `admin/announcements`; POST `/admin/avisos` (title/body es+en)
- GET `/admin/config` → view `admin/settings`; POST `/admin/config` (alert_emails, whatsapp_number, accumulation_cap, pickup_days, fx_*, new admin password optional)
- GET `/admin/emails` → view `admin/email-log` (reads data/email-fallback.log, newest first; shows SMTP status)

## 6. i18n keys (es.json + en.json, IDENTICAL key trees). Content agent fills translations.

Top-level groups (nested objects; arrays where noted):
`brand{tagline}`, `nav{home,catalog,how_to_buy,shipping_policy,announcements,my_account,my_orders,cart,login,register,logout,admin}`,
`home{hero_title,hero_sub,hero_cta,featured_title,latest_title,how_title,how_steps[5]{t,d},announce_title,whatsapp_cta}`,
`catalog{title,search_ph,category,all_categories,age,all_ages,price,all_prices,with_price,tbd_only,apply,no_results,tbd_badge,add,view,recommended_for_you}`,
`ages{under20,label_20_30,label_30_40,label_40_50,label_50_60,over60}`,
`product{description,price,tbd_note,qty,add,recommended_ages,category,share_whatsapp}`,
`cart{title,empty,empty_cta,subtotal,tbd_notice,checkout,remove,unit}`,
`checkout{title,contact_title,ship_title,pickup_option,ship_option,name,phone,city,postal,address,alt_title,alt_note,final_title,final_text,final_accept,place_order,credit_applied,red_blocked_title,red_blocked_text,empty_cart}`,
`order{title,number,status,channel,date,items,subtotal,credit,deposit_due,deposit_paid,shipping,balance_due,total_paid,total_pending,pay_deposit,pay_balance,proof_pending_note,tracking,pickup_deadline,pickup_days_left,ship_to,reorder,back_to_orders}`,
`pay{deposit_title,balance_title,amount,method_card,method_transfer,card_note,transfer_note,transfer_instructions,proof_label,proof_hint,submit_proof,success_title,success_text,back_to_order,stripe_unavailable}`,
`status{pending,accepted,rejected,deposit_paid,purchased,balance_due,fully_paid,shipped,pickup_ready,picked_up,closed,cancelled}`,
`channel{web,app,whatsapp}`,
`auth{name,whatsapp,email,phone,birthdate,found_via,found_social,found_recommendation,found_other,recommended_by_label,recommended_by_ph,interests,interests_ph,password,password2,register_title,register_btn,login_title,login_btn,have_account,no_account,err_required,err_email_taken,err_email_invalid,err_password_short,err_password_mismatch,err_login}`,
`account{title,welcome,accumulated,semaforo,sem_green,sem_yellow,sem_red,sem_green_d,sem_yellow_d,sem_red_d,inventory,inv_product,inv_qty,inv_paid,inv_pending,inv_status,orders,announcements,credit,recommended}`,
`admin{...}` — dashboard{title,queue,red_flags,proofs,customers,orders_open,revenue_open,view_all,overdue_pickups}, orders{title,filter_all,customer,total,actions,accept,reject,confirm_deposit,mark_purchased,set_shipping,mark_shipped,mark_pickup_ready,mark_picked_up,close_order,tbd_price_label,shipping_cost_label,tracking_label,proofs}, products{title,new,edit,title_es,title_en,desc_es,desc_en,price_mxn,price_tbd,age_groups,category,active,image,save,delete,confirm_delete}, customers{title,search,search_ph,member_since,age,found_via,via,interests,notes,save_note,add_credit,credit_amount,patterns,total_orders,total_spent,avg_order,per_month,top_categories,accumulated,semaforo,view}, whatsapp_order{title,customer,items,create}, announcements{title,ta_title_es,ta_title_en,ta_body_es,ta_body_en,publish}, settings{title,alert_emails,alert_emails_hint,whatsapp_number,accumulation_cap,pickup_days,fx_usd,fx_cad,fx_eur,new_password,new_password_hint,save,saved}, emails{title,smtp_ok,smtp_missing,log_empty},
`pages{how_to_buy{title,steps[10]{t,d}},shipping_policy{title,intro,sections[]{h,body},boxes_note}}`,
`misc{es,en,lang_label,mxn,usd,cad,eur,footer_note,whatsapp_float,back,save,cancel,yes,no,optional,all,search,of,home_breadcrumb,error_404,error_500,currency_note}`,
`mail{...}` — new_order_admin{subject,body_html}, order_accepted{subject,body}, deposit_confirmed{subject,body}, balance_due{subject,body}, shipped{subject,body}, pickup_ready{subject,body} (support {name},{order_id},{amount} placeholders)

## 7. Views (src/views/*.ejs) — every view extends layout (except admin/* extend admin/layout)

Public: `layout`, `partials/header`, `partials/footer`, `home`, `catalog`, `product`, `cart`, `checkout`, `order`, `pay`, `login`, `register`, `account`, `my-orders`, `announcements`, `page`, `offline`, `404`, `500`
Admin: `admin/layout`, `admin/dashboard`, `admin/orders`, `admin/order-detail`, `admin/products`, `admin/product-form`, `admin/customers`, `admin/customer-detail`, `admin/whatsapp-order`, `admin/announcements`, `admin/settings`, `admin/email-log`

All res.locals: `t` (translate fn), `lang`, `user` (or null), `cartCount`, `csrfToken`, `waNumber` (public settings.whatsapp_number), `fx` {usd,cad,eur}, `cap`.
Every POST form includes `<input type="hidden" name="_csrf" value="<%= csrfToken %>">`.
Image URLs: `/uploads/<file>`. Product title/desc: pick by lang with fallback to es.

## 8. Middleware order (server.js)

helmet-lite headers (manual, no dep) → static `/` (public) + `/uploads` → cookie/session (connect-sqlite3) → i18n (cookie pg_lang → session → user.lang → 'es') → csrf (token in res.locals; check on POST except /pedido/:id/pago-exito) → cartCount → routes → 404 → 500.

## 9. mail.js

`sendMail({to, subject, html})`: if SMTP_HOST&&SMTP_USER → nodemailer send; else append `{ts,to,subject,html}` JSON line to `data/email-fallback.log` + console.log. Export `notifyAdmins(subject,html)` (to settings.alert_emails split by comma) and `notifyCustomer(user,subject,html)`.

## 10. PWA

manifest.webmanifest {name:"Ponte Guapa Shopping", short_name:"Ponte Guapa", start_url:"/", display:"standalone", background_color:"#fff0f6", theme_color:"#ff5fa2", lang:"es", icons 192+512 maskable any}. sw.js: cache-first for /style.css|/app.js|icons|offline.html; network-first otherwise; fallback offline.html. Register in layout footer script.

## 11. Design language

Feminine pink kawaii matching brand/*.jpg: hot pink #ff2e88 / soft pink #ffd6e8 / cream #fff7fb backgrounds, rounded cards (18px radius), heart motifs (use unicode ♥ / inline SVG, NO emoji in UI), playful rounded font stack ("Baloo 2", system rounded fallback via Google Fonts link is allowed), sparkles via CSS. Mobile-first. Admin uses same theme, denser tables.

## 12. Out of scope (DO NOT BUILD)

Carrier selection with weight estimates; deposit payment reminders (pickup reminders ARE in scope via countdown + pickup_ready email).

## 13. Backend agent stub views

Backend agent: create `src/views/` with ONE-LINE stub for every view in section 7 rendering `<%- JSON.stringify(it) %>`... use `<%- JSON.stringify(locals) %>` so your HTTP tests can assert data. Frontend agent will OVERWRITE all of them with real templates. Do not depend on stub content.
