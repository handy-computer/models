/* Progressive enhancement: turn a <select> into a searchable combobox
   (WAI-ARIA APG "editable combobox with list autocomplete"), no library.

   Single mode (<select>): the field shows the current choice. Focus puts it
   in search mode: the text clears, a placeholder invites typing, and the full
   list opens on the current item. Enter or click chooses and calls
   onChoose(value); Escape/blur close and the current choice comes back.

   Multi mode (<select multiple>): the chosen options sit in the field as
   removable tokens, in the order they were added, and the text input adds
   more. Enter or click toggles an option and keeps the list open; Backspace
   on an empty input removes the last token. Removing a token that would drop
   the set below `min` lifts it out and opens the list for a replacement; if
   nothing is chosen before the field blurs, it comes back. onChange(values)
   fires on every change that keeps at least `min`. An option's data-token
   gives its short token text.

   Either way: <optgroup>s become labelled groups; typing filters
   (case-insensitive substring, ranked so a whole-word match like a language
   code comes first, then prefix matches); the select is replaced in the DOM
   and its id moves to the input so an existing <label for> keeps working. */

import { el, svgEl } from './dom';

export interface ComboboxOptions {
  multiple?: boolean;
  /** multi mode: never remove below this many tokens */
  min?: number;
  placeholder?: string;
  onChoose?: (value: string) => void;
  onChange?: (values: string[]) => void;
}

export interface Combobox {
  el: HTMLElement;
  values(): string[];
  setValues(values: string[]): void;
}

interface Group { label: string | null; opts: Opt[]; node: HTMLElement }
interface Opt { value: string; label: string; token: string; node: HTMLElement }

let uid = 0;

function rank(label: string, q: string): number {
  const l = label.toLowerCase();
  if (!l.includes(q)) return -1;
  const words = l.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.includes(q)) return 0;
  if (l.startsWith(q)) return 1;
  if (words.some(w => w.startsWith(q))) return 2;
  return 3;
}

const icon = (d: string) => svgEl('svg', { viewBox: '0 0 16 16', width: '15', height: '15', 'aria-hidden': 'true' },
  svgEl('path', { d, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
const MAGNIFIER = 'M7 12.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11ZM11 11l3.5 3.5';
const CHEVRON = 'M4 6l4 4 4-4';
const kbd = (t: string) => el('kbd', { text: t });

export function enhanceCombobox(select: HTMLSelectElement, o: ComboboxOptions = {}): Combobox {
  const multiple = o.multiple ?? select.multiple;
  const min = o.min ?? 0;
  const id = select.id || `combo-${++uid}`;
  const listId = `${id}-list`;
  const name = select.labels?.[0]?.textContent?.trim() || 'options';
  const placeholder = o.placeholder ?? select.dataset.placeholder
    ?? (multiple ? 'add…' : `search ${select.options.length} ${name}s…`);

  const input = el('input', {
    id, class: 'combo-input', type: 'text', role: 'combobox', placeholder,
    autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false',
    'aria-expanded': 'false', 'aria-controls': listId, 'aria-autocomplete': 'list', 'aria-label': name,
  });
  const toggle = el('button', { type: 'button', class: 'combo-toggle', tabindex: '-1', 'aria-label': `show all ${name}` }, icon(CHEVRON));
  const field = el('div', { class: 'combo-field' }, el('span', { class: 'combo-icon' }, icon(MAGNIFIER)), input, toggle);
  const list = el('div', { id: listId, class: 'combo-list', role: 'listbox', 'aria-label': name,
    'aria-multiselectable': multiple ? 'true' : null });
  const empty = el('div', { class: 'combo-empty', text: 'no matches', hidden: true });
  const hint = el('div', { class: 'combo-hint', 'aria-hidden': 'true' },
    kbd('↑↓'), ' move ', kbd('↵'), multiple ? ' add / remove ' : ' select ', kbd('esc'), ' close');
  const pop = el('div', { class: 'combo-pop', hidden: true }, list, hint);
  const wrap = el('div', { class: ['combo', multiple ? 'is-multi' : '', select.className].filter(Boolean).join(' '), 'data-open': 'false' }, field, pop);

  /* build the list, preserving optgroup order */
  const groups: Group[] = [];
  const opts: Opt[] = [];
  const chosen = new Set<Opt>();
  const byParent = new Map<Element, Group>();
  for (const option of select.options) {
    const parent = option.parentElement!;
    let grp = byParent.get(parent);
    if (!grp) {
      const label = parent instanceof HTMLOptGroupElement ? parent.label : null;
      const node = el('div', { role: label ? 'group' : null, 'aria-label': label });
      if (label) node.append(el('div', { class: 'combo-group', 'aria-hidden': 'true', text: label }));
      grp = { label, opts: [], node };
      byParent.set(parent, grp);
      groups.push(grp);
      list.append(node);
    }
    const label = option.textContent ?? '';
    const node = el('div', { role: 'option', id: `${id}-o${opts.length}`, 'aria-selected': 'false', class: 'combo-opt', text: label });
    const opt: Opt = { value: option.value, label, token: option.dataset.token ?? label, node };
    if (option.selected) chosen.add(opt);
    node.addEventListener('mousemove', () => { if (active !== opt) setActive(opt); });
    node.addEventListener('click', () => pick(opt));
    grp.node.append(node);
    grp.opts.push(opt);
    opts.push(opt);
  }
  list.append(empty);

  let visible: Opt[] = opts;
  let active: Opt | null = null;
  let open = false;

  const values = () => [...chosen].map(x => x.value);
  const currentLabel = () => [...chosen][0]?.label ?? '';
  const focused = () => document.activeElement === input;
  /** tokens lifted out below `min`; put back on blur unless replaced */
  let lifted: Opt[] = [];

  /* reflect `chosen` in the list, the tokens (multi) or the field text (single) */
  function syncChosen(): void {
    for (const x of opts) {
      const on = chosen.has(x);
      x.node.classList.toggle('is-chosen', on);
      if (multiple) x.node.setAttribute('aria-selected', String(on));
    }
    if (multiple) {
      for (const t of field.querySelectorAll('.combo-token')) t.remove();
      for (const x of chosen) {
        const remove = el('button', { type: 'button', class: 'combo-token-x', 'aria-label': `remove ${x.label}`, text: '×' });
        remove.addEventListener('click', () => pick(x));
        input.before(el('span', { class: 'combo-token' }, x.token, remove));
      }
    } else if (!focused()) {
      input.value = currentLabel();
    }
  }

  function filter(raw: string): void {
    const q = raw.trim().toLowerCase();
    visible = [];
    for (const grp of groups) {
      const matched = q
        ? grp.opts.map((x, i) => ({ x, r: rank(x.label, q), i }))
            .filter(m => m.r >= 0).sort((a, b) => a.r - b.r || a.i - b.i).map(m => m.x)
        : grp.opts;
      for (const x of grp.opts) x.node.hidden = true;
      for (const x of matched) { x.node.hidden = false; grp.node.append(x.node); }
      grp.node.hidden = matched.length === 0;
      visible.push(...matched);
    }
    empty.hidden = visible.length > 0;
  }

  function setActive(x: Opt | null, scroll = false): void {
    if (active) {
      active.node.classList.remove('is-active');
      if (!multiple) active.node.setAttribute('aria-selected', 'false');
    }
    active = x;
    if (x) {
      x.node.classList.add('is-active');
      if (!multiple) x.node.setAttribute('aria-selected', 'true');
      input.setAttribute('aria-activedescendant', x.node.id);
      if (scroll) x.node.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function show(q: string, cursor?: Opt): void {
    filter(q);
    pop.hidden = false; open = true;
    wrap.dataset.open = 'true';
    input.setAttribute('aria-expanded', 'true');
    const cur = cursor && visible.includes(cursor) ? cursor
      : !multiple && q.trim() === '' ? visible.find(x => chosen.has(x))
      : undefined;
    setActive(cur ?? visible[0] ?? null, true);
  }

  /* closed + focused = search mode (empty, placeholder showing);
     closed + blurred = display mode (single: current choice; multi: tokens) */
  function hide(): void {
    pop.hidden = true; open = false;
    wrap.dataset.open = 'false';
    input.setAttribute('aria-expanded', 'false');
    setActive(null);
    input.value = !multiple && !focused() ? currentLabel() : '';
  }

  function pick(x: Opt): void {
    if (multiple) {
      if (chosen.has(x)) chosen.delete(x);
      else { chosen.add(x); lifted = []; }
      syncChosen();
      input.value = '';
      if (chosen.size < min) {
        // below the floor: hold the token aside and ask for a replacement
        lifted.push(x);
        if (focused()) show(''); else input.focus();
        return;
      }
      if (open || focused()) show('', x);
      o.onChange?.(values());
    } else {
      chosen.clear(); chosen.add(x);
      syncChosen();
      input.blur();
      o.onChoose?.(x.value);
    }
  }

  input.addEventListener('focus', () => { if (!multiple) input.value = ''; show(''); });
  input.addEventListener('blur', () => {
    if (chosen.size < min && lifted.length) {
      for (const x of lifted) chosen.add(x);
      lifted = [];
      syncChosen();
    }
    hide();
    if (!multiple) input.value = currentLabel();
  });
  input.addEventListener('input', () => show(input.value));
  input.addEventListener('keydown', e => {
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault();
        if (!open) { show(input.value); return; }
        if (!visible.length) return;
        const i = active ? visible.indexOf(active) : -1;
        const n = e.key === 'ArrowDown' ? Math.min(i + 1, visible.length - 1) : Math.max(i - 1, 0);
        setActive(visible[n], true);
        break;
      }
      case 'Enter':
        if (open && active) { e.preventDefault(); pick(active); }
        break;
      case 'Escape':
        if (open) { e.preventDefault(); hide(); }
        break;
      case 'Tab':
        if (open) hide();
        break;
      case 'Backspace':
        if (multiple && input.value === '') {
          const last = [...chosen].pop();
          if (last) pick(last);
        }
        break;
    }
  });

  /* clicks in the popup or on the field's chrome must not blur the input */
  pop.addEventListener('mousedown', e => e.preventDefault());
  field.addEventListener('mousedown', e => { if (e.target !== input) e.preventDefault(); });
  field.addEventListener('click', e => {
    const t = e.target as HTMLElement;
    if (t.closest('.combo-token-x')) return;
    if (t.closest('.combo-toggle')) {
      if (open) hide();
      else if (focused()) show('');
      else input.focus();
      return;
    }
    if (!focused()) input.focus();
    else if (!open) show(input.value);
  });

  syncChosen();
  select.replaceWith(wrap);

  return {
    el: wrap,
    values,
    setValues(v) {
      chosen.clear();
      lifted = [];
      for (const value of v) {
        const x = opts.find(y => y.value === value);
        if (x) chosen.add(x);
      }
      syncChosen();
    },
  };
}
