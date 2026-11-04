// Sending and receiving text messages (SRS 10.5-10.6, 13.4, FR-14..16, FR-18, FR-28).
// Exactly one attempt per send; nothing is ever queued; Delivered only on the matching Ack.
import { randomUUID } from 'node:crypto';
import { AppError } from '../errors.js';
import { FRAME } from '../crypto/schemas.js';
import { SessionError } from '../session/session-service.js';
import { normalisePeerId } from '../crypto/ids.js';
import * as C from '../../config/constants.js';

/** Message text rules: 4096 code points, 16 KiB UTF-8, a visible character, no U+0000. */
export function validateText(text) {
  if (typeof text !== 'string') throw new AppError('VALIDATION', { message: 'Invalid input.' });
  if ([...text].length > C.MAX_TEXT_CHARS || Buffer.byteLength(text, 'utf8') > C.MAX_TEXT_UTF8_BYTES) {
    throw new AppError('VALIDATION', { message: 'Invalid input.' });
  }
  if (!/\S/u.test(text) || text.includes('\u0000')) throw new AppError('VALIDATION', { message: 'Invalid input.' });
  return text;
}

export class MessageService {
  /** @param {{session:any, contacts:any, discovery:any, history:any, identity:any, bus:any, logger:any, now?:()=>number}} deps */
  constructor(deps) {
    Object.assign(this, deps);
    this.now = deps.now ?? Date.now;
    this.inflight = new Map(); // messageId -> {peerId, conversationId, session, timer}
  }

  attach() {
    this.session.on('frame', ({ session, type, payload }) => {
      if (type === FRAME.MESSAGE) this.#onMessage(session, payload);
      else if (type === FRAME.ACK) this.#onAck(session, payload);
    });
    this.session.on('closed', (session) => this.#onClosed(session));
  }

  #stateEvent(m, state) {
    this.bus.emit('event', { type: 'message.state', data: { messageId: m.id, conversationId: m.conversationId, state } });
  }

  #record(base, state) {
    const m = { ...base, state };
    this.history.saveMessage(m);
    this.history.touch(base.conversationId);
    this.bus.emit('event', { type: 'conversation', data: { conversationId: base.conversationId } });
    return m;
  }

  /**
   * UC-06 / UC-07. @returns {Promise<{messageId:string, state:'Sent'}>}
   * @throws {AppError} 409 RECIPIENT_OFFLINE / CONTACT_NOT_VERIFIED, 502 SEND_FAILED
   */
  async send(peerIdInput, text) {
    validateText(text);
    const peerId = normalisePeerId(peerIdInput);
    const contact = peerId && this.contacts.get(peerId);
    if (!contact) throw new AppError('NOT_FOUND', { message: 'Not found.' });
    if (contact.trustState !== 'Verified') {
      throw new AppError('CONFLICT', { message: 'Request failed.', detail: 'CONTACT_NOT_VERIFIED' });
    }
    const convo = this.history.ensureConversation(peerId);
    const base = {
      id: randomUUID(),
      conversationId: convo.id,
      senderPeerId: this.identity.peerId,
      recipientPeerId: peerId,
      sentAtMs: this.now(),
      receivedAtMs: null,
      text,
    };
    const offline = () => {
      this.#record(base, 'RecipientOffline');
      return new AppError('CONFLICT', { message: C.MESSAGES.PEER_OFFLINE, detail: 'RECIPIENT_OFFLINE' });
    };
    if (!this.discovery.isOnline(peerId) && !this.session.getSecure(peerId)) throw offline();

    let session;
    try {
      session = await this.session.connect(peerId);
    } catch (error) {
      if (error instanceof SessionError && error.code === 'NOT_VERIFIED') {
        throw new AppError('CONFLICT', { message: 'Request failed.', detail: 'CONTACT_NOT_VERIFIED' });
      }
      if (error instanceof SessionError && (error.code === 'UNAVAILABLE' || error.code === 'LIMIT')) throw offline();
      this.#record(base, 'Failed');
      throw new AppError('SEND_FAILED', { message: C.MESSAGES.PROTOCOL_FAILURE });
    }
    try {
      await this.session.send(session, FRAME.MESSAGE, { messageId: base.id, sentAtMs: base.sentAtMs, text });
    } catch {
      this.#record(base, 'Failed');
      throw new AppError('SEND_FAILED', { message: C.MESSAGES.PROTOCOL_FAILURE });
    }
    this.#record(base, 'Sent');
    // After 10 s without an Ack the state simply stays Sent; a late Ack still upgrades it.
    const timer = setTimeout(() => this.logger.log('message', 'ACK_TIMEOUT', { peer: peerId }), C.ACK_TIMEOUT_MS);
    timer.unref?.();
    this.inflight.set(base.id, { peerId, conversationId: convo.id, session, timer });
    this.#stateEvent(base, 'Sent');
    return { messageId: base.id, state: 'Sent' };
  }

  #onAck(session, { messageId, receivedAtMs }) {
    const entry = this.inflight.get(messageId);
    if (!entry || entry.session !== session) {
      this.logger.log('message', 'ACK_UNKNOWN', { counters: { n: 1 } }); // unknown ids are ignored
      return;
    }
    clearTimeout(entry.timer);
    this.inflight.delete(messageId);
    this.history.updateState(messageId, entry.conversationId, 'Delivered', receivedAtMs);
    this.#stateEvent({ id: messageId, conversationId: entry.conversationId }, 'Delivered');
  }

  #onClosed(session) {
    for (const [id, entry] of this.inflight) {
      if (entry.session !== session) continue;
      clearTimeout(entry.timer);
      this.inflight.delete(id);
      this.history.updateState(id, entry.conversationId, 'Failed'); // unacknowledged at close
      this.#stateEvent({ id, conversationId: entry.conversationId }, 'Failed');
    }
  }

  /** Receiver side of a Message frame (frame schema was already validated). */
  #onMessage(session, { messageId, sentAtMs, text }) {
    const peerId = session.peerId;
    const t = this.now();
    try {
      validateText(text);
      if (Math.abs(t - sentAtMs) > C.MESSAGE_CLOCK_SKEW_MS) throw new Error('clock');
    } catch {
      this.session.send(session, FRAME.ERROR, { code: 'PROTOCOL' }).catch(() => {});
      return; // nothing displayed, stored or acknowledged
    }
    if (this.history.hasSeen(peerId, messageId)) return; // duplicate: no display, no store, no new Ack
    const convo = this.history.ensureConversation(peerId);
    const m = {
      id: messageId,
      conversationId: convo.id,
      senderPeerId: peerId,
      recipientPeerId: this.identity.peerId,
      sentAtMs,
      receivedAtMs: t,
      state: 'Received',
      text,
    };
    this.history.saveMessage(m, { sender: peerId, id: messageId });
    this.history.touch(convo.id, { unreadDelta: 1 });
    this.bus.emit('event', { type: 'message', data: { conversationId: convo.id, peerId, messageId } });
    this.bus.emit('event', { type: 'conversation', data: { conversationId: convo.id } });
    this.session.send(session, FRAME.ACK, { messageId, receivedAtMs: t, status: 'accepted' }).catch(() => {});
  }

  /** After a crash a stored `Sending` message is shown as Failed; only final states are stored. */
  stop() {
    for (const entry of this.inflight.values()) clearTimeout(entry.timer);
    this.inflight.clear();
  }
}
