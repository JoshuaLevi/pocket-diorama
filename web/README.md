# The world site

`https://pocket-diorama.vercel.app`: where a player turns their own cartridge into
a world for the lens, without the cartridge ever leaving their machine.

## What it does

1. The visitor drops a dump of their Pokemon Red, Blue or Yellow (USA, Europe) cartridge on the page.
2. The page hashes it (SHA-1 must be `ea9bcae6...`), fetches Red's symbol manifest,
   and runs **the lens's own extractor** in a Web Worker: `Assets/Scripts/rom/*` and
   `Assets/Scripts/audio/*`, bundled straight from the repository by `build.mjs`.
   There is no second extractor to drift.
3. The baked bundle (about 1.7 MB of JSON, the same file the lens caches) is POSTed to
   `/api/upload`, which files it in a **private** Vercel Blob store under a hash of a
   fresh six-character code and answers with the code.
4. The visitor types the code into the lens. The lens fetches `/api/bundle/<code>`
   over https, checks `X-Bundle-Length`, and keeps the bundle in persistent storage.
   The site is never asked again.
5. A code lasts one day. `/api/bundle` refuses and deletes an expired one on sight;
   `/api/cleanup` (Vercel Cron, daily, `CRON_SECRET`) sweeps the ones nobody asked for.

What never reaches the server: the cartridge. What the server holds: a derived data
file, privately, for a day, that nobody can fetch without the code, and the code is
not stored beside it (the pathname is a SHA-256 of it).

## Layout

| | |
|---|---|
| `src/app.ts` | The bake flow: drop zone, hash check, worker, upload, the code |
| `src/site.ts` | The page's motion: reveals, parallax, the film player, the code's letters. Never touches the cartridge |
| `src/extract.worker.ts` | The bake: `extractFromRom`, the cry and audio banks, `bundleFromExtraction` |
| `public/index.html`, `public/style.css` | The page (28 September redesign: dark, the film in the hero and as a player, the tool below the story) |
| `public/media/` | The hero loop, the film, posters, the plate and the icon, generated from `tools/reel`; deployed from disk, not committed |
| `test/page.test.mjs` | The page keeps every id `app.ts` asks for, loads only its own scripts, and its media exist |
| `lib/codes.js` | The alphabet (the lens's: no I, O, 0, 1), minting, pathnames, the bundle check |
| `api/upload.js`, `api/bundle/[code].js`, `api/cleanup.js` | The three routes, Web-handler style |
| `build.mjs` | esbuild: `public/app.js`, `public/extract.worker.js`, and Red's manifest copied in |
| `test/` | `node --test test/*.test.mjs` |

## Deploying

```sh
npm ci
npm test
vercel build --prod
vercel deploy --prebuilt --prod
```

The project is `pocket-diorama` on Vercel with a private Blob store,
`pocket-diorama-bundles`, in `fra1`. `vercel link` once on a new machine. Nothing
in `public/` is committed except the page and its stylesheet; the three scripts
and the manifests are built, and `public/media/` is copied in:

```sh
R=../tools/reel/out/pocket-diorama-reel.mp4
ffmpeg -ss 8 -t 12 -i $R -an -vf scale=1280:720 -c:v libx264 -crf 27 -movflags +faststart public/media/hero-loop.mp4
ffmpeg -ss 8.5 -i $R -frames:v 1 -vf scale=1280:720 public/media/hero-poster.jpg
cp ../tools/reel/out/pocket-diorama-reel-web.mp4 public/media/reel.mp4
ffmpeg -ss 6.5 -i $R -frames:v 1 public/media/reel-poster.jpg
# plate.png from tools/reel/public/render/pallet-turn/f040.png at 1400 px wide;
# icon.png (512) and favicon.png (64) from docs/listing/icon-1024.png
```

`node --test test/*.test.mjs` fails if any of them is missing.
