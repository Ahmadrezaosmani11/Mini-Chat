import { h, clear, initial, formatTime } from '../util.js';
import { S } from '../strings.js';
import { api, openEvents } from '../api.js';
import { addContactDialog, verifyDialog, settingsDialog, errorText, modal } from './dialogs.js';

export async function renderMain(root, relogin) {
  const st = { me: null, contacts: [], peers: [], convos: [], active: null, convoId: null, messages: [], tab: 'contacts', notice: '' };
  const side = h('div', { class: 'side' });
  const main = h('div', { class: 'main' });
  clear(root).append(h('div', { class: 'layout' }, side, main));
  async function loadAll() {
    [st.me, st.contacts, st.peers, st.convos] = await Promise.all([api.me(), api.contacts(), api.peers(), api.conversations()]);
    if (st.active) st.active = st.contacts.find((c) => c.peerId === st.active.peerId) ?? null;
    drawSide();
    drawMain();
  }
  async function loadMessages() {
    if (!st.convoId) return;
    st.messages = await api.messages(st.convoId);
    drawMain();
  }
  async function open(contact) {
    st.active = contact;
    st.notice = '';
    if (contact.trustState === 'Verified') {
      const c = await api.openConversation(contact.peerId);
      st.convoId = c.id;
      await api.markRead(c.id);
      await loadMessages();
      st.convos = await api.conversations();
    } else {
      st.convoId = null;
      st.messages = [];
    }
    drawSide();
    drawMain();
  }
  const avatar = (peerId, name, has) => (has ? h('img', { class: 'avatar', src: `/api/contacts/${peerId}/photo?x=${Date.now() % 100000}`, alt: '' }) : h('div', { class: 'avatar' }, initial(name)));
  const unread = (peerId) => st.convos.find((c) => c.peerId === peerId)?.unreadCount ?? 0;
  function drawSide() {
    clear(side);
    const myPhoto = st.me.hasPhoto ? h('img', { class: 'avatar', src: `/api/me/photo?x=${Date.now() % 100000}`, alt: '' }) : h('div', { class: 'avatar' }, initial(st.me.displayName));
    side.append(
      h('header', {}, h('div', { class: 'row' }, myPhoto, h('div', { class: 'grow' }, h('div', { class: 'name' }, st.me.displayName), h('div', { class: 'muted' }, `ID ${st.me.peerId.slice(0, 6)}...`)),
        h('button', { onclick: () => settingsDialog(st.me, { onChanged: loadAll, onLoggedOut: relogin }) }, S.settings))),
      h('div', { class: 'tabs' },
        h('button', { class: st.tab === 'contacts' ? 'on' : '', onclick: () => { st.tab = 'contacts'; drawSide(); } }, S.contacts),
        h('button', { class: st.tab === 'nearby' ? 'on' : '', onclick: () => { st.tab = 'nearby'; drawSide(); } }, S.nearby),
        h('button', { onclick: () => addContactDialog(loadAll) }, '+')),
    );
    const list = h('div', { class: 'list' });
    if (st.tab === 'contacts') {
      for (const c of st.contacts) {
        const n = unread(c.peerId);
        list.append(h('div', { class: `item ${st.active?.peerId === c.peerId ? 'active' : ''}`, onclick: () => open(c) },
          avatar(c.peerId, c.localLabel ?? c.displayName, c.hasPhoto),
          h('div', { class: 'grow' }, h('div', { class: 'name' }, c.localLabel ?? c.displayName), h('span', { class: `tag ${c.trustState === 'Verified' ? 'ok' : ''}` }, c.trustState === 'Verified' ? S.verified : c.trustState === 'Changed' ? S.changed : S.pending)),
          n ? h('span', { class: 'badge' }, n) : null,
          h('span', { class: `dot ${c.online ? 'on' : ''}` })));
      }
    } else {
      for (const p of st.peers) {
        list.append(h('div', { class: 'item' },
          h('div', { class: 'avatar' }, initial(p.displayName)),
          h('div', { class: 'grow' }, h('div', { class: 'name' }, p.displayName), h('div', { class: 'muted' }, `${p.peerIdHint}...`)),
          p.isContact ? null : h('button', { onclick: async () => { try { await api.addContact(p.peerId, 'discovered'); st.tab = 'contacts'; await loadAll(); } catch (e) { st.notice = errorText(e); drawMain(); } } }, S.addContact),
          h('span', { class: `dot ${p.online ? 'on' : ''}` })));
      }
    }
    side.append(list);
  }
  function messageNode(m) {
    const mine = m.senderPeerId === st.me.peerId;
    return h('div', { class: `msg ${mine ? 'mine' : ''}` }, m.text, h('small', {}, `${formatTime(m.sentAtMs)} ${mine ? (S.states[m.state] ?? '') : ''}`));
  }
  function drawMain() {
    clear(main);
    const c = st.active;
    if (!c) return void main.append(h('div', { class: 'empty' }, S.selectChat));
    main.append(h('header', {}, h('div', { class: 'grow name' }, c.localLabel ?? c.displayName),
      c.trustState === 'PendingVerification' && c.hasCandidateKey ? h('button', { class: 'primary', onclick: () => verifyDialog(c, loadAll) }, S.verify) : null,
      h('button', { class: 'danger', onclick: () => modal(S.remove, ({ body, close }) => body.append(h('p', {}, S.removeConfirm), h('div', { class: 'row end' }, h('button', { onclick: close }, S.cancel), h('button', { class: 'danger', onclick: async () => { await api.removeContact(c.peerId); st.active = null; close(); loadAll(); } }, S.remove)))) }, S.remove)));
    if (st.notice) main.append(h('div', { class: 'banner' }, st.notice));
    if (c.trustState !== 'Verified') {
      main.append(h('div', { class: 'empty' }, c.trustState === 'Changed' ? S.changed : c.hasCandidateKey ? S.verifyHelp : S.waitingKey));
      return;
    }
    const box = h('div', { class: 'msgs' }, ...st.messages.map(messageNode));
    const input = h('textarea', { rows: 2, placeholder: S.typeMessage });
    const send = h('button', { class: 'primary' }, S.send);
    const go = async () => {
      const text = input.value;
      if (!text.trim()) return;
      send.disabled = true;
      try {
        await api.send(c.peerId, text);
        input.value = '';
        st.notice = '';
      } catch (e) {
        st.notice = errorText(e);
      }
      send.disabled = false;
      await loadMessages();
    };
    send.addEventListener('click', go);
    input.addEventListener('keydown', (e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), go()));
    main.append(box, h('div', { class: 'compose' }, input, send));
    box.scrollTop = box.scrollHeight;
  }
  const refresh = () => loadAll();
  openEvents({
    open: refresh,
    presence: refresh,
    contact: refresh,
    connection: () => {},
    profile: refresh,
    conversation: async () => { st.convos = await api.conversations(); drawSide(); },
    message: async (e) => {
      if (st.active?.peerId === e.peerId) { await loadMessages(); await api.markRead(e.conversationId); }
      st.convos = await api.conversations();
      drawSide();
    },
    'message.state': loadMessages,
    history: () => { st.notice = S.historyFault; drawMain(); },
    error: (e) => { st.notice = e.code === 'PROTOCOL' ? S.protocolFailure : ''; if (st.notice) drawMain(); },
    session: relogin,
  });
  await loadAll();
}
