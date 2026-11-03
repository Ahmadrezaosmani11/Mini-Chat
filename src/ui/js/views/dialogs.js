import { h, clear } from '../util.js';
import { S } from '../strings.js';
import { api, ApiError } from '../api.js';

export function modal(title, build) {
  const body = h('div');
  const box = h('div', { class: 'modal', role: 'dialog', 'aria-label': title }, h('h2', {}, title), body);
  const overlay = h('div', { class: 'overlay' }, box);
  const close = () => overlay.remove();
  overlay.addEventListener('mousedown', (e) => e.target === overlay && close());
  document.body.append(overlay);
  build({ body, close });
  return { close, body };
}
export function errorText(e) {
  if (!(e instanceof ApiError)) return S.generic;
  if (e.code === 'LOCKED') return S.locked(e.retryAfterSeconds ?? 30);
  if (e.code === 'AUTH') return S.loginFailed;
  if (e.code === 'RECIPIENT_OFFLINE') return S.peerOffline;
  if (e.code === 'CONTACT_NOT_VERIFIED') return S.peerRefused;
  if (e.code === 'SEND_FAILED') return S.protocolFailure;
  return e.message || S.generic;
}
export function typedConfirm({ title, text, word, withPassword, onConfirm }) {
  modal(title, ({ body, close }) => {
    const typed = h('input', { autocomplete: 'off' });
    const pass = h('input', { type: 'password', autocomplete: 'off' });
    const err = h('div', { class: 'error' });
    const go = h('button', { class: 'danger', disabled: true }, title);
    typed.addEventListener('input', () => {
      go.disabled = typed.value !== word;
    });
    go.addEventListener('click', async () => {
      try {
        await onConfirm(pass.value);
        close();
      } catch (e) {
        err.textContent = errorText(e);
      }
    });
    body.append(
      h('p', {}, text),
      withPassword ? h('label', {}, S.passwordShort) : null,
      withPassword ? pass : null,
      h('label', {}, `Type ${word}`),
      typed,
      err,
      h('div', { class: 'row end' }, h('button', { onclick: close }, S.cancel), go),
    );
  });
}
export function addContactDialog(onDone) {
  modal(S.addById, ({ body, close }) => {
    const input = h('input', { autocomplete: 'off', spellcheck: 'false' });
    const err = h('div', { class: 'error' });
    const add = h('button', { class: 'primary' }, S.addContact);
    add.addEventListener('click', async () => {
      try {
        await api.addContact(input.value, 'manual');
        close();
        onDone();
      } catch (e) {
        err.textContent = errorText(e);
      }
    });
    body.append(h('p', { class: 'muted' }, S.addByIdHelp), input, err, h('div', { class: 'row end' }, h('button', { onclick: close }, S.cancel), add));
  });
}
export function verifyDialog(contact, onDone) {
  modal(S.verifyTitle, ({ body, close }) => {
    const input = h('input', { autocomplete: 'off', spellcheck: 'false' });
    const err = h('div', { class: 'error' });
    const go = h('button', { class: 'primary' }, S.verify);
    go.addEventListener('click', async () => {
      try {
        await api.verify(contact.peerId, input.value);
        close();
        onDone();
      } catch (e) {
        err.textContent = errorText(e);
      }
    });
    body.append(
      h('p', { class: 'muted' }, S.verifyHelp),
      h('div', { class: 'mono' }, `${contact.peerIdHint}...`),
      h('label', {}, 'Peer ID or fingerprint'),
      input,
      err,
      h('div', { class: 'row end' }, h('button', { onclick: close }, S.cancel), go),
    );
  });
}
async function toProfileJpeg(file) {
  if (file.size > 10485760) throw new Error('too large');
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  canvas.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 256, 256);
  for (let q = 0.85; q >= 0.5; q -= 0.05) {
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', q));
    if (blob && blob.size <= 65536) return blob;
  }
  throw new Error('too large');
}
export async function settingsDialog(me, { onChanged, onLoggedOut }) {
  modal(S.settings, ({ body, close }) => {
    const name = h('input', { value: me.displayName });
    const history = h('input', { type: 'checkbox' });
    history.checked = me.historyEnabled;
    history.style.width = 'auto';
    const msg = h('div', { class: 'error' });
    const file = h('input', { type: 'file', accept: 'image/*' });
    file.style.display = 'none';
    const run = async (fn) => {
      try {
        await fn();
        msg.textContent = '';
        onChanged();
      } catch (e) {
        msg.textContent = errorText(e);
      }
    };
    file.addEventListener('change', () => file.files[0] && run(async () => api.setPhoto(await toProfileJpeg(file.files[0]))));
    const cur = h('input', { type: 'password', autocomplete: 'current-password' });
    const nw = h('input', { type: 'password', autocomplete: 'new-password' });
    body.append(
      h('label', {}, S.displayName),
      h('div', { class: 'row' }, name, h('button', { onclick: () => run(() => api.setName(name.value)) }, S.save)),
      h('label', {}, S.photo),
      h('div', { class: 'row' }, h('button', { onclick: () => file.click() }, S.choosePhoto), h('button', { onclick: () => run(() => api.removePhoto()) }, S.removePhoto), file),
      h('label', {}, ''),
      h('label', { class: 'row' }, history, S.historyOn),
      h('div', {}, h('button', { onclick: () => run(() => api.setHistory(history.checked)) }, S.save)),
      h('label', {}, S.changePassword),
      cur,
      nw,
      h('div', { class: 'row end' }, h('button', { onclick: () => run(() => api.changePassword(cur.value, nw.value)) }, S.changePassword)),
      h('label', {}, S.myPeerId),
      h('div', { class: 'mono' }, me.peerId),
      h('label', {}, S.myFingerprint),
      h('div', { class: 'mono' }, me.fingerprint),
      h('label', {}, S.networkHelp),
      h('p', { class: 'muted' }, S.networkHelpText),
      msg,
      h('div', { class: 'row end' },
        h('button', { class: 'danger', onclick: () => { close(); typedConfirm({ title: S.deleteTitle, text: S.deleteText, word: 'DELETE', withPassword: true, onConfirm: async (pw) => { await api.deleteAccount(pw); onLoggedOut(); } }); } }, S.deleteTitle),
        h('button', { onclick: close }, S.cancel)),
    );
  });
}

export { clear };
