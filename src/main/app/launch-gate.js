import { randomBytes, timingSafeEqual } from 'node:crypto';
import { LAUNCH_TOKEN_BYTES, LAUNCH_TOKEN_TTL_MS } from '../../config/constants.js';

export class LaunchGate {
  constructor(now = Date.now) {
    this.now = now;
    this.token = randomBytes(LAUNCH_TOKEN_BYTES).toString('hex');
    this.createdAt = now();
    this.used = false;
    this.uiCookies = new Set();
  }
redeem(candidate) {
    if (this.used || typeof candidate !== 'string') return null;
    if (this.now() - this.createdAt > LAUNCH_TOKEN_TTL_MS) return null;
    const a = Buffer.from(candidate);
    const b = Buffer.from(this.token);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    this.used = true;
    const cookie = randomBytes(32).toString('hex');
    this.uiCookies.add(cookie);
    return cookie;
  }

  hasUiCookie(value) {
    return typeof value === 'string' && this.uiCookies.has(value);
  }
}
