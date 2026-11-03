import { randomUUID } from 'node:crypto';
import sodium from '../crypto/sodium.js';
import { AppError } from '../errors.js';
import { validateDisplayName } from '../profile/display-name.js';
import { eraseInstallation } from './erasure.js';
import {
  USERNAME_MIN,
  USERNAME_MAX,
  PASSWORD_MIN,
  PASSWORD_MAX,
  LOGIN_MAX_FAILURES,
  LOGIN_LOCKOUT_BASE_MS,
  LOGIN_LOCKOUT_MAX_MS,
  PWHASH_OPSLIMIT,
  PWHASH_MEMLIMIT_BYTES,
  MESSAGES,
} from '../../config/constants.js';

const USERNAME_RE = /^[A-Za-z0-9._-]+$/;

export class AccountService {
  constructor({ db, identity, secrets, history, logger, dataDir, hooks, now = Date.now }) {
    Object.assign(this, { db, identity, secrets, history, logger, dataDir, hooks, now });
    this.loggedIn = false;
  }

  accountExists() {
    return Boolean(this.db.prepare('SELECT 1 FROM account WHERE singleton = 1').get());
  }

  #row() {
    return this.db.prepare('SELECT * FROM account WHERE singleton = 1').get();
  }
  #validateCredentials({ username, password }) {
    if (typeof username !== 'string' || username.length < USERNAME_MIN || username.length > USERNAME_MAX || !USERNAME_RE.test(username)) {
      throw new AppError('VALIDATION', { message: 'Invalid input.' });
    }
    this.#validatePassword(password);
  }

  #validatePassword(password) {
    if (typeof password !== 'string' || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
      throw new AppError('VALIDATION', { message: 'Invalid input.' });
    }
  }

  #hash(password) {
    return sodium.crypto_pwhash_str(password, PWHASH_OPSLIMIT, PWHASH_MEMLIMIT_BYTES);
  }
  async register({ username, displayName, password }) {
    if (this.accountExists()) throw new AppError('CONFLICT', { message: 'Request failed.' });
    if (!this.secrets.available) {
      throw new AppError('INTERNAL', { message: 'Secure storage is not available on this computer.' });
    }
    this.#validateCredentials({ username, password });
    let name;
    try {
      name = validateDisplayName(displayName);
    } catch {
      throw new AppError('VALIDATION', { message: 'Invalid input.' });
    }
    const passwordHash = this.#hash(password);
    const identity = this.identity.create();
    const historyKey = sodium.randombytes_buf(32);
    try {
      this.secrets.writeHistoryKey(historyKey);
      this.db.transaction(() => {
        this.db
          .prepare(
            `INSERT INTO account(singleton, id, username, display_name, password_hash, created_at_ms)
             VALUES (1, ?, ?, ?, ?, ?)`,
          )
          .run(randomUUID(), username, name, passwordHash, this.now());
        this.identity.insert(identity);
      })();
    } catch (error) {
      this.secrets.destroy();
      this.logger.log('account', 'REGISTER_FAILED');
      throw error instanceof AppError ? error : new AppError('INTERNAL');
    } finally {
      sodium.memzero(historyKey);
    }
    await this.#startSession();
    this.logger.log('account', 'REGISTERED');
  }
  async #startSession() {
    this.identity.load();
    this.history.setKey(this.secrets.readHistoryKey());
    this.loggedIn = true;
    try {
      await this.hooks.onLoggedIn();
    } catch {
      await this.logout('logout');
      throw new AppError('INTERNAL', { message: MESSAGES.PORT_BUSY });
    }
  }
  #checkPassword(row, password) {
    const t = this.now();
    if (row.lockout_until_ms > t) {
      throw new AppError('LOCKED', {
        message: 'Too many attempts.',
        retryAfterSeconds: Math.ceil((row.lockout_until_ms - t) / 1000),
      });
    }
    let ok = false;
    try {
      ok = typeof password === 'string' && sodium.crypto_pwhash_str_verify(row.password_hash, password);
    } catch {
      ok = false;
    }
    if (ok) {
      this.db.prepare('UPDATE account SET failed_logins = 0, lockout_until_ms = 0 WHERE singleton = 1').run();
      return;
    }
    const failures = row.failed_logins + 1;
    let lockUntil = 0;
    if (failures >= LOGIN_MAX_FAILURES) {
      const lock = Math.min(LOGIN_LOCKOUT_BASE_MS * 2 ** (failures - LOGIN_MAX_FAILURES), LOGIN_LOCKOUT_MAX_MS);
      lockUntil = t + lock;
    }
    this.db
      .prepare('UPDATE account SET failed_logins = ?, lockout_until_ms = ? WHERE singleton = 1')
      .run(failures, lockUntil);
    this.logger.log('account', 'AUTH_FAILED', { counters: { failures } });
    if (lockUntil > 0) {
      throw new AppError('LOCKED', {
        message: 'Too many attempts.',
        retryAfterSeconds: Math.ceil((lockUntil - t) / 1000),
      });
    }
    throw new AppError('AUTH', { message: MESSAGES.LOGIN_FAILED });
  }
  async login({ username, password }) {
    if (!this.secrets.available) {
      throw new AppError('INTERNAL', { message: 'Secure storage is not available on this computer.' });
    }
    const row = this.#row();
    if (!row || typeof username !== 'string' || row.username.toLowerCase() !== username.toLowerCase()) {
      if (row) this.#checkPassword(row, '\u0000');
      throw new AppError('AUTH', { message: MESSAGES.LOGIN_FAILED });
    }
    this.#checkPassword(row, password);
    if (
      typeof sodium.crypto_pwhash_str_needs_rehash === 'function' &&
      sodium.crypto_pwhash_str_needs_rehash(row.password_hash, PWHASH_OPSLIMIT, PWHASH_MEMLIMIT_BYTES)
    ) {
      this.db.prepare('UPDATE account SET password_hash = ? WHERE singleton = 1').run(this.#hash(password));
    }
    await this.#startSession();
    this.logger.log('account', 'LOGIN_OK');
  }
  async logout(reason = 'logout') {
    if (!this.loggedIn) return;
    this.loggedIn = false;
    await this.hooks.onLoggedOut(reason);
    this.identity.destroy();
    this.history.clearKey();
  }
  async changePassword({ currentPassword, newPassword }) {
    const row = this.#row();
    this.#checkPassword(row, currentPassword);
    this.#validatePassword(newPassword);
    this.db.prepare('UPDATE account SET password_hash = ? WHERE singleton = 1').run(this.#hash(newPassword));
    this.logger.log('account', 'PASSWORD_CHANGED');
  }
  async #erase() {
    this.loggedIn = false;
    await eraseInstallation({
      dataDir: this.dataDir,
      db: this.db,
      secrets: this.secrets,
      stopServices: async () => {
        await this.hooks.onLoggedOut('logout');
        this.identity.destroy();
        this.history.clearKey();
      },
    });
    this.logger.log('account', 'ERASED');
  }

  async deleteAccount({ password, confirm }) {
    if (confirm !== 'DELETE') throw new AppError('VALIDATION', { message: 'Invalid input.' });
    this.#checkPassword(this.#row(), password);
    await this.#erase();
  }

  async resetInstallation({ confirm }) {
    if (confirm !== 'RESET') throw new AppError('VALIDATION', { message: 'Invalid input.' });
    await this.#erase();
  }
  me() {
    const row = this.#row();
    return {
      username: row.username,
      displayName: row.display_name,
      peerId: this.identity.peerId,
      fingerprint: this.identity.fingerprint?.match(/.{4}/g).join(' '),
      historyEnabled: row.history_enabled === 1,
      hasPhoto: row.photo_hash !== null,
    };
  }

  setHistoryEnabled(enabled) {
    this.db.prepare('UPDATE account SET history_enabled = ? WHERE singleton = 1').run(enabled ? 1 : 0);
  }

  get ownDisplayName() {
    return this.#row()?.display_name ?? '';
  }
}
