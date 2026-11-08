// Encrypted history and photos (SRS 12.3, FR-17, FR-27). Nothing readable is ever written to SQLite.
import { randomUUID } from 'node:crypto';
import sodium from '../crypto/sodium.js';
import { encodeCanonical, decodeStrict } from '../crypto/cbor.js';
import {
  MEMORY_MESSAGES_PER_CONVERSATION,
  MESSAGE_PAGE_DEFAULT,
  MESSAGE_PAGE_MAX,
  MESSAGE_DEDUP_RETENTION_MS,
} from '../../config/constants.js';

const aead = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt;
const unaead = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt;
const hex = (u8) => Buffer.from(u8).toString('hex');

export class HistoryService {
  /** @param {{db:any, bus:any, logger:any, identity:any}} deps */
  constructor({ db, bus, logger, identity, now = Date.now }) {
    Object.assign(this, { db, bus, logger, identity, now });
    this.key = null;
    this.memory = new Map(); // conversationId -> message[] (history off, or DB fault)
    this.seenMemory = new Map(); // `${sender}:${id}` -> expiresAtMs
    this.faulted = false;
  }

  setKey(key) {
    this.key = key;
  }

  clearKey() {
    if (this.key) sodium.memzero(this.key);
    this.key = null;
    this.memory.clear(); // memory-only messages are cleared at logout and exit
    this.seenMemory.clear();
  }

  get enabled() {
    const row = this.db.prepare('SELECT history_enabled FROM account WHERE singleton = 1').get();
    return row?.history_enabled === 1;
  }

  // ---- conversations ----------------------------------------------------------------------
  ensureConversation(peerId) {
    const found = this.db.prepare('SELECT * FROM conversations WHERE peer_id = ?').get(peerId);
    if (found) return this.#convo(found);
    const id = randomUUID();
    const t = this.now();
    this.db
      .prepare('INSERT INTO conversations(id, peer_id, created_at_ms, last_activity_ms) VALUES (?, ?, ?, ?)')
      .run(id, peerId, t, t);
    return this.#convo(this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id));
  }

  getConversation(id) {
    const row = this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
    return row ? this.#convo(row) : null;
  }

  #convo(row) {
    return {
      id: row.id,
      peerId: row.peer_id,
      lastActivityMs: row.last_activity_ms,
      unreadCount: row.unread_count,
    };
  }

  listConversations() {
    const rows = this.db.prepare('SELECT * FROM conversations ORDER BY last_activity_ms DESC').all();
    return rows.map((row) => {
      const [last] = this.listMessages(row.id, { limit: 1 });
      return { ...this.#convo(row), preview: last ? last.text.slice(0, 80) : '' };
    });
  }

  touch(conversationId, { unreadDelta = 0 } = {}) {
    this.db
      .prepare('UPDATE conversations SET last_activity_ms = ?, unread_count = unread_count + ? WHERE id = ?')
      .run(this.now(), unreadDelta, conversationId);
  }

  markRead(conversationId) {
    this.db.prepare('UPDATE conversations SET unread_count = 0 WHERE id = ?').run(conversationId);
  }

  deleteConversation(conversationId) {
    this.memory.delete(conversationId);
    this.db.prepare('DELETE FROM conversations WHERE id = ?').run(conversationId);
  }

  // ---- messages ---------------------------------------------------------------------------
  #aad(m) {
    return encodeCanonical({
      id: m.id,
      conversationId: m.conversationId,
      sender: m.senderPeerId,
      recipient: m.recipientPeerId,
      sentAtMs: m.sentAtMs,
    });
  }

  #remember(m) {
    const list = this.memory.get(m.conversationId) ?? [];
    list.push({ ...m });
    while (list.length > MEMORY_MESSAGES_PER_CONVERSATION) list.shift();
    this.memory.set(m.conversationId, list);
  }

  /**
   * Stores one message. @param {object} m {id, conversationId, senderPeerId, recipientPeerId,
   * sentAtMs, receivedAtMs, state, text} @param {{sender:string, id:string}|null} seen
   * (incoming messages: written in the same transaction as the message row)
   */
  saveMessage(m, seen = null) {
    if (seen) this.seenMemory.set(`${seen.sender}:${seen.id}`, this.now() + MESSAGE_DEDUP_RETENTION_MS);
    if (!this.enabled || !this.key) {
      this.#remember(m);
      return;
    }
    try {
      const nonce = sodium.randombytes_buf(24);
      const ciphertext = aead(encodeCanonical({ text: m.text }), this.#aad(m), null, nonce, this.key);
      this.db.transaction(() => {
        this.db
          .prepare(
            `INSERT INTO messages(id, conversation_id, sender_peer_id, recipient_peer_id, sent_at_ms,
               received_at_ms, state, nonce, ciphertext) VALUES (?,?,?,?,?,?,?,?,?)`,
          )
          .run(m.id, m.conversationId, m.senderPeerId, m.recipientPeerId, m.sentAtMs, m.receivedAtMs ?? null, m.state, Buffer.from(nonce), Buffer.from(ciphertext));
        if (seen) {
          this.db
            .prepare('INSERT OR IGNORE INTO seen_messages(sender_peer_id, message_id, expires_at_ms) VALUES (?,?,?)')
            .run(seen.sender, seen.id, this.now() + MESSAGE_DEDUP_RETENTION_MS);
        }
      })();
    } catch {
      this.#fault(m);
    }
  }

  #fault(m) {
    this.#remember(m); // live chat continues; never a plaintext fallback on disk
    if (!this.faulted) {
      this.faulted = true;
      this.logger.log('history', 'HISTORY_UNAVAILABLE');
      this.bus.emit('event', { type: 'history', data: { status: 'unavailable' } });
    }
  }

  updateState(id, conversationId, state, receivedAtMs) {
    const mem = this.memory.get(conversationId)?.find((x) => x.id === id);
    if (mem) mem.state = state;
    try {
      this.db
        .prepare('UPDATE messages SET state = ?, received_at_ms = COALESCE(?, received_at_ms) WHERE id = ?')
        .run(state, receivedAtMs ?? null, id);
    } catch {
      /* history fault already reported on write */
    }
  }

  listMessages(conversationId, { before = Number.MAX_SAFE_INTEGER, limit = MESSAGE_PAGE_DEFAULT } = {}) {
    const n = Math.min(Math.max(1, limit), MESSAGE_PAGE_MAX);
    const out = [];
    if (this.key) {
      const rows = this.db
        .prepare(
          'SELECT * FROM messages WHERE conversation_id = ? AND sent_at_ms < ? ORDER BY sent_at_ms DESC LIMIT ?',
        )
        .all(conversationId, before, n);
      for (const row of rows) {
        const m = {
          id: row.id,
          conversationId: row.conversation_id,
          senderPeerId: row.sender_peer_id,
          recipientPeerId: row.recipient_peer_id,
          sentAtMs: row.sent_at_ms,
          receivedAtMs: row.received_at_ms,
          state: row.state,
        };
        try {
          const plain = unaead(null, row.ciphertext, this.#aad(m), row.nonce, this.key);
          out.push({ ...m, text: decodeStrict(plain).text });
        } catch {
          /* a row that fails authentication is skipped, never shown */
        }
      }
    }
    const ids = new Set(out.map((x) => x.id));
    for (const m of this.memory.get(conversationId) ?? []) {
      if (!ids.has(m.id) && m.sentAtMs < before) out.push({ ...m });
    }
    out.sort((a, b) => b.sentAtMs - a.sentAtMs);
    return out.slice(0, n).reverse(); // oldest first for display
  }

  // ---- duplicate suppression (24 h) ----------------------------------------------------------
  hasSeen(sender, id) {
    const key = `${sender}:${id}`;
    const exp = this.seenMemory.get(key);
    if (exp && exp > this.now()) return true;
    if (!this.enabled) return false;
    const row = this.db
      .prepare('SELECT expires_at_ms FROM seen_messages WHERE sender_peer_id = ? AND message_id = ?')
      .get(sender, id);
    return Boolean(row && row.expires_at_ms > this.now());
  }

  purgeExpired() {
    const t = this.now();
    for (const [k, exp] of this.seenMemory) if (exp <= t) this.seenMemory.delete(k);
    try {
      this.db.prepare('DELETE FROM seen_messages WHERE expires_at_ms <= ?').run(t);
    } catch {
      /* ignore */
    }
  }

  // ---- photos (own photo -> account row, contact photo -> contacts row) ------------------------
  #photoAad(owner, hash) {
    return new TextEncoder().encode(`photo:${owner}:${hex(hash)}`);
  }

  savePhoto(ownerPeerId, jpeg, photoHash) {
    if (!this.key) throw new Error('history key not loaded');
    const nonce = sodium.randombytes_buf(24);
    const ct = aead(jpeg, this.#photoAad(ownerPeerId, photoHash), null, nonce, this.key);
    const args = [Buffer.from(photoHash), Buffer.from(nonce), Buffer.from(ct)];
    if (ownerPeerId === this.identity.peerId) {
      this.db
        .prepare('UPDATE account SET photo_hash = ?, photo_nonce = ?, photo_ciphertext = ? WHERE singleton = 1')
        .run(...args);
    } else {
      this.db
        .prepare(
          'UPDATE contacts SET photo_hash = ?, photo_nonce = ?, photo_ciphertext = ?, photo_updated_at_ms = ? WHERE peer_id = ?',
        )
        .run(...args, this.now(), ownerPeerId);
    }
  }

  #photoRow(ownerPeerId) {
    return ownerPeerId === this.identity.peerId
      ? this.db.prepare('SELECT photo_hash, photo_nonce, photo_ciphertext FROM account WHERE singleton = 1').get()
      : this.db.prepare('SELECT photo_hash, photo_nonce, photo_ciphertext FROM contacts WHERE peer_id = ?').get(ownerPeerId);
  }

  photoHash(ownerPeerId) {
    const row = this.#photoRow(ownerPeerId);
    return row?.photo_hash ? new Uint8Array(row.photo_hash) : null;
  }

  loadPhoto(ownerPeerId) {
    const row = this.#photoRow(ownerPeerId);
    if (!row?.photo_ciphertext || !this.key) return null;
    try {
      return new Uint8Array(unaead(null, row.photo_ciphertext, this.#photoAad(ownerPeerId, row.photo_hash), row.photo_nonce, this.key));
    } catch {
      return null;
    }
  }

  deletePhoto(ownerPeerId) {
    if (ownerPeerId === this.identity.peerId) {
      this.db.prepare('UPDATE account SET photo_hash = NULL, photo_nonce = NULL, photo_ciphertext = NULL WHERE singleton = 1').run();
    } else {
      this.db
        .prepare('UPDATE contacts SET photo_hash = NULL, photo_nonce = NULL, photo_ciphertext = NULL, photo_updated_at_ms = NULL WHERE peer_id = ?')
        .run(ownerPeerId);
    }
  }
}
