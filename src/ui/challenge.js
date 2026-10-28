/* global Anchor, I18n */
'use strict';

/**
 * Unlock challenge modal. Resolves true when the user passes the group's
 * lock (PIN or math puzzle), false when they cancel. Groups with no lock pass immediately.
 *
 *   const ok = await Challenge.run(group, I18n.t('actionDisable', { name }));
 */
const Challenge = (() => {
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    node.append(...children);
    return node;
  }

  function shell(title, subtitle) {
    const error = el('p', { class: 'error', role: 'alert' });
    const body = el('div', { class: 'problems' });
    const cancel = el('button', { class: 'btn ghost', type: 'button' }, I18n.t('cancel'));
    const submit = el('button', { class: 'btn primary', type: 'submit' }, I18n.t('unlock'));
    const card = el('form', { class: 'challenge', autocomplete: 'off' },
      el('div', {}, el('h3', {}, title), el('p', { class: 'muted' }, subtitle)),
      body, error,
      el('div', { class: 'actions' }, cancel, submit));
    const backdrop = el('div', { class: 'challenge-backdrop' }, card);
    document.body.append(backdrop);
    return { backdrop, card, body, error, cancel, submit };
  }

  function fail(ui, message) {
    ui.error.textContent = message;
    ui.card.classList.remove('shake');
    void ui.card.offsetWidth;
    ui.card.classList.add('shake');
  }

  function runPuzzle(ui) {
    let problems = [];
    let inputs = [];
    const render = () => {
      problems = Anchor.makePuzzle();
      inputs = problems.map(() => el('input', { class: 'input', inputmode: 'numeric', 'aria-label': I18n.t('answer') }));
      ui.body.replaceChildren(...problems.map((p, i) =>
        el('div', { class: 'problem' }, el('span', {}, `${p.text} =`), inputs[i])));
      inputs[0].focus();
    };
    render();
    return () => {
      const right = problems.every((p, i) => Number(inputs[i].value.trim()) === p.answer && inputs[i].value.trim() !== '');
      if (!right) {
        fail(ui, I18n.t('puzzleWrong'));
        render();
      }
      return right;
    };
  }

  function runPin(ui, group) {
    const input = el('input', {
      class: 'input pin', type: 'password', inputmode: 'numeric', maxlength: '8', 'aria-label': 'PIN',
    });
    ui.body.replaceChildren(input);
    input.focus();
    let wrong = 0;
    return async () => {
      const hash = await Anchor.hashPin(input.value, group.lock.salt);
      if (hash === group.lock.pinHash) return true;
      wrong++;
      input.value = '';
      // Each wrong guess adds a short cool-down, so guessing is a deliberate act too.
      const wait = Math.min(30, wrong * 3);
      ui.submit.disabled = true;
      fail(ui, I18n.t('pinWrong', { s: wait }));
      setTimeout(() => { ui.submit.disabled = false; ui.error.textContent = ''; input.focus(); }, wait * 1000);
      return false;
    };
  }

  function run(group, action) {
    const method = group.lock && group.lock.method;
    if (!method || method === 'none' || (method === 'pin' && !group.lock.pinHash)) return Promise.resolve(true);

    return new Promise((resolve) => {
      const isPin = method === 'pin';
      const ui = shell(
        I18n.t(isPin ? 'pinTitle' : 'puzzleTitle'),
        I18n.t(isPin ? 'pinSub' : 'puzzleSub', { action }),
      );
      const check = isPin ? runPin(ui, group) : runPuzzle(ui);
      const done = (ok) => { ui.backdrop.remove(); document.removeEventListener('keydown', onKey); resolve(ok); };
      const onKey = (e) => { if (e.key === 'Escape') done(false); };
      document.addEventListener('keydown', onKey);
      ui.cancel.addEventListener('click', () => done(false));
      ui.backdrop.addEventListener('click', (e) => { if (e.target === ui.backdrop) done(false); });
      ui.card.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (ui.submit.disabled) return;
        if (await check()) done(true);
      });
    });
  }

  return { run, el };
})();
