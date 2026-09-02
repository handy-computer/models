/* Tiny DOM helpers for the client-side chart and set-view code. */

export type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;
export type Child = Node | string | null | undefined | false;

function apply(n: Element, attrs: Attrs | null | undefined, children: Child[], svg: boolean): void {
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'text') n.textContent = String(v);
      else if (k === 'class' && !svg) (n as HTMLElement).className = String(v);
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children) if (c != null && c !== false) n.append(c);
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  apply(n, attrs, children, false);
  return n;
}

export function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): SVGElementTagNameMap[K] {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  apply(n, attrs, children, true);
  return n;
}
