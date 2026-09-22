// Render the IskAI mark into the deck's motif render set, as an alternative to orb.py.
//
//   node docs/deck/logo_motif.mjs                 # -> tmp/deck/renders/light-logo/
//   node docs/deck/logo_motif.mjs --theme dark
//
// Why Playwright rather than upscaling public/isu-thesis-ai-mark.png: that raster is
// 512 x 512, and the title slide places the motif 7 inches wide. Upscaled it is visibly
// soft on a projector. The source is a 64-unit SVG, so Chromium rasterises it at whatever
// size we ask for and it stays crisp.
//
// Filenames deliberately match orb.py's outputs (orb_000/040/080, orb_converged,
// orb_turntable, glow) so build.py can swap the whole motif by pointing RENDERS at this
// directory -- no per-slide geometry changes, and the `!!orb` shape names that drive the
// Morph transitions keep working untouched.

import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const FRONTEND = join(ROOT, 'rag-thesis-frontend')
const MARK = join(FRONTEND, 'public', 'isu-thesis-ai-mark.svg')

// Playwright lives in the frontend's node_modules; there is none at the repo root.
// capture.mjs resolves it the same way, so both drivers share one install.
const require = createRequire(join(FRONTEND, 'package.json'))
const { chromium } = require('@playwright/test')

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : args[i + 1]
}
const THEME = opt('theme', 'light')
const OUT = join(ROOT, 'tmp', 'deck', 'renders', `${THEME}-logo`)

// The mark's own greens, read from the SVG rather than restated here.
const SVG = readFileSync(MARK, 'utf8')
const GREEN_DARK = '#046A38'
const GREEN_BRIGHT = '#10B96C'

const SIZE = 2048          // square canvas for every still
const GIF_SIZE = 900       // the animated still is placed at 7in; 900 is ample and keeps the GIF small
const GIF_FRAMES = 36

// The mark's gold accents: the four-point star and the two page dots.
const GOLD_FILLS = ['#F2A900', '#FFC72C']

/** A page containing the mark, centred, on transparency, with an optional glow behind it.
 *
 * `mono` drops the gold accents and flattens both greens to one tone. It exists for the
 * large background bleeds: at the 15% opacity build.py places them with, the gold star
 * casts a warm band across the glass cards sitting on top, which read as discoloured
 * rather than tinted. A single-tone green silhouette stays on brand and stays neutral.
 */
function pageHtml({ size, glow, scale = 0.72, rotate = 0, lift = 0, shiftX = 0, mono = false, markless = false }) {
  const glowLayer = glow ? '<div class="glow"></div>' : ''
  const markLayer = markless ? '' : `<div class="mark">${SVG}</div>`
  const monoRules = mono
    ? `${GOLD_FILLS.map((c) => `.mark [fill="${c}"]`).join(',')}{display:none}
       .mark [fill="${GREEN_DARK}"],.mark [fill="${GREEN_BRIGHT}"]{fill:${GREEN_BRIGHT}}`
    : ''
  return `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;width:${size}px;height:${size}px;background:transparent;overflow:hidden}
    .stage{position:relative;width:${size}px;height:${size}px;display:grid;place-items:center}
    .glow{position:absolute;inset:0;background:
      radial-gradient(closest-side, ${GREEN_BRIGHT}55, ${GREEN_DARK}22 55%, transparent 72%);}
    .mark{width:${Math.round(size * scale)}px;height:${Math.round(size * scale)}px;
      transform:translateX(${shiftX}px) translateY(${lift}px) rotate(${rotate}deg);
      filter:${mono ? 'none' : `drop-shadow(0 ${Math.round(size * 0.012)}px ${Math.round(size * 0.03)}px rgba(4,106,56,.28))`};}
    .mark svg{width:100%;height:100%;display:block}
    ${monoRules}
  </style><div class="stage">${glowLayer}${markLayer}</div>`
}

async function shoot(page, html, size, out) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(html)
  await page.waitForTimeout(40)
  await page.screenshot({ path: out, omitBackground: true })
  return out
}

/** A minimal GIF89a encoder is overkill; assemble frames with a tiny LZW-free approach
 *  is not possible, so the turntable is written as an animated WebP-free GIF via PNG
 *  frames handed to Pillow in logo_motif.py. Here we only emit the frames. */
async function frames(page, dir) {
  mkdirSync(dir, { recursive: true })
  const written = []
  for (let i = 0; i < GIF_FRAMES; i += 1) {
    const t = i / GIF_FRAMES
    // A gentle breathing scale plus a few degrees of sway. A full spin on a flat
    // book mark reads as a glitch rather than motion, so this stays subtle.
    const scale = 0.68 + 0.035 * Math.sin(t * Math.PI * 2)
    const rotate = 2.4 * Math.sin(t * Math.PI * 2)
    const lift = Math.round(GIF_SIZE * 0.012 * Math.cos(t * Math.PI * 2))
    const out = join(dir, `frame_${String(i).padStart(2, '0')}.png`)
    await shoot(page, pageHtml({ size: GIF_SIZE, glow: true, scale, rotate, lift }), GIF_SIZE, out)
    written.push(out)
  }
  return written
}

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 })
  mkdirSync(OUT, { recursive: true })

  // The three "rotation" stills the orb motif provides. For the logo the useful
  // variation is scale and glow, not angle: 000 is the clean mark, 040 is the large
  // off-canvas bleed on slide 2, 080 is the full-bleed watermark on slide 3 (placed at
  // 15% opacity by build.py, so it must stay legible when nearly transparent).
  // 000 and converged are hero placements: full colour, glow, drop shadow.
  await shoot(page, pageHtml({ size: SIZE, glow: true, scale: 0.72 }), SIZE, join(OUT, 'orb_000.png'))

  // The closing slide is the one placement that must NOT carry the mark. build.py centres
  // `orb_converged` on the slide behind a node ring, the ISU seal and four lines of text;
  // the orb version is a delicate constellation, but a solid book at that size covered the
  // "System thesis defended" headline outright. A halo keeps the green wash and the `!!orb`
  // shape the Morph plan needs, and leaves the text legible.
  await shoot(
    page,
    pageHtml({ size: SIZE, glow: true, markless: true }),
    SIZE, join(OUT, 'orb_converged.png'),
  )

  // 040 is slide 2's bleed: build.py places it at x=-4.6in, 10.5in wide, so only the
  // right ~56% of the canvas lands on the slide. Shifting the mark right and shrinking
  // it puts the whole book in the visible band instead of an arbitrary crop.
  await shoot(
    page,
    pageHtml({ size: SIZE, glow: true, scale: 0.46, shiftX: Math.round(SIZE * 0.2), mono: true }),
    SIZE, join(OUT, 'orb_040.png'),
  )
  // 080 is slide 3's full-bleed watermark under the glass cards.
  await shoot(page, pageHtml({ size: SIZE, glow: false, scale: 0.92, mono: true }), SIZE, join(OUT, 'orb_080.png'))

  // build.py places glow.png as a soft backdrop; give it the mark's own green, no mark.
  await shoot(
    page,
    `<!doctype html><meta charset="utf-8"><style>
      html,body{margin:0;width:${SIZE}px;height:${SIZE}px;background:transparent}
      .g{width:${SIZE}px;height:${SIZE}px;background:
        radial-gradient(closest-side, ${GREEN_BRIGHT}66, ${GREEN_DARK}2b 55%, transparent 73%)}
    </style><div class="g"></div>`,
    SIZE, join(OUT, 'glow.png'),
  )

  const frameDir = join(OUT, '_frames')
  rmSync(frameDir, { recursive: true, force: true })
  const written = await frames(page, frameDir)
  writeFileSync(join(OUT, '_frames.json'), `${JSON.stringify(written, null, 2)}\n`)

  console.log(`wrote ${OUT}`)
  console.log(`  stills: orb_000, orb_040, orb_080, orb_converged, glow (${SIZE}px)`)
  console.log(`  ${written.length} gif frames at ${GIF_SIZE}px -> assemble with logo_motif.py`)
} finally {
  await browser.close()
}
