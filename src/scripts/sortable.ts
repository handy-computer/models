/* Progressive enhancement for tables rendered as:
     <table class="data" data-sortable data-default-sort="err" data-default-desc="false">
       <thead><tr><th data-key="err" class="num"><button type="button">label</button></th>…
       <tbody><tr><td data-sort="12.3">…
   Rows are pre-sorted on the server; this re-applies the same sort (a no-op)
   and wires the header buttons. Nulls (empty data-sort) sort last either way. */

const NUM = /^-?\d+(\.\d+)?(e[-+]?\d+)?$/i;
type SortVal = number | string | null;

function valueOf(td: HTMLTableCellElement | undefined): SortVal {
  const s = td?.dataset.sort;
  if (s === undefined || s === '') return null;
  return NUM.test(s) ? Number(s) : s;
}

export function enhanceSortable(table: HTMLTableElement): void {
  if (table.dataset.sortableBound) return;
  table.dataset.sortableBound = '1';
  const thead = table.tHead, tbody = table.tBodies[0];
  if (!thead || !tbody) return;
  const ths = [...(thead.rows[0]?.cells ?? [])];
  const state = { key: table.dataset.defaultSort || null, desc: table.dataset.defaultDesc === 'true' };

  const applySort = () => {
    const idx = ths.findIndex(th => th.dataset.key === state.key);
    if (idx >= 0) {
      const rows = [...tbody.rows];
      rows.sort((a, b) => {
        const av = valueOf(a.cells[idx]), bv = valueOf(b.cells[idx]);
        const an = av == null, bn = bv == null;
        if (an && bn) return 0;
        if (an) return 1;   // nulls last regardless of direction
        if (bn) return -1;
        const cmp = typeof av === 'number' && typeof bv === 'number'
          ? av - bv : String(av).localeCompare(String(bv));
        return state.desc ? -cmp : cmp;
      });
      tbody.append(...rows);
    }
    for (const th of ths) {
      th.removeAttribute('aria-sort');
      if (th.dataset.key === state.key) th.setAttribute('aria-sort', state.desc ? 'descending' : 'ascending');
    }
  };

  for (const th of ths) {
    const key = th.dataset.key;
    const btn = th.querySelector('button');
    if (!key || !btn) continue;
    btn.addEventListener('click', () => {
      if (state.key === key) state.desc = !state.desc;
      else { state.key = key; state.desc = false; }
      applySort();
    });
  }
  applySort();
}

export function initSortable(root: ParentNode = document): void {
  root.querySelectorAll<HTMLTableElement>('table[data-sortable]').forEach(enhanceSortable);
}
