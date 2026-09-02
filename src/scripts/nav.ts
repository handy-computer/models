/* Select enhancement on every page (see combobox.ts):
     <select data-nav>          option values are URLs; choosing navigates
     <select data-set="nav">    a set picker (languages, models) on a static
                                page; any change navigates to the set's URL
                                under data-set-base. A ?langs= focus on the
                                current page carries over.
   The set islands own their own pickers (data-set="island") and the model
   pages their language focus (data-set="filter"), so changes there render
   in place. */
import { enhanceCombobox } from './combobox';
import { setUrl, withLangs, parseList } from '../lib/routes';

export function initNav(root: ParentNode = document): void {
  for (const sel of root.querySelectorAll<HTMLSelectElement>('select[data-nav]')) {
    enhanceCombobox(sel, { onChoose: href => { location.href = href; } });
  }
  for (const sel of root.querySelectorAll<HTMLSelectElement>('select[data-set="nav"]')) {
    const base = sel.dataset.setBase ?? '';
    enhanceCombobox(sel, { multiple: true, min: 1, onChange: values => {
      const langs = parseList(new URLSearchParams(location.search), 'langs');
      location.href = withLangs(setUrl(base, values), langs);
    } });
  }
}
