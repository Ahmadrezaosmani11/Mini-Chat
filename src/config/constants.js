// Central constants (SRS Appendix A.3, NFR-17).
export const PROTOCOL_VERSION = 1;
export const UI_HOST = '127.0.0.1';
export const UI_PORT = 37100;
export const DISCOVERY_PORT = 37020;
export const DISCOVERY_BIND_ADDRESS = '0.0.0.0';
export const DISCOVERY_BROADCAST_ADDRESS = '255.255.255.255';
export const PEER_WS_PORT = 37021;
export const PEER_WS_BIND_ADDRESS = '0.0.0.0';
export const WS_SUBPROTOCOL = 'dtp2p.v1';
export const WS_MAX_PAYLOAD_BYTES = 32768;
export const DISCOVERY_INTERVAL_MS = 5000;
export const PRESENCE_EXPIRY_MS = 15000;
export const DISCOVERY_CLOCK_SKEW_MS = 30000;
export const DISCOVERY_MAX_VALIDITY_MS = 30000;
export const DISCOVERY_NONCE_RETENTION_MS = 60000;
export const DISCOVERY_PACKET_MAX_BYTES = 1024;
export const MAX_DISCOVERY_PER_SOURCE_PER_MINUTE = 20;
export const MAX_DISCOVERED_PEERS = 512;
export const HANDSHAKE_MAX_BYTES = 2048;
export const HANDSHAKE_TIMEOUT_MS = 10000;
export const HANDSHAKE_REPLAY_RETENTION_MS = 120000;
export const MAX_PENDING_HANDSHAKES = 20;
export const MAX_HANDSHAKES_PER_SOURCE_PER_MINUTE = 10;
export const TCP_CONNECT_TIMEOUT_MS = 5000;
export const TARGET_SECURE_SESSIONS = 10;
export const MAX_SECURE_SESSIONS = 50;
export const REHANDSHAKE_MS = 3600000;
export const MAX_FRAMES_PER_DIRECTION = 4294967295;
export const MAX_TEXT_CHARS = 4096;
export const MAX_TEXT_UTF8_BYTES = 16384;
export const MESSAGE_DEDUP_RETENTION_MS = 86400000;
export const MESSAGE_CLOCK_SKEW_MS = 300000;
export const ACK_TIMEOUT_MS = 10000;
export const MAX_MESSAGES_PER_SECOND_PER_SESSION = 20;
export const MEMORY_MESSAGES_PER_CONVERSATION = 500;
export const PROFILE_SYNC_MIN_INTERVAL_MS = 2000;
export const PHOTO_REQUESTS_PER_MINUTE = 3;
export const PHOTO_DIMENSION_PX = 256;
export const PHOTO_MIN_DIM = 32;
export const PHOTO_MAX_DIM = 512;
export const PHOTO_MAX_BYTES = 65536;
export const PHOTO_CHUNK_BYTES = 16384;
export const PHOTO_MAX_CHUNKS = 4;
export const PHOTO_TRANSFER_TIMEOUT_MS = 15000;
export const PHOTO_UI_INPUT_MAX_BYTES = 10485760;
export const DISPLAY_NAME_MAX_CHARS = 64;
export const DISPLAY_NAME_MAX_BYTES = 256;
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 32;
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;
export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_LOCKOUT_BASE_MS = 30000;
export const LOGIN_LOCKOUT_MAX_MS = 900000;
export const PWHASH_OPSLIMIT = 3;
export const PWHASH_MEMLIMIT_BYTES = 67108864;
export const LAUNCH_TOKEN_BYTES = 32;
export const LAUNCH_TOKEN_TTL_MS = 30000;
export const SESSION_COOKIE = 'dtp2p_sid';
export const UI_COOKIE = 'dtp2p_ui';
export const API_BODY_LIMIT_BYTES = 65536;
export const SSE_HEARTBEAT_MS = 15000;
export const MESSAGE_PAGE_DEFAULT = 50;
export const MESSAGE_PAGE_MAX = 200;
export const LOG_FILE_MAX_BYTES = 1048576;
export const LOG_FILES_KEPT = 5;
export const DB_BACKUPS_KEPT = 3;
export const PEER_ID_PREFIX_LOG_CHARS = 6;
export const LOAD_DISCOVERED_PEERS = 20;
export const LOAD_SECURE_SESSIONS = 5;
export const SHUTDOWN_LIMIT_MS = 2000;
export const MESSAGES = Object.freeze({
  LOGIN_FAILED: 'Invalid username or password.',
  PEER_OFFLINE: 'Recipient is offline. Message not sent.',
  PEER_REFUSED: 'This contact is unavailable. Ask them to add your Peer ID.',
  PROTOCOL_FAILURE: 'Secure connection failed. Please try again.',
  VERSION_MISMATCH: 'This contact uses an incompatible version.',
  HISTORY_FAULT: 'History is unavailable right now. Live chat continues.',
  PORT_BUSY:
    'Another program is using a required network port. Close it and restart the application.',
});
