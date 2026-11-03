import { randomBytes, timingSafeEqual } from 'node:crypto';

export class UiSessions {
  constructor() {
    this.map = new Map();
  }

  create() {
    const sid = randomBytes(32).toString('hex');
    const csrf = randomBytes(32).toString('hex');
    this.map.set(sid, { csrf });
    return { sid, csrf };
  }

  get(sid) {
    return typeof sid === 'string' ? (this.map.get(sid) ?? null) : null;
  }

  destroy(sid) {
    this.map.delete(sid);
  }

  clear() {
    this.map.clear();
  }

  static csrfMatches(expected, given) {
    if (typeof given !== 'string' || typeof expected !== 'string') return false;
    const a = Buffer.from(expected);
    const b = Buffer.from(given);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
