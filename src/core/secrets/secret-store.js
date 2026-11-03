import fs from 'node:fs';
import path from 'node:path';
import sodium from '../crypto/sodium.js';

export class SecretStoreUnavailable extends Error {
  constructor() {
    super('Secure storage is not available');
    this.name = 'SecretStoreUnavailable';
  }
}

export class SecretStore {
  constructor({ safeStorage, dataDir }) {
    this.safeStorage = safeStorage;
    this.secretsDir = path.join(dataDir, 'secrets');
  }
  get available() {
    try {
      return Boolean(this.safeStorage?.isEncryptionAvailable());
    } catch {
      return false;
    }
  }

  #require() {
    if (!this.available) throw new SecretStoreUnavailable();
  }
  protect(bytes) {
    this.#require();
    return this.safeStorage.encryptString(Buffer.from(bytes).toString('base64'));
  }

  unprotect(blob) {
    this.#require();
    return new Uint8Array(Buffer.from(this.safeStorage.decryptString(Buffer.from(blob)), 'base64'));
  }
  writeHistoryKey(key) {
    this.#require();
    fs.mkdirSync(this.secretsDir, { recursive: true });
    fs.writeFileSync(path.join(this.secretsDir, 'history.key'), this.protect(key));
  }

  readHistoryKey() {
    this.#require();
    return this.unprotect(fs.readFileSync(path.join(this.secretsDir, 'history.key')));
  }
  destroy() {
    const file = path.join(this.secretsDir, 'history.key');
    try {
      if (fs.existsSync(file)) {
        const size = fs.statSync(file).size;
        fs.writeFileSync(file, Buffer.alloc(size));
        fs.rmSync(file);
      }
      fs.rmSync(this.secretsDir, { recursive: true, force: true });
    } catch {
      /* best effort; wipe.pending makes the next start retry */
    }
  }

  static wipe(bytes) {
    if (bytes) sodium.memzero(bytes);
  }
}
