import { api, setCsrf } from './api.js';
import { clear, h } from './util.js';
import { S } from './strings.js';
import { renderRegister, renderLogin } from './views/auth.js';
import { renderMain } from './views/main.js';

const root = document.getElementById('app');

export async function route() {
  clear(root);
  let state;
  try {
    state = await api.session();
  } catch {
    root.append(h('div', { class: 'center' }, h('div', { class: 'card' }, S.generic)));
    return;
  }
  if (state.authenticated) {
    setCsrf(state.csrfToken);
    await renderMain(root, route);
  } else if (!state.accountExists) {
    renderRegister(root, state, route);
  } else {
    renderLogin(root, state, route);
  }
}

route();
