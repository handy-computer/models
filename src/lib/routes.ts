/* URL scheme for the set views (languages and models). One item is a static
   page; a set of two or more is the client-rendered island at
   <base>?set=a,b,c. The model views take an optional language focus as
   ?langs=de,fr. Shared by the pickers (nav.ts) and the set islands. */

export const setUrl = (base: string, values: string[]): string =>
  values.length === 1
    ? `${base}/${encodeURIComponent(values[0])}`
    : `${base}?set=${values.map(encodeURIComponent).join(',')}`;

/** append ?langs=de,fr (or &langs=) when there is a language focus */
export function withLangs(url: string, langs: string[]): string {
  if (!langs.length) return url;
  return `${url}${url.includes('?') ? '&' : '?'}langs=${langs.map(encodeURIComponent).join(',')}`;
}

/** ?key=a,b or ?key=a&key=b → ['a', 'b'], deduped, order kept */
export function parseList(params: URLSearchParams, key: string): string[] {
  const out: string[] = [];
  for (const raw of params.getAll(key)) {
    for (const c of raw.split(',')) {
      const code = c.trim();
      if (code && !out.includes(code)) out.push(code);
    }
  }
  return out;
}

export const parseSet = (params: URLSearchParams): string[] => parseList(params, 'set');
