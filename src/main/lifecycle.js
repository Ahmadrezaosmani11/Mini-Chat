import { EventEmitter } from 'node:events';
import path from 'node:path';
import { Logger } from '../core/logging/logger.js';
import { SecretStore } from '../core/secrets/secret-store.js';
import { openDatabase } from '../core/db/database.js';
import { hasPendingWipe, finishPendingWipe } from '../core/account/erasure.js';
import { IdentityService } from '../core/identity/identity-service.js';
import { HistoryService } from '../core/history/history-service.js';
import { AccountService } from '../core/account/account-service.js';
import { DiscoveryService } from '../core/discovery/discovery-service.js';
import { ContactService } from '../core/trust/contact-service.js';
import { SessionService } from '../core/session/session-service.js';
import { MessageService } from '../core/messages/message-service.js';
import { ProfileService } from '../core/profile/profile-service.js';
import { SHUTDOWN_LIMIT_MS } from '../config/constants.js';
export async function createRuntime({ dataDir, safeStorage, config = {} }) {
  const bus = new EventEmitter();
  bus.setMaxListeners(50);
  const logger = new Logger({ dir: config.logDir === undefined ? path.join(dataDir, 'logs') : config.logDir });
  const secrets = new SecretStore({ safeStorage, dataDir });
if (hasPendingWipe(dataDir)) finishPendingWipe({ dataDir, secrets });
  const db = await openDatabase({ dataDir });
  const identity = new IdentityService({ db, secrets });
  const history = new HistoryService({ db, bus, logger, identity });
  const accountsRef = {};
  const discovery = new DiscoveryService({ identity, accounts: accountsRef, logger, config: config.discovery });
  const session = new SessionService({ identity, contacts: null, discovery, bus, logger, config: config.session });
  const contacts = new ContactService({ db, identity, discovery, bus, logger, history, closeSessionsFor: (id) => session.closeFor(id) });
  session.contacts = contacts;
  const messages = new MessageService({ session, contacts, discovery, history, identity, bus, logger });
  const accounts = new AccountService({
    db, identity, secrets, history, logger, dataDir,
    hooks: { onLoggedIn: () => startPeerServices(), onLoggedOut: (reason) => stopPeerServices(reason) },
  });
  accountsRef.ownDisplayName = undefined;
  Object.defineProperty(accountsRef, 'ownDisplayName', { get: () => accounts.ownDisplayName });
  const profile = new ProfileService({ session, contacts, history, accounts, identity, db, bus, logger });
  contacts.attach();
  messages.attach();
  profile.attach();
  discovery.on('presence', (data) => bus.emit('event', { type: 'presence', data }));
  let housekeeping = null;
  async function startPeerServices() {
    await session.listen();
    await discovery.start();
    history.purgeExpired();
    housekeeping = setInterval(() => history.purgeExpired(), 60000);
    housekeeping.unref?.();
  }
  async function stopPeerServices(reason = 'logout') {
    clearInterval(housekeeping);
    housekeeping = null;
    discovery.stop();
    await session.stop(reason);
    messages.stop();
    bus.emit('event', { type: 'session', data: { loggedOut: true } });
  }
  async function shutdown() {
    const work = accounts.logout('logout');
    await Promise.race([work, new Promise((r) => setTimeout(r, SHUTDOWN_LIMIT_MS))]);
    try {
      db.close();
    } catch {
      /* already closed */
    }
  }
