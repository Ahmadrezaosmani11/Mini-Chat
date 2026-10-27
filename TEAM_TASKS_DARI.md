# سند تقسیم کار تیم — DTP2P

تقسیم کار بر اساس «ترتیب ساخت» در SRS بخش 18.5 (ده مرحله) و وابستگی ماژول‌ها انجام شده است تا هر نفر مالک یک بخش مستقل و قابل تست باشد و تداخل فایل‌ها (merge conflict) کم شود.

## ۱. احمد رضا عثمانی (Ahmad Reza Osmani) — «پایه، API محلی، رابط کاربری و بسته‌بندی»
مراحل SRS: ۱، ۲، ۸ (بخش UI)، ۹، ۱۰

| فایل/پوشه | کار |
|---|---|
| `package.json`, `eslint.config.js`, `.prettierrc`, `scripts/verify-runtime.js` | زیرساخت پروژه، lint، بررسی Node 22.x |
| `src/config/constants.js` | همه ثابت‌ها (NFR-17) |
| `src/main/main.js`, `window.js`, `hardening.js`, `lifecycle.js` | پروسهٔ اصلی Electron، قفل تک‌نمونه، امن‌سازی، توالی شروع/خاتمه |
| `src/main/app/server.js`, `launch-gate.js`, `session.js`, `security-headers.js`, `routes/*` | API محلی Fastify، توکن راه‌اندازی، کوکی، CSRF، CSP، SSE |
| `src/core/account/*` | ثبت‌نام، ورود، محدودسازی تلاش، تغییر رمز، حذف حساب، ریست نصب |
| `src/core/secrets/secret-store.js` | safeStorage |
| `src/core/db/*` | SQLite، مهاجرت‌ها، پشتیبان‌گیری |
| `src/ui/*` | تمام رابط کاربری (HTML/CSS/JS ساده) |
| `electron-builder.yml`, `build/installer.nsh` | نصب‌کننده NSIS، قوانین فایروال، Fuses |
| تست‌ها | `test/integration/account-contacts.test.js` (بخش حساب)، Playwright smoke |

## ۲. فرهمند فضلی (Farahmand Fazli) — «رمزنگاری، هویت، کشف و نشست امن»
مراحل SRS: ۳ (هویت)، ۴، ۵

| فایل/پوشه | کار |
|---|---|
| `src/core/crypto/sodium.js`, `cbor.js`, `ids.js`, `replay.js`, `schemas.js` | libsodium، CBOR کانونی، Peer ID/اثرانگشت، کش بازپخش، zod |
| `src/core/crypto/handshake.js` | دست‌دهی ClientHello/ServerHello، X25519 + HKDF |
| `src/core/crypto/frames.js` | فریم‌های رمزنگاری‌شده XChaCha20-Poly1305 |
| `src/core/identity/identity-service.js` | کلید Ed25519، امضا (کلید خصوصی بیرون نمی‌رود) |
| `src/core/discovery/discovery-service.js` | آگهی امضاشدهٔ UDP، اعتبارسنجی ۹ مرحله‌ای، جدول همتایان |
| `src/core/session/session-service.js` | WebSocket، ماشین حالت، tie-break، محدودیت‌ها |
| تست‌ها | `test/unit/ids.test.js`, `cbor.test.js`, `handshake-frames.test.js`, تست‌های امنیتی SEC-01..SEC-07 |

## ۳. محمد سهراب رازقی (Mohammad Sohrab Razeqi) — «اعتماد، پیام‌رسانی، پروفایل، تاریخچه و کیفیت»
مراحل SRS: ۳ (اعتماد مخاطب)، ۶، ۷، ۸ (تاریخچه)

| فایل/پوشه | کار |
|---|---|
| `src/core/trust/contact-service.js` | افزودن مخاطب (جریان A/B)، تأیید دقیق، حالت Changed |
| `src/core/messages/message-service.js` | ارسال یک‌بارهٔ پیام، Ack، حذف تکرار ۲۴ ساعته، بدون صف |
| `src/core/profile/*` | نام نمایشی، اعتبارسنجی عکس JPEG، ProfileSync/PhotoRequest/PhotoData |
| `src/core/history/history-service.js` | تاریخچهٔ رمزنگاری‌شده، عکس‌ها، حافظهٔ موقت |
| `src/core/logging/logger.js`, `src/core/errors.js` | لاگ‌گیری فهرست‌مجاز، خطاها |
| تست‌ها | `display-name.test.js`, `photo-validator.test.js`, `logger.test.js`، تست‌های پیام/پروفایل، تست‌های بار و تاب‌آوری |

## نقاط تماس بین اعضا (قرارداد)
- احمد ↔ فرهمند: `IdentityService.sign()`، `DiscoveryService.start/stop`، `SessionService.listen/stop` در `lifecycle.js`.
- فرهمند ↔ محمد: رویدادهای `secure`، `frame`، `closed` از SessionService و `send(session,type,payload)`.
- محمد ↔ احمد: مسیرهای `routes/contacts.js` و `routes/me.js` فقط سرویس‌های محمد را صدا می‌زنند.

## قانون کار
هر نفر روی شاخهٔ جدا (`feature/<name>`) کار کند؛ تغییر در `constants.js` و `schemas.js` فقط با هماهنگی هر سه نفر؛ تغییر وابستگی‌های رمزنگاری/شبکه، مجموعهٔ تست امنیتی را دوباره اجرا می‌کند (SRS 20.2).
