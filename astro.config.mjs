// @ts-check
import { defineConfig } from 'astro/config';

// Every page is pre-rendered at build time from wer.db (see src/lib/db.ts)
// and deployed as Cloudflare Workers static assets (wrangler.jsonc).
export default defineConfig({
  // Public URL; canonical and og:url are built from it (see Layout.astro).
  // Keep in step with SITE_URL in src/lib/config.ts and wrangler.jsonc.
  site: 'https://models.handy.computer',
  output: 'static',
  // The shared stylesheet is small. Keeping it in the HTML removes a second
  // network round trip and guarantees the first paint is already styled.
  build: {
    inlineStylesheets: 'always',
  },
  // Astro 7 defaults to JSX-style whitespace stripping; the markup here was
  // ported from hand-written HTML/DOM code that relies on HTML whitespace
  // rules (e.g. "<strong>license: </strong> apache-2.0").
  compressHTML: true,
});
