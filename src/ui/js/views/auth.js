import { h } from '../util.js';
import { S } from '../strings.js';
import { api, setCsrf } from '../api.js';
import { errorText, typedConfirm } from './dialogs.js';

function form(root, { title, fields, submitLabel, onSubmit, extra, banner }) {
  const err = h('div', { class: 'error' });
  const inputs = fields.map((f) => h('input', { type: f.type ?? 'text', autocomplete: f.auto ?? 'off', name: f.name }));
  const submit = h('button', { class: 'primary', type: 'button' }, submitLabel);
  const run = async () => {
    submit.disabled = true;
    try {
      await onSubmit(Object.fromEntries(fields.map((f, i) => [f.name, inputs[i].value])));
    } catch (e) {
      err.textContent = errorText(e);
      submit.disabled = banner ? true : false;
    }
  };
  submit.addEventListener('click', run);
  inputs.at(-1).addEventListener('keydown', (e) => e.key === 'Enter' && run());
  if (banner) submit.disabled = true;
  root.append(
    h('div', { class: 'center' },
      h('div', { class: 'card' },
        h('h1', {}, title),
        h('div', { class: 'muted' }, S.appName),
        banner ? h('div', { class: 'banner' }, banner) : null,
        ...fields.flatMap((f, i) => [h('label', {}, f.label), inputs[i]]),
        err,
        h('div', { class: 'row end' }, submit),
        extra ?? null)),
  );
}
export function renderRegister(root, state, done) {
  form(root, {
    title: S.register,
    submitLabel: S.register,
    banner: state.secureStorageAvailable ? null : S.noSecureStorage,
    fields: [
      { name: 'username', label: S.username, auto: 'username' },
      { name: 'displayName', label: S.displayName },
      { name: 'password', label: S.password, type: 'password', auto: 'new-password' },
    ],
    onSubmit: async (v) => {
      const r = await api.register(v);
      setCsrf(r.csrfToken);
      done();
    },
  });
}
export function renderLogin(root, state, done) {
  form(root, {
    title: S.login,
    submitLabel: S.login,
    banner: state.secureStorageAvailable ? null : S.noSecureStorage,
    fields: [
      { name: 'username', label: S.username, auto: 'username' },
      { name: 'password', label: S.passwordShort, type: 'password', auto: 'current-password' },
    ],
    onSubmit: async (v) => {
      const r = await api.login(v);
      setCsrf(r.csrfToken);
      done();
    },
    extra: h('p', { class: 'muted' },
      h('a', { href: '#', onclick: (e) => { e.preventDefault(); typedConfirm({ title: S.resetTitle, text: S.resetText, word: 'RESET', onConfirm: async () => { await api.reset(); done(); } }); } }, S.forgot)),
  });
}
