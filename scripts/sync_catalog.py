#!/usr/bin/env python3
"""sync_catalog.py — refresh wer.db from a transcribe.cpp checkout's catalog/.

The old pipeline (transcribe.cpp scripts/wer/build_db.py) was deleted upstream;
the catalog/*.json files are now self-contained: claims, capabilities, quants,
FLEURS accuracy cells, and per-rig speed tables all ship in one JSON per model.
This script is the site's new ingestion point. It is additive and idempotent:

  - models / claims / quants: upserted from the catalog (source of truth)
  - perf: fully rebuilt from the catalog's speed_benchmarks so every model on
    the site is measured on the engine builds transcribe.cpp currently publishes
  - results (FLEURS test cells): inserted when missing; an existing cell whose
    value changed is reported, never silently overwritten

Usage: python3 scripts/sync_catalog.py [path-to-transcribe.cpp] [--apply]
Without --apply it only reports what would change.
"""
from __future__ import annotations

import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
TRANSCRIBE = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 and not sys.argv[1].startswith('-') \
    else REPO.parent / 'transcribe.cpp'
CATALOG = TRANSCRIBE / 'catalog'
DB = REPO / 'wer.db'
APPLY = '--apply' in sys.argv

# Catalog entries that are not speech-to-text models on the site.
SKIP = {
    '_schema', '_benchmark_profiles',
    'diar_streaming_sortformer_4spk-v2.1',  # diarizer, no ASR transcription
    'lang-id-voxlingua107-ecapa',           # language id
    'silero-vad-v6.2',                      # VAD
}

sys.path.insert(0, str(TRANSCRIBE / 'scripts' / 'wer'))
from languages import FLEURS_LANGS  # noqa: E402  (stdlib-only module)

# Claimed-code normalization, matching how the DB already stores claims
# (lowercase base subtag; aliases join in model_languages_canonical).
CLAIM_ALIASES = {'jw': 'jv', 'tl': 'fil', 'no': 'nb', 'zh-cn': 'zh'}

# Language rows the catalog needs but the DB does not have yet
# (name/script from transcribe.cpp's old scripts/wer/languages.py).
NEW_LANGUAGES = {'jv': ('Javanese', 'Latn')}


def db_name(catalog_base: str, existing: dict[str, str]) -> str:
    """DB primary key for a catalog entry. Existing models keep their DB
    spelling (Breeze-ASR-25, SenseVoiceSmall, ...) — match case-insensitively;
    genuinely new models take the catalog file base."""
    return existing.get(catalog_base.lower().replace('-', '').replace('_', ''), catalog_base)


def norm_claim(code: str) -> str:
    """Lowercase base subtag with the dataset aliases applied:
    en-US -> en, zh-CN -> zh, no -> nb, tl -> fil, jw -> jv."""
    c = code.strip().lower()
    if c in CLAIM_ALIASES:
        return CLAIM_ALIASES[c]
    base = c.split('-')[0]
    return CLAIM_ALIASES.get(base, base)


def main() -> None:
    db = sqlite3.connect(DB)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys = ON')

    langs_in_db = {r[0] for r in db.execute('SELECT lang FROM languages')}
    existing_models = {r[0] for r in db.execute('SELECT model FROM models')}
    existing_by_lower = {m.lower().replace('-', '').replace('_', ''): m for m in existing_models}

    entries = []
    for p in sorted(CATALOG.glob('*.json')):
        if p.stem in SKIP:
            continue
        d = json.loads(p.read_text())
        entries.append((p.stem, db_name(p.stem, existing_by_lower), d))
    existing_cells = {}
    for r in db.execute("""SELECT r.model, r.dataset, r.quant, r.err_pct FROM results r
                           JOIN datasets d ON d.dataset = r.dataset WHERE d.source='fleurs'"""):
        existing_cells[(r[0], r[1], r[2])] = r[3]

    stats = dict(models_new=0, claims_new=0, cells_new=0, cells_conflict=0,
                 perf_rows=0, quants_rows=0, langs_new=0)
    conflicts = []

    def ensure_language(code: str) -> None:
        if code in langs_in_db:
            return
        if code not in NEW_LANGUAGES:
            raise SystemExit(f'missing language row for {code!r}; add to NEW_LANGUAGES')
        name, script = NEW_LANGUAGES[code]
        if APPLY:
            db.execute('INSERT INTO languages(lang, name, script) VALUES (?,?,?)', (code, name, script))
        langs_in_db.add(code)
        stats['langs_new'] += 1

    def ensure_dataset(lang: str) -> str:
        ds = f'fleurs-{lang}'
        config = FLEURS_LANGS.get(lang)
        if config is None:
            raise SystemExit(f'no FLEURS config for {lang!r}')
        if APPLY:
            db.execute('INSERT OR IGNORE INTO datasets(dataset, source, config, lang) VALUES (?,?,?,?)',
                       (ds, 'fleurs', config, lang))
        return ds

    for base, model, d in entries:
        caps = d['capabilities']
        ts = caps.get('timestamps') or {}
        timestamps = (ts.get('granularities') or ['none'])[0] if ts.get('supported') else 'none'
        lic = d.get('license') or {}
        row = (model, d['family'], d['params'] / 1e6, lic.get('spdx'), lic.get('display'),
               d.get('upstream_repo'), d.get('upstream_commit'),
               int(bool(caps.get('streaming', {}).get('supported'))),
               int(bool(caps.get('translate', {}).get('supported'))),
               int(bool(caps.get('lang_detect', {}).get('supported'))),
               int(bool(caps.get('diarize', {}).get('supported'))),
               timestamps)
        if model not in existing_models:
            stats['models_new'] += 1
            print(f'+ model {model} (family={d["family"]}, {d["params"]/1e6:.0f}M)')
        if APPLY:
            db.execute("""INSERT INTO models(model, family, params_m, license, license_display,
                            upstream_repo, upstream_commit, streaming, translate, lang_detect,
                            diarize, timestamps)
                          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                          ON CONFLICT(model) DO UPDATE SET
                            family=excluded.family, params_m=excluded.params_m,
                            license=excluded.license, license_display=excluded.license_display,
                            upstream_repo=excluded.upstream_repo,
                            upstream_commit=excluded.upstream_commit,
                            streaming=excluded.streaming, translate=excluded.translate,
                            lang_detect=excluded.lang_detect, diarize=excluded.diarize,
                            timestamps=excluded.timestamps""", row)

        # Claims: add missing (model, lang) pairs, keep existing rows as-is.
        have_claims = {r[0] for r in db.execute('SELECT lang FROM model_languages WHERE model=?', (model,))} \
            if model in existing_models else set()
        for code in d.get('languages') or []:
            c = norm_claim(code)
            ensure_language(c)
            if c not in have_claims:
                stats['claims_new'] += 1
                if APPLY:
                    db.execute('INSERT OR IGNORE INTO model_languages(model, lang) VALUES (?,?)', (model, c))

        # Quants: the catalog download list is the published truth; rebuild.
        quants = [(model, q['quant'], q['filename'], round(q['size_bytes'] / 2**30, 4))
                  for q in d.get('downloads') or []]
        stats['quants_rows'] += len(quants)
        if APPLY and quants:
            db.execute('DELETE FROM quants WHERE model=?', (model,))
            db.executemany('INSERT INTO quants(model, quant, filename, size_gb) VALUES (?,?,?,?)', quants)

        # Perf: same story — rebuild per model from the published tables.
        perf = []
        for s in d.get('speed_benchmarks') or []:
            rig = s['machine']
            if rig not in ('m4', 'm4-max', 'ryzen-4750u'):
                raise SystemExit(f'unknown rig {rig!r} in {base}')
            perf.append((model, rig, s['backend'], s['quant'], s['sample'],
                         round(s['sample_duration_s'], 1), s['xrt_compute'], model))
        stats['perf_rows'] += len(perf)
        if APPLY:
            db.execute('DELETE FROM perf WHERE model=?', (model,))
            db.executemany("""INSERT INTO perf(model, rig, backend, quant, sample, sample_s, xrt, measured_on)
                              VALUES (?,?,?,?,?,?,?,?)""", perf)

        # Accuracy: FLEURS test cells only, matching the site's scope. Insert
        # new cells; never overwrite an existing one, but report drift.
        for b in d.get('accuracy_benchmarks') or []:
            if b['dataset'] != 'fleurs' or b.get('split') != 'test':
                continue
            lang = norm_claim(b['language'])
            ensure_language(lang)
            ds = ensure_dataset(lang)
            key = (model, ds, b['quant'])
            if key in existing_cells:
                if abs(existing_cells[key] - b['err_pct']) > 1e-9:
                    stats['cells_conflict'] += 1
                    conflicts.append((model, ds, b['quant'], existing_cells[key], b['err_pct']))
                continue
            stats['cells_new'] += 1
            if APPLY:
                db.execute("""INSERT INTO results(dataset, model, quant, metric, err_pct,
                                ci_lo, ci_hi, n_utts, note)
                              VALUES (?,?,?,?,?,?,?,?,NULL)""",
                           (ds, model, b['quant'], b['metric'], b['err_pct'],
                            b['ci95'][0], b['ci95'][1], b['n_utts']))

    if APPLY:
        db.execute('UPDATE meta SET value=? WHERE key=\'generated\'',
                   (datetime.now(timezone.utc).isoformat(timespec='seconds'),))
        db.execute("UPDATE meta SET value=? WHERE key='rebuild'",
                   ('python3 scripts/sync_catalog.py [transcribe.cpp checkout] --apply',))
        db.commit()

    print('\n' + ('APPLIED' if APPLY else 'DRY RUN') + f' against {CATALOG}')
    for k, v in stats.items():
        print(f'  {k}: {v}')
    if conflicts:
        print('  conflicts (kept old value):')
        for c in conflicts:
            print('   ', c)
    db.close()


if __name__ == '__main__':
    main()
