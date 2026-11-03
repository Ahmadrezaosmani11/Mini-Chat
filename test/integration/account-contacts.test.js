import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRuntime } from '../../src/main/lifecycle.js';
import sodium from '../../src/core/crypto/sodium.js';
import { peerIdFromPublicKey, fingerprintFromPublicKey } from '../../src/core/crypto/ids.js';

const fakeSafeStorage = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from(`enc:${s}`),
  decryptString: (b) => b.toString().replace(/^enc:/, ''),
});

let dir;
let rt;
const noNet = { logDir: null };

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtp2p-'));
  rt = await createRuntime({ dataDir: dir, safeStorage: fakeSafeStorage(), config: noNet });
  rt.session.listen = async () => {};
  rt.discovery.start = async () => {};
});
afterEach(async () => {
  rt.db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const creds = { username: 'ahmad', displayName: 'Ahmad', password: 'correct horse battery' };
describe('account (FR-01..04, FR-30, FR-31)', () => {
  it('registers once, creates identity and history key; second register is a conflict', async () => {
    await rt.accounts.register(creds);
    expect(rt.identity.peerId).toMatch(/^[a-z2-7]{52}$/);
    expect(fs.existsSync(path.join(dir, 'secrets', 'history.key'))).toBe(true);
    await expect(rt.accounts.register(creds)).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('refuses registration when safeStorage is unavailable (no plaintext fallback)', async () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'dtp2p-'));
    const r = await createRuntime({ dataDir: other, safeStorage: fakeSafeStorage(false), config: noNet });
    await expect(r.accounts.register(creds)).rejects.toMatchObject({ code: 'INTERNAL' });
    r.db.close();
  });
  it('locks after 5 failures, with a generic message before that', async () => {
    await rt.accounts.register(creds);
    await rt.accounts.logout();
    for (let i = 0; i < 4; i += 1) await expect(rt.accounts.login({ username: 'ahmad', password: 'wrong wrong wrong' })).rejects.toMatchObject({ code: 'AUTH' });
    await expect(rt.accounts.login({ username: 'ahmad', password: 'wrong wrong wrong' })).rejects.toMatchObject({ code: 'LOCKED' });
    await expect(rt.accounts.login({ username: 'ahmad', password: creds.password })).rejects.toMatchObject({ code: 'LOCKED' });
  });
  it('reset erases everything and returns to the registration state', async () => {
    await rt.accounts.register(creds);
    await rt.accounts.resetInstallation({ confirm: 'RESET' });
    expect(rt.accounts.accountExists()).toBe(false);
    expect(fs.existsSync(path.join(dir, 'secrets', 'history.key'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'wipe.pending'))).toBe(false);
  });
});
describe('contacts and trust (SRS 6.3)', () => {
  const other = () => {
    const kp = sodium.crypto_sign_keypair();
    return { pub: kp.publicKey, id: peerIdFromPublicKey(kp.publicKey), fp: fingerprintFromPublicKey(kp.publicKey) };
  };

  it('flow A: Peer ID typed, advertisement completes verification and pins the key', async () => {
    await rt.accounts.register(creds);
    const p = other();
    rt.contacts.addByPeerId(p.id);
    expect(rt.contacts.get(p.id).trustState).toBe('PendingVerification');
    rt.contacts.onDiscovered({ peerId: p.id, publicKey: p.pub, displayName: 'Bob' });
    expect(rt.contacts.get(p.id).trustState).toBe('Verified');
  });
  it('flow B: click-through never verifies; exact Peer ID or fingerprint does', async () => {
    await rt.accounts.register(creds);
    const p = other();
    rt.discovery.peers.set(p.id, { ip: '192.168.1.5', port: 37021, displayName: 'Bob', publicKey: p.pub, lastSeenMs: Date.now() });
    rt.contacts.addDiscovered(p.id);
    expect(() => rt.contacts.verify(p.id, '')).toThrow();
    expect(() => rt.contacts.verify(p.id, other().id)).toThrow();
    expect(rt.contacts.verify(p.id, p.fp.toLowerCase()).trustState).toBe('Verified');
  });
  it('rejects adding your own Peer ID and flags a changed key', async () => {
    await rt.accounts.register(creds);
    expect(() => rt.contacts.addByPeerId(rt.identity.peerId)).toThrow();
    const p = other();
    rt.contacts.addByPeerId(p.id);
    rt.contacts.onDiscovered({ peerId: p.id, publicKey: p.pub, displayName: 'Bob' });
    rt.contacts.onDiscovered({ peerId: p.id, publicKey: other().pub, displayName: 'Bob' });
    expect(rt.contacts.get(p.id).trustState).toBe('Changed');
  });
  it('contact removal cascades to conversation and messages', async () => {
    await rt.accounts.register(creds);
    const p = other();
    rt.contacts.addByPeerId(p.id);
    const convo = rt.history.ensureConversation(p.id);
    rt.history.saveMessage({ id: crypto.randomUUID(), conversationId: convo.id, senderPeerId: p.id, recipientPeerId: rt.identity.peerId, sentAtMs: Date.now(), receivedAtMs: Date.now(), state: 'Received', text: 'hello' });
    expect(rt.history.listMessages(convo.id)[0].text).toBe('hello');
    rt.contacts.remove(p.id);
    expect(rt.db.prepare('SELECT COUNT(*) AS n FROM messages').get().n).toBe(0);
  });
  it('stores message text only as ciphertext', async () => {
    await rt.accounts.register(creds);
    const p = other();
    rt.contacts.addByPeerId(p.id);
    const convo = rt.history.ensureConversation(p.id);
    rt.history.saveMessage({ id: crypto.randomUUID(), conversationId: convo.id, senderPeerId: p.id, recipientPeerId: rt.identity.peerId, sentAtMs: Date.now(), receivedAtMs: Date.now(), state: 'Received', text: 'top-secret-text' });
    const raw = fs.readFileSync(path.join(dir, 'db', 'dtp2p.sqlite'));
    expect(raw.includes(Buffer.from('top-secret-text'))).toBe(false);
  });
});
