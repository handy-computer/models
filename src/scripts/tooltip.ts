/* One shared tooltip (#tooltip in the layout). Charts call attachTip()
   directly; server-rendered markup opts in with a data-tip JSON attribute:
     data-tip='{"t":"title","r":[["label","value"],...]}' */

import { el } from './dom';

export type TipRows = [string, string][];

let tipEl: HTMLElement | null = null;
const tip = (): HTMLElement => (tipEl ??= document.getElementById('tooltip') as HTMLElement);

export function tipShow(title: string, rows: TipRows): void {
  const t = tip();
  t.replaceChildren();
  if (title) t.append(el('span', { class: 't-title', text: title }));
  for (const [lbl, val] of rows) {
    t.append(el('span', { class: 't-row' },
      el('span', { class: 'lbl', text: lbl }),
      el('span', { class: 'val', text: val })));
  }
  t.hidden = false;
}

export function tipMove(ev: MouseEvent): void {
  const t = tip();
  const pad = 14;
  const r = t.getBoundingClientRect();
  let x = ev.clientX + pad, y = ev.clientY + pad;
  if (x + r.width > window.innerWidth - 8) x = ev.clientX - r.width - pad;
  if (y + r.height > window.innerHeight - 8) y = ev.clientY - r.height - pad;
  t.style.left = x + 'px';
  t.style.top = y + 'px';
}

export function tipMoveToRect(node: Element): void {
  const t = tip();
  const r = node.getBoundingClientRect();
  t.style.left = Math.min(r.right + 10, window.innerWidth - 260) + 'px';
  t.style.top = (r.top - 8) + 'px';
}

export function tipHide(): void { tip().hidden = true; }

export function attachTip(node: Element, makeContent: () => void): void {
  node.addEventListener('pointerenter', ev => { makeContent(); tipMove(ev as PointerEvent); });
  node.addEventListener('pointermove', ev => tipMove(ev as PointerEvent));
  node.addEventListener('pointerleave', tipHide);
  node.addEventListener('focus', () => { makeContent(); tipMoveToRect(node); });
  node.addEventListener('blur', tipHide);
}

interface TipData { t?: string; r: TipRows }

export function initTooltips(root: ParentNode = document): void {
  for (const node of root.querySelectorAll<HTMLElement>('[data-tip]')) {
    if (node.dataset.tipBound) continue;
    node.dataset.tipBound = '1';
    let parsed: TipData;
    try { parsed = JSON.parse(node.dataset.tip || '{}') as TipData; } catch { continue; }
    attachTip(node, () => tipShow(parsed.t ?? '', parsed.r ?? []));
  }
}
