/* DOM-built sortable table for the set island, whose columns depend on the
   chosen language set. Emits the same markup contract as the server-rendered
   tables and hands off to sortable.ts. */

import { el } from './dom';
import { enhanceSortable } from './sortable';

export interface Col<R> {
  key: string;
  label: string;
  num?: boolean;
  title?: string;
  sortVal: (row: R) => number | string | null;
  render: (row: R) => Node | string | null | undefined;
  tdClass?: (row: R) => string[];
}

export function makeTable<R extends { _partial?: boolean; _pick?: boolean; _frontier?: boolean }>(opts: {
  cols: Col<R>[]; rows: R[]; defaultSort: string; defaultDesc?: boolean;
}): HTMLElement {
  const { cols, rows, defaultSort, defaultDesc = false } = opts;
  const wrap = el('div', { class: 'table-wrap' });
  const table = el('table', {
    class: 'data', 'data-sortable': '',
    'data-default-sort': defaultSort, 'data-default-desc': String(defaultDesc),
  });
  const thead = el('thead'), tbody = el('tbody');

  const hr = el('tr');
  for (const c of cols) {
    const th = el('th', { class: c.num ? 'num' : null, title: c.title ?? null, 'data-key': c.key });
    th.append(el('button', { type: 'button', text: c.label }));
    hr.append(th);
  }
  thead.append(hr);

  for (const row of rows) {
    const cls = [row._partial ? 'partial' : '', row._pick ? 'is-pick' : '', row._frontier ? 'is-frontier' : ''].filter(Boolean).join(' ');
    const tr = el('tr', { class: cls || null });
    for (const c of cols) {
      const sv = c.sortVal(row);
      const td = el('td', { class: c.num ? 'num' : null, 'data-sort': sv == null ? '' : String(sv) });
      const out = c.render(row);
      if (out != null) td.append(out);
      if (c.tdClass) td.classList.add(...c.tdClass(row));
      tr.append(td);
    }
    tbody.append(tr);
  }

  table.append(thead, tbody);
  wrap.append(table);
  enhanceSortable(table);
  return wrap;
}
