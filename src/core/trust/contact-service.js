// Contacts and trust (SRS 6.3, FR-08, FR-09, FR-37). A contact is Verified only on an exact match.
import { AppError } from '../errors.js';
import { peerIdFromPublicKey, fingerprintFromPublicKey, compactFingerprint, normalisePeerId, normaliseFingerprint } from '../crypto/ids.js';
import { validateDisplayNameSafe } from '../profile/display-name.js';
import { bytesEqual } from '../crypto/cbor.js';

export class ContactService {
  /** @param {{db:any, identity:any, discovery:any, bus:any, logger:any, history:any, closeSessionsFor?:(peerId:string)=>void}} deps */
  constructor(deps) {
    Object.assign(this, deps);
    this.now = deps.now ?? Date.now;
  }

  /** Wire the discovery events (DiscoveryService never calls this class directly). */
  attach() {
    this.discovery.on('discovered', ({ advert, ip: _ip }) => this.onDiscovered(advert));
  }

  #row(peerId) {
    return this.db.prepare('SELECT * FROM contacts WHERE peer_id = ?').get(peerId);
  }

  #emit(peerId) {
    this.bus.emit('event', { type: 'contact', data: { peerId } });
  }

  list(q) {
    const rows = this.db.prepare('SELECT * FROM contacts ORDER BY COALESCE(local_label, display_name) COLLATE NOCASE').all();
    const needle = (q ?? '').toLowerCase();
    return rows
      .filter((r) => !needle || (r.local_label ?? r.display_name).toLowerCase().includes(needle) || r.display_name.toLowerCase().includes(needle))
      .map((r) => this.toApi(r));
  }

  toApi(r) {
    return {
      peerId: r.peer_id,
      displayName: r.display_name,
      localLabel: r.local_label,
      trustState: r.trust_state,
      online: this.discovery.isOnline(r.peer_id),
      hasPhoto: r.photo_hash !== null,
      hasCandidateKey: r.public_key !== null,
      peerIdHint: r.peer_id.slice(0, 6),
    };
  }

  get(peerId) {
    const r = this.#row(peerId);
    return r ? this.toApi(r) : null;
  }

  /** Verified contact with a pinned key, or null. Used by SessionService. */
  verifiedKey(peerId) {
    const r = this.#row(peerId);
    return r && r.trust_state === 'Verified' && r.public_key ? new Uint8Array(r.public_key) : null;
  }

  /** Flow A: add by Peer ID. */
  addByPeerId(input) {
    const peerId = normalisePeerId(input);
    if (!peerId) throw new AppError('VALIDATION', { message: 'Invalid input.' });
    if (peerId === this.identity.peerId) throw new AppError('CONFLICT', { message: 'Request failed.' });
    if (this.#row(peerId)) throw new AppError('CONFLICT', { message: 'Request failed.' });
    this.db
      .prepare(`INSERT INTO contacts(peer_id, display_name, trust_state, added_at_ms) VALUES (?, ?, 'PendingVerification', ?)`)
      .run(peerId, 'Unknown', this.now());
    this.discovery.markContact(peerId, true);
    const known = this.discovery.get(peerId);
    if (known) this.onDiscovered({ peerId, publicKey: known.publicKey, displayName: known.displayName });
    this.#emit(peerId);
    return this.get(peerId);
  }

  /** Flow B: add from the discovered list (candidate key only; user must still verify). */
  addDiscovered(input) {
    const peerId = normalisePeerId(input);
    if (!peerId) throw new AppError('VALIDATION', { message: 'Invalid input.' });
    if (peerId === this.identity.peerId || this.#row(peerId)) throw new AppError('CONFLICT', { message: 'Request failed.' });
    const peer = this.discovery.get(peerId);
    if (!peer) throw new AppError('NOT_FOUND', { message: 'Not found.' });
    this.db
      .prepare(
        `INSERT INTO contacts(peer_id, display_name, public_key, fingerprint, trust_state, added_at_ms)
         VALUES (?, ?, ?, ?, 'PendingVerification', ?)`,
      )
      .run(peerId, peer.displayName, Buffer.from(peer.publicKey), compactFingerprint(fingerprintFromPublicKey(peer.publicKey)), this.now());
    this.discovery.markContact(peerId, true);
    this.#emit(peerId);
    return this.get(peerId);
  }

  /** Exact match of a Peer ID or fingerprint against the candidate key. Click-through never verifies. */
  verify(peerIdInput, value) {
    const peerId = normalisePeerId(peerIdInput);
    const r = peerId && this.#row(peerId);
    if (!r) throw new AppError('NOT_FOUND', { message: 'Not found.' });
    if (r.trust_state !== 'PendingVerification' || !r.public_key) {
      throw new AppError('CONFLICT', { message: 'Request failed.' });
    }
    const asPeerId = normalisePeerId(value);
    const asFingerprint = normaliseFingerprint(value);
    const key = new Uint8Array(r.public_key);
    const matches =
      (asPeerId && asPeerId === peerIdFromPublicKey(key) && asPeerId === r.peer_id) ||
      (asFingerprint && asFingerprint === compactFingerprint(fingerprintFromPublicKey(key)));
    if (!matches) throw new AppError('VALIDATION', { message: 'The value does not match.' });
    this.#pin(r.peer_id, key);
    return this.get(r.peer_id);
  }

  #pin(peerId, key) {
    this.db
      .prepare(`UPDATE contacts SET public_key = ?, fingerprint = ?, trust_state = 'Verified', verified_at_ms = ? WHERE peer_id = ?`)
      .run(Buffer.from(key), compactFingerprint(fingerprintFromPublicKey(key)), this.now(), peerId);
    this.logger.log('contact', 'VERIFIED', { transition: 'Pending->Verified', peer: peerId });
    this.#emit(peerId);
  }

  /** Reaction to a validated advertisement: flow A completion, or the Changed safety check. */
  onDiscovered(advert) {
    const r = this.#row(advert.peerId);
    if (!r) return;
    this.discovery.markContact(advert.peerId, true);
    const name = validateDisplayNameSafe(advert.displayName);
    this.db.prepare('UPDATE contacts SET last_seen_ms = ? WHERE peer_id = ?').run(this.now(), r.peer_id);
    if (r.trust_state === 'PendingVerification' && !r.public_key) {
      // Flow A: the typed Peer ID commits to the key; the advertisement key hashes to it.
      if (peerIdFromPublicKey(advert.publicKey) === r.peer_id) {
        if (name) this.db.prepare('UPDATE contacts SET display_name = ? WHERE peer_id = ?').run(name, r.peer_id);
        this.#pin(r.peer_id, advert.publicKey);
      }
      return;
    }
    if (r.public_key && !bytesEqual(new Uint8Array(r.public_key), advert.publicKey) && r.trust_state === 'Verified') {
      this.db.prepare(`UPDATE contacts SET trust_state = 'Changed' WHERE peer_id = ?`).run(r.peer_id);
      this.logger.log('contact', 'KEY_CHANGED', { transition: 'Verified->Changed', peer: r.peer_id });
      this.closeSessionsFor?.(r.peer_id);
      this.#emit(r.peer_id);
    }
  }

  setLabel(peerIdInput, label) {
    const peerId = normalisePeerId(peerIdInput);
    if (!peerId || !this.#row(peerId)) throw new AppError('NOT_FOUND', { message: 'Not found.' });
    let value = null;
    if (label !== null) {
      value = validateDisplayNameSafe(label);
      if (!value) throw new AppError('VALIDATION', { message: 'Invalid input.' });
    }
    this.db.prepare('UPDATE contacts SET local_label = ? WHERE peer_id = ?').run(value, peerId);
    this.#emit(peerId);
  }

  /** Removes the contact; its conversation and messages cascade; sessions are closed. */
  remove(peerIdInput) {
    const peerId = normalisePeerId(peerIdInput);
    const r = peerId && this.#row(peerId);
    if (!r) throw new AppError('NOT_FOUND', { message: 'Not found.' });
    this.closeSessionsFor?.(peerId);
    const convo = this.db.prepare('SELECT id FROM conversations WHERE peer_id = ?').get(peerId);
    if (convo) this.history.memory.delete(convo.id);
    this.db.prepare('DELETE FROM contacts WHERE peer_id = ?').run(peerId);
    this.discovery.markContact(peerId, false);
    this.#emit(peerId);
  }

  updateProfileName(peerId, name) {
    this.db.prepare('UPDATE contacts SET display_name = ? WHERE peer_id = ?').run(name, peerId);
    this.#emit(peerId);
  }
}
