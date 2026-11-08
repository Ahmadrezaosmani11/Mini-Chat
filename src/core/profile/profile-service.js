// Name and photo management and exchange (SRS 10.5 types 16-18, 10.7, 13.8, FR-06, FR-07, FR-33).
import { AppError } from '../errors.js';
import { FRAME } from '../crypto/schemas.js';
import { sha256 } from '../crypto/ids.js';
import { bytesEqual } from '../crypto/cbor.js';
import { RateLimiter } from '../crypto/replay.js';
import { validateDisplayName } from './display-name.js';
import { validateJpeg } from './photo-validator.js';
import * as C from '../../config/constants.js';

export class ProfileService {
  /** @param {{session:any, contacts:any, history:any, accounts:any, identity:any, db:any, bus:any, logger:any, now?:()=>number}} deps */
  constructor(deps) {
    Object.assign(this, deps);
    this.now = deps.now ?? Date.now;
    this.photoLimiter = new RateLimiter(C.PHOTO_REQUESTS_PER_MINUTE, 60000, this.now);
  }

  attach() {
    this.session.on('secure', (s) => this.#sendSync(s, true));
    this.session.on('closed', (s) => this.#clearRequest(s));
    this.session.on('frame', ({ session, type, payload }) => {
      if (type === FRAME.PROFILE_SYNC) this.onProfileSync(session, payload);
      else if (type === FRAME.PHOTO_REQUEST) this.#onPhotoRequest(session, payload);
      else if (type === FRAME.PHOTO_DATA) this.#onPhotoData(session, payload);
    });
  }

  // ---- own profile ---------------------------------------------------------------------------
  setDisplayName(input) {
    let name;
    try {
      name = validateDisplayName(input);
    } catch {
      throw new AppError('VALIDATION', { message: 'Invalid input.' });
    }
    this.db.prepare('UPDATE account SET display_name = ? WHERE singleton = 1').run(name);
    this.broadcast(); // discovery picks the new name up on its next 5 s cycle
    return name;
  }

  /** @param {Uint8Array} jpeg already produced by the UI canvas (256x256) */
  setPhoto(jpeg) {
    try {
      validateJpeg(jpeg);
    } catch {
      throw new AppError('VALIDATION', { message: 'Invalid input.' });
    }
    this.history.savePhoto(this.identity.peerId, jpeg, sha256(jpeg));
    this.broadcast();
  }

  removePhoto() {
    this.history.deletePhoto(this.identity.peerId);
    this.broadcast();
  }

  ownPhoto() {
    return this.history.loadPhoto(this.identity.peerId);
  }

  contactPhoto(peerId) {
    return this.history.loadPhoto(peerId);
  }

  // ---- ProfileSync ----------------------------------------------------------------------------
  broadcast() {
    for (const s of this.session.secure.values()) this.#sendSync(s, false);
  }

  /** At most one ProfileSync per 2 s per session; a change inside the window is sent afterwards. */
  #sendSync(s, immediate) {
    const wait = (s.lastSyncMs ?? 0) + C.PROFILE_SYNC_MIN_INTERVAL_MS - this.now();
    if (!immediate && wait > 0) {
      if (!s.syncTimer) {
        s.syncTimer = setTimeout(() => {
          s.syncTimer = null;
          if (s.state === 'Secure') this.#sendSync(s, true);
        }, wait);
        s.syncTimer.unref?.();
      }
      return;
    }
    s.lastSyncMs = this.now();
    const photoHash = this.history.photoHash(this.identity.peerId);
    this.session
      .send(s, FRAME.PROFILE_SYNC, { displayName: this.accounts.ownDisplayName, photoHash })
      .catch(() => {});
  }

  onProfileSync(session, { displayName, photoHash }) {
    const peerId = session.peerId;
    this.contacts.updateProfileName(peerId, displayName);
    if (photoHash === null) {
      this.history.deletePhoto(peerId);
      this.bus.emit('event', { type: 'profile', data: { peerId } });
      return;
    }
    const cached = this.history.photoHash(peerId);
    if (cached && bytesEqual(cached, photoHash)) return;
    if (session.photoReq) return; // one outstanding request at a time
    session.photoReq = {
      hash: photoHash,
      chunks: [],
      count: null,
      bytes: 0,
      timer: setTimeout(() => this.#clearRequest(session), C.PHOTO_TRANSFER_TIMEOUT_MS),
    };
    this.session.send(session, FRAME.PHOTO_REQUEST, { photoHash }).catch(() => this.#clearRequest(session));
  }

  #clearRequest(session) {
    if (session.photoReq) clearTimeout(session.photoReq.timer);
    session.photoReq = null;
    if (session.syncTimer) clearTimeout(session.syncTimer);
    session.syncTimer = null;
  }

  // ---- PhotoRequest / PhotoData ---------------------------------------------------------------------
  #onPhotoRequest(session, { photoHash }) {
    if (!this.photoLimiter.allow(session.peerId)) {
      this.session.send(session, FRAME.ERROR, { code: 'LIMIT' }).catch(() => {});
      return;
    }
    const own = this.history.photoHash(this.identity.peerId);
    const jpeg = own && bytesEqual(own, photoHash) ? this.ownPhoto() : null;
    if (!jpeg) {
      this.session.send(session, FRAME.ERROR, { code: 'UNAVAILABLE' }).catch(() => {});
      return;
    }
    const count = Math.ceil(jpeg.length / C.PHOTO_CHUNK_BYTES);
    (async () => {
      for (let index = 0; index < count; index += 1) {
        const data = jpeg.slice(index * C.PHOTO_CHUNK_BYTES, (index + 1) * C.PHOTO_CHUNK_BYTES);
        await this.session.send(session, FRAME.PHOTO_DATA, { photoHash, index, count, data });
      }
    })().catch(() => {});
  }

  #onPhotoData(session, { photoHash, index, count, data }) {
    const req = session.photoReq;
    if (!req || !bytesEqual(req.hash, photoHash)) return this.session.violation(session); // unsolicited
    const fail = () => this.#clearRequest(session); // any failure discards the partial data
    if (req.count === null) req.count = count;
    if (count !== req.count || index !== req.chunks.length) return fail();
    req.chunks.push(data);
    req.bytes += data.length;
    if (req.bytes > C.PHOTO_MAX_BYTES) return fail();
    if (req.chunks.length < req.count) return;
    const jpeg = new Uint8Array(Buffer.concat(req.chunks));
    this.#clearRequest(session);
    try {
      if (!bytesEqual(sha256(jpeg), photoHash)) throw new Error('hash');
      validateJpeg(jpeg);
      this.history.savePhoto(session.peerId, jpeg, photoHash);
      this.bus.emit('event', { type: 'profile', data: { peerId: session.peerId } });
    } catch {
      this.logger.log('profile', 'PHOTO_REJECTED', { peer: session.peerId });
    }
  }
}
