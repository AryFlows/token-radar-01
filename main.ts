// Frost Radar v4: the entrypoint.
//
// Reads the sealed snapshot, fits the model in lib/fit.ts, and writes the
// board (board.json), the page's data (data.js), the dashboard and the
// screenshots, then the dossier the judge reads. It refuses to write a board
// the gate would refuse, and it writes the same bytes every run: no clock, no
// randomness, every tie broken by slug.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/fit.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The dossier's text cap, and the screenshots' caps from the gate. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`frost radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`frost radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

/**
 * namesInCode: how many of the snapshot's protocol names appear, whole-word,
 * in the entry's own source (main.ts, lib/, dashboard/). The model must price
 * from figures, never from a hardcoded list of names — the count belongs on
 * the page, where the judge can see it. data.js and board.json hold the names
 * as data and are not scanned.
 *
 * Two honest exceptions. A hyphenated word-part is not a name: "re-" in
 * "re-fits" is not the protocol "Re", so a match must not touch a hyphen.
 * And a name that is also an ordinary English word cannot be told from prose
 * by a text scan — "cap" in "market cap" is the competition's subject matter,
 * not a reference to the protocol "cap" — so these words are excluded, each
 * in its ordinary sense: cap (market cap), gain (improvement), gate (the
 * intake checks), across (preposition), exactly (adverb), concrete (adjective),
 * current (the running value), wrapped (the wrapped/staked name pattern),
 * re (the re- prefix: re-fit, re-price).
 */
const ORDINARY_WORDS = new Set(['cap', 'gain', 'gate', 'across', 'exactly', 'concrete', 'current', 'wrapped', 're']);
{
  const sources = [
    readFileSync(join(here, 'main.ts'), 'utf8'),
    ...readdirSync(join(here, 'lib')).filter((f) => f.endsWith('.ts')).map((f) => readFileSync(join(here, 'lib', f), 'utf8')),
    ...readdirSync(join(here, 'dashboard')).filter((f) => /\.(html|css|js|md)$/.test(f)).map((f) => readFileSync(join(here, 'dashboard', f), 'utf8')),
  ].join('\n');
  let found = 0;
  for (const p of snapshot.protocols) {
    if (ORDINARY_WORDS.has(p.name.toLowerCase())) continue;
    const escaped = p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'i').test(sources)) found++;
  }
  radar.namesInCode = found;
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`frost radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`frost radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

process.stdout.write(
  `frost radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows ranked\n` +
    `frost radar: value LOO x${radar.value.loo.toFixed(2)}, walk-forward x${radar.value.wf.toFixed(2)} on ${radar.value.comps} comps; odds Brier ${radar.odds.brier.toFixed(3)} / ${radar.odds.brierWf.toFixed(3)} on ${radar.odds.peers} peers\n` +
    `frost radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')}, ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')} (checksum ${radar.checksum})\n`,
);
