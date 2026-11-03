export const version = 1;
export const sql = `
CREATE TABLE account (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  id TEXT NOT NULL,
  username TEXT NOT NULL COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  history_enabled INTEGER NOT NULL DEFAULT 1 CHECK(history_enabled IN (0,1)),
  failed_logins INTEGER NOT NULL DEFAULT 0,
  lockout_until_ms INTEGER NOT NULL DEFAULT 0,
  photo_hash BLOB CHECK(photo_hash IS NULL OR length(photo_hash) = 32),
  photo_nonce BLOB CHECK(photo_nonce IS NULL OR length(photo_nonce) = 24),
  photo_ciphertext BLOB,
  created_at_ms INTEGER NOT NULL
);
CREATE TABLE local_identity (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  peer_id TEXT NOT NULL UNIQUE CHECK(length(peer_id) = 52),
  public_key BLOB NOT NULL CHECK(length(public_key) = 32),
  private_key_blob BLOB NOT NULL,
  fingerprint TEXT NOT NULL UNIQUE CHECK(length(fingerprint) = 48),
  created_at_ms INTEGER NOT NULL
);
export const version = 1;
export const sql = `
CREATE TABLE account (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  id TEXT NOT NULL,
  username TEXT NOT NULL COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  history_enabled INTEGER NOT NULL DEFAULT 1 CHECK(history_enabled IN (0,1)),
  failed_logins INTEGER NOT NULL DEFAULT 0,
  lockout_until_ms INTEGER NOT NULL DEFAULT 0,
  photo_hash BLOB CHECK(photo_hash IS NULL OR length(photo_hash) = 32),
  photo_nonce BLOB CHECK(photo_nonce IS NULL OR length(photo_nonce) = 24),
  photo_ciphertext BLOB,
  created_at_ms INTEGER NOT NULL
);
CREATE TABLE local_identity (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  peer_id TEXT NOT NULL UNIQUE CHECK(length(peer_id) = 52),
  public_key BLOB NOT NULL CHECK(length(public_key) = 32),
  private_key_blob BLOB NOT NULL,
  fingerprint TEXT NOT NULL UNIQUE CHECK(length(fingerprint) = 48),
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  peer_id TEXT NOT NULL UNIQUE REFERENCES contacts(peer_id) ON DELETE CASCADE,
  created_at_ms INTEGER NOT NULL,
  last_activity_ms INTEGER NOT NULL,
  unread_count INTEGER NOT NULL DEFAULT 0 CHECK(unread_count >= 0)
);
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_peer_id TEXT NOT NULL,
  recipient_peer_id TEXT NOT NULL,
  sent_at_ms INTEGER NOT NULL,
  received_at_ms INTEGER,
  state TEXT NOT NULL CHECK(state IN ('Sent','Delivered','Failed','RecipientOffline','Received')),
  nonce BLOB CHECK(nonce IS NULL OR length(nonce) = 24),
  ciphertext BLOB
);
CREATE TABLE seen_messages (
  sender_peer_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  PRIMARY KEY(sender_peer_id, message_id)
);
CREATE INDEX idx_seen_expiry ON seen_messages(expires_at_ms);
`;
