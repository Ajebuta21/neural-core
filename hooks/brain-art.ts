import type { Brain, Mode, Region, Vitals } from '../types'

// A holographic brain in amber: a particle mesh in a side-view silhouette,
// folds, ember hubs with filaments down to a dotted floor, drifting bokeh.
// Every SMIL animation is indefinite with a negative begin, so a redraw lands
// mid-motion and the scene never looks like it restarted.
//
// The panel draws it in a script-less frame, so the pointer is answered with
// CSS and SMIL alone: a grid of invisible cells sits over the scene, each
// with a glow that lights under the cursor and fades behind it, a bloom on
// click, and, for cells over a lobe, a highlight and label (`~` reaches the
// lobe's highlight group, a later sibling) and a shockwave on click.

type P = { x: number; y: number }
type Lobe = Exclude<Region, 'core'>

const W = 480
const H = 400
const C: P = { x: 235, y: 165 }
const CELL = 40
const AMBER = '#ff7a1a'
const EMBER = '#ff9a2e'
const PALE = '#ffb066'
const HOT = '#fff1cf'
const RED = '#ff2a2a'
const WARN = '#ffd23f'

// What the HUD shows beside the brain: the vital signs, and a loop when one
// is under way (the repeated action, in words).
// `calm` slows and stills the motion; `bootAge` is how long ago the panel
// opened, so the boot sequence plays once and a redraw mid-boot continues it;
// `helpers` names the helper agents working now; `speaking` is the line the
// brain is saying aloud, shown as a waveform and caption.
export type Hud = { vitals: Vitals; loop?: string; calm?: boolean; bootAge?: number; helpers?: string[]; speaking?: string }

const BOOT_MS = 3200

// Text from tools and prompts goes into the markup: escape it.
const esc = (t: string) => t.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
const clip = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + '…' : t)

const level = (pct: number) => (pct >= 90 ? RED : pct >= 70 ? WARN : AMBER)

export function untilReset(resetsAt: string | undefined, now: number): string {
  if (!resetsAt) return ''
  const ms = Date.parse(resetsAt) - now
  if (!(ms > 0)) return 'resetting'
  const m = Math.round(ms / 60000)
  if (m < 60) return `resets ${m}m`
  const h = Math.floor(m / 60)
  return h < 48 ? `resets ${h}h ${m % 60}m` : `resets ${Math.round(h / 24)}d`
}

// A HUD dial: a track, the filled arc, a slow rotating tick ring, the readout.
function gauge(x: number, y: number, label: string, pct: number | undefined, sub: string): string {
  const p = Math.max(0, Math.min(100, pct ?? 0))
  const color = level(p)
  const blink = p >= 90 ? `<animate attributeName="opacity" values="1;.35;1" dur=".9s" repeatCount="indefinite"/>` : ''
  return `<g transform="translate(${x} ${y})"><circle r="25" fill="#0d0400" fill-opacity=".7" stroke="#4a1e06" stroke-width="4"/><circle r="25" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" pathLength="100" stroke-dasharray="${f(p)} 100" transform="rotate(-90)" filter="url(#glow)">${blink}</circle><circle r="31" fill="none" stroke="${AMBER}" stroke-width=".8" stroke-dasharray="2 4" opacity=".6"><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="24s" repeatCount="indefinite"/></circle><text class="g" y="6" text-anchor="middle">${pct === undefined ? '--' : `${Math.round(p)}%`}</text><text class="gl" y="47" text-anchor="middle">${label}</text><text class="gs" y="62" text-anchor="middle">${sub}</text></g>`
}

function banner(text: string, color: string): string {
  const w = text.length * 10.4 + 32
  return `<g transform="translate(${C.x} 40)"><rect x="${f(-w / 2)}" y="-15" width="${f(w)}" height="28" rx="4" fill="#120400" fill-opacity=".85" stroke="${color}" stroke-width="1"/><text class="bn" y="5" text-anchor="middle" fill="${color}">${text.replace('⚠', '&#9888;')}</text><animate attributeName="opacity" values="1;.45;1" dur="1.1s" repeatCount="indefinite"/></g>`
}

export const LOBES: { id: Lobe; name: string; what: string; at: P }[] = [
  { id: 'build', name: 'BUILD', what: 'writing & editing', at: { x: 150, y: 135 } },
  { id: 'exec', name: 'EXEC', what: 'running commands', at: { x: 240, y: 92 } },
  { id: 'link', name: 'LINK', what: 'other tools', at: { x: 318, y: 110 } },
  { id: 'see', name: 'SEE', what: 'reading & looking', at: { x: 365, y: 168 } },
  { id: 'search', name: 'SEARCH', what: 'searching code & web', at: { x: 228, y: 212 } },
  { id: 'swarm', name: 'SWARM', what: 'helper agents', at: { x: 338, y: 236 } },
]

const SPEED: Record<Mode, number> = { idle: 0.55, thinking: 1, acting: 1.9 }

function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const f = (n: number) => n.toFixed(1)
const i0 = (n: number) => Math.round(n)

// The cerebrum's radius from the centre at angle th (radians, y down).
function radius(th: number): number {
  const c = Math.cos(th)
  const s = Math.sin(th)
  let r = 1 / Math.sqrt((c / 150) ** 2 + (s / 90) ** 2)
  const deg = ((th * 180) / Math.PI + 360) % 360
  const g = (mu: number, w: number) => Math.exp(-((((((deg - mu + 540) % 360) - 180) / w) ** 2)))
  r *= 1 - 0.24 * Math.max(0, s) ** 3
  r *= 1 + 0.17 * g(118, 18) - 0.12 * g(152, 9) + 0.05 * g(195, 25) - 0.06 * g(25, 22)
  r *= 1 + 0.018 * Math.sin(th * 17)
  return r
}

const CEREBELLUM = { x: 338, y: 236, rx: 50, ry: 27 }

function inCerebrum(p: P, k = 0.97): boolean {
  const th = Math.atan2(p.y - C.y, p.x - C.x)
  return Math.hypot(p.x - C.x, p.y - C.y) < radius(th) * k
}
function inCerebellum(p: P): boolean {
  return ((p.x - CEREBELLUM.x) / CEREBELLUM.rx) ** 2 + ((p.y - CEREBELLUM.y) / CEREBELLUM.ry) ** 2 < 0.92
}
const inBrain = (p: P) => inCerebrum(p) || inCerebellum(p)

function lobeOf(p: P): Lobe {
  if (inCerebellum(p) && !inCerebrum(p, 0.9)) return 'swarm'
  let best = LOBES[0]!
  let d = Infinity
  for (const l of LOBES) {
    if (l.id === 'swarm') continue
    const dd = Math.hypot(p.x - l.at.x, p.y - l.at.y)
    if (dd < d) [best, d] = [l, dd]
  }
  return best.id
}

// The fixed geometry, built once: the same seed gives the same brain.
const GEO = (() => {
  const rand = rng(7)
  const outline: P[] = []
  for (let d = 0; d < 360; d += 3) {
    const th = (d * Math.PI) / 180
    const r = radius(th)
    outline.push({ x: C.x + r * Math.cos(th), y: C.y + r * Math.sin(th) })
  }
  const outlinePath = 'M' + outline.map(p => `${f(p.x)} ${f(p.y)}`).join('L') + 'Z'

  const sample = (n: number) => {
    const out: (P & { lobe: Lobe })[] = []
    while (out.length < n) {
      const p = { x: 80 + rand() * 320, y: 60 + rand() * 210 }
      if (inBrain(p)) out.push({ ...p, lobe: lobeOf(p) })
    }
    return out
  }
  const pts = sample(250)
  const dust = sample(720)

  const edges: [number, number][] = []
  const seen = new Set<string>()
  pts.forEach((p, i) => {
    const near = pts
      .map((q, j) => ({ j, d: Math.hypot(p.x - q.x, p.y - q.y) }))
      .filter(o => o.j !== i && o.d < 30)
      .sort((a, b) => a.d - b.d)
      .slice(0, 2)
    for (const { j } of near) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`
      if (!seen.has(key)) {
        seen.add(key)
        edges.push([i, j])
      }
    }
  })

  // Folds: wobbly partial arcs at shrinking scales of the silhouette.
  const folds: string[] = []
  for (const s of [0.24, 0.36, 0.47, 0.57, 0.66, 0.74, 0.81, 0.88, 0.94]) {
    for (let n = 0; n < 7; n++) {
      const start = rand() * 360
      const len = 18 + rand() * 40
      const ph = rand() * 6
      const seg: string[] = []
      for (let d = start; d < start + len; d += 2.5) {
        const th = (d * Math.PI) / 180
        const r = radius(th) * s * (1 + 0.07 * Math.sin(th * 34 + ph) + 0.03 * Math.sin(th * 71 + ph))
        seg.push(`${f(C.x + r * Math.cos(th))} ${f(C.y + r * Math.sin(th))}`)
      }
      folds.push('M' + seg.join('L'))
    }
  }
  for (let j = 1; j <= 5; j++) {
    const k = j / 6
    const seg: string[] = []
    for (let d = 200; d <= 340; d += 6) {
      const th = (d * Math.PI) / 180
      seg.push(
        `${f(CEREBELLUM.x + CEREBELLUM.rx * 0.95 * Math.cos(th))} ${f(CEREBELLUM.y - CEREBELLUM.ry + 2 * CEREBELLUM.ry * k + 6 * Math.sin(th) * (1 - k))}`,
      )
    }
    folds.push('M' + seg.join('L'))
  }
  folds.push('M168 196 C200 178 240 168 300 150', 'M252 74 C246 104 240 128 232 158')

  const hubs = Array.from({ length: 42 }, () => Math.floor(rand() * pts.length))
  const filaments = hubs.slice(0, 26).map(i => {
    const h = pts[i]!
    const g = { x: -20 + rand() * 520, y: 315 + rand() * 85 }
    const c = { x: h.x + (g.x - h.x) * 0.9 + (rand() - 0.5) * 60, y: h.y + (rand() - 0.3) * 50 }
    return { i, d: `M${f(h.x)} ${f(h.y)}Q${f(c.x)} ${f(c.y)} ${f(g.x)} ${f(g.y)}`, g, dur: 2.4 + rand() * 3, off: rand() }
  })
  const runners = Array.from({ length: 18 }, () => ({
    e: edges[Math.floor(rand() * edges.length)]!,
    dur: 1.2 + rand() * 2,
    off: rand(),
  }))
  const twinkles = Array.from({ length: 36 }, () => ({
    i: Math.floor(rand() * pts.length),
    dur: 1.5 + rand() * 3,
    off: rand(),
  }))
  const bokeh = Array.from({ length: 18 }, () => ({
    x: rand() * W,
    y: rand() * H,
    r: 3 + rand() * 12,
    deep: rand() < 0.35,
    o: 0.12 + rand() * 0.3,
    dx: (rand() - 0.5) * 30,
    dy: (rand() - 0.5) * 20,
    dur: 9 + rand() * 12,
  }))
  const specks = Array.from({ length: 24 }, () => {
    const t = rand()
    return { x: rand() * W, y: 302 + 96 * t ** 1.3, r: 0.8 + t * 1.8, dur: 1.5 + rand() * 3, off: rand() }
  })

  const floor: string[] = ['', '', '']
  for (let i = 0; i < 15; i++) {
    const t = i / 14
    const y = 300 + 98 * t ** 1.5
    const gap = 7 + 16 * t
    const shift = (i % 2) * gap * 0.5
    for (let x = shift; x < W; x += gap) floor[Math.min(2, Math.floor(t * 3))] += `M${i0(x)} ${i0(y)}h.01`
  }

  // The pointer grid: one cell per CELL square, tagged with the lobe under it.
  const cells: { n: number; x: number; y: number; lobe: Lobe | undefined }[] = []
  for (let y = 0; y < H; y += CELL) {
    for (let x = 0; x < W; x += CELL) {
      const mid = { x: x + CELL / 2, y: y + CELL / 2 }
      cells.push({ n: cells.length, x, y, lobe: inBrain(mid) ? lobeOf(mid) : undefined })
    }
  }

  // Each lobe's mesh, nodes and dust as path data, built once: they never move.
  const byLobe = Object.fromEntries(
    LOBES.map(l => [
      l.id,
      {
        mesh: edges
          .filter(([i]) => pts[i]!.lobe === l.id)
          .map(([i, j]) => `M${i0(pts[i]!.x)} ${i0(pts[i]!.y)}L${i0(pts[j]!.x)} ${i0(pts[j]!.y)}`)
          .join(''),
        nodes: pts.filter(q => q.lobe === l.id).map(q => `M${i0(q.x)} ${i0(q.y)}h.01`).join(''),
        dust: dust.filter(q => q.lobe === l.id).map(q => `M${i0(q.x)} ${i0(q.y)}h.01`).join(''),
      },
    ]),
  ) as Record<Lobe, { mesh: string; nodes: string; dust: string }>

  return { outlinePath, pts, dust, specks, edges, folds: folds.join(''), hubs, filaments, runners, twinkles, bokeh, floor, cells, byLobe }
})()

let CELLS_MARKUP: string | undefined

const CSS = `.v{pointer-events:none}
.c{cursor:crosshair}
.c rect{fill:transparent;width:${CELL}px;height:${CELL}px}
.c circle{r:34px;fill:url(#cur);opacity:0;pointer-events:none;transition:opacity 1.6s ease-out,r .6s ease-out}
.c:hover circle{opacity:1;transition:opacity .12s,r .6s ease-out}
.c:active circle{r:72px;transition:r .08s}
.hl{opacity:0;pointer-events:none;transition:opacity .5s}
${LOBES.map(l => `.L-${l.id}:hover~.h-${l.id}`).join(',')}{opacity:1;transition:opacity .15s}
.lbl{font:700 16px ui-monospace,Menlo,monospace;letter-spacing:1.5px;fill:${HOT};stroke:#1a0700;stroke-width:3px;paint-order:stroke}
.sub{font:600 14px ui-monospace,Menlo,monospace;fill:${PALE};stroke:#1a0700;stroke-width:4px;paint-order:stroke}
.g{font:700 17px ui-monospace,Menlo,monospace;fill:${HOT};stroke:#120400;stroke-width:3px;paint-order:stroke}
.gl{font:700 13px ui-monospace,Menlo,monospace;letter-spacing:1px;fill:${PALE};stroke:#120400;stroke-width:3px;paint-order:stroke}
.gs{font:600 12px ui-monospace,Menlo,monospace;fill:#e0a468;stroke:#120400;stroke-width:3px;paint-order:stroke}
.gc{font:700 15px ui-monospace,Menlo,monospace;letter-spacing:1px;fill:${PALE};stroke:#120400;stroke-width:3px;paint-order:stroke}
.bn{font:700 15px ui-monospace,Menlo,monospace;letter-spacing:2px}
.say{font:600 14px ui-monospace,Menlo,monospace;fill:${HOT};stroke:#120400;stroke-width:4px;paint-order:stroke}
.sat{font:700 13px ui-monospace,Menlo,monospace;fill:${HOT};stroke:#120400;stroke-width:3px;paint-order:stroke}
.tk{font:600 13px ui-monospace,Menlo,monospace;fill:${PALE};opacity:.9}`

export function drawBrain(b: Brain, now: number, hud: Hud): string {
  const v = hud.vitals
  const calm = !!hud.calm
  const speed = SPEED[b.mode] * (calm ? 0.35 : 1)
  const busy = b.mode !== 'idle'
  const last = b.feed[b.feed.length - 1]
  const isFresh = !!last && now - last.at < 4000
  const recent = b.feed.slice(-12)
  const heat = (l: Lobe) =>
    Math.min(1, recent.filter(s => s.region === l).length / 6 + (isFresh && last!.region === l ? 0.6 : 0))
  const tone = (l: Lobe) => (isFresh && last!.isError && last!.region === l ? RED : HOT)
  const dur = (d: number) => f(d / speed)
  const begin = (off: number, d: number) => `-${f((off * d) / speed)}s`
  const out: string[] = []

  // Backdrop.
  out.push(
    `<rect width="${W}" height="${H}" rx="14" fill="url(#bg)"/>`,
    ...GEO.bokeh.map(
      k =>
        `<circle cx="${i0(k.x)}" cy="${i0(k.y)}" r="${i0(k.r * 1.8)}" fill="url(#${k.deep ? 'bd' : 'be'})" opacity="${f(k.o)}">${calm ? '' : `<animateTransform attributeName="transform" type="translate" values="0 0;${f(k.dx)} ${f(k.dy)};0 0" dur="${f(k.dur)}s" repeatCount="indefinite"/>`}</circle>`,
    ),
    `<ellipse cx="${C.x}" cy="318" rx="190" ry="34" fill="url(#pool)"><animate attributeName="opacity" values=".5;.9;.5" dur="${dur(5)}s" repeatCount="indefinite"/></ellipse>`,
    `<path d="${GEO.floor[0]}" stroke="#b8400a" stroke-width="1" stroke-linecap="round" opacity=".5"/>`,
    `<path d="${GEO.floor[1]}" stroke="#e05510" stroke-width="1.5" stroke-linecap="round" opacity=".55"/>`,
    `<path d="${GEO.floor[2]}" stroke="#ff6a14" stroke-width="2.1" stroke-linecap="round" opacity=".6"/>`,
    ...GEO.specks.map(
      k =>
        `<circle cx="${i0(k.x)}" cy="${i0(k.y)}" r="${f(k.r)}" fill="${EMBER}"><animate attributeName="opacity" values=".2;1;.2" dur="${dur(k.dur)}s" begin="${begin(k.off, k.dur)}" repeatCount="indefinite"/></circle>`,
    ),
  )

  // Filaments to the floor, each carrying a travelling spark.
  for (const fl of GEO.filaments) {
    const lobe = GEO.pts[fl.i]!.lobe
    const hot = heat(lobe)
    out.push(
      `<path d="${fl.d}" fill="none" stroke="${hot > 0.3 ? tone(lobe) : AMBER}" stroke-width=".7" opacity="${f(0.25 + hot * 0.5)}"/>`,
      `<circle cx="${i0(fl.g.x)}" cy="${i0(fl.g.y)}" r="2" fill="${EMBER}" opacity=".85"/>`,
      calm ? '' : `<circle r="4" fill="url(#bh)"><animateMotion path="${fl.d}" dur="${dur(fl.dur)}s" begin="${begin(fl.off, fl.dur)}" repeatCount="indefinite"/><animate attributeName="opacity" values="0;1;1;0" dur="${dur(fl.dur)}s" begin="${begin(fl.off, fl.dur)}" repeatCount="indefinite"/></circle>`,
    )
  }

  // The brain body: glow, translucent fill, outline, folds, shading.
  out.push(
    `<path d="${GEO.outlinePath}" fill="none" stroke="${AMBER}" stroke-width="12" opacity="${busy ? '.45' : '.3'}" filter="url(#soft)"><animate attributeName="opacity" values="${busy ? '.35;.6;.35' : '.22;.38;.22'}" dur="${dur(3.2)}s" repeatCount="indefinite"/></path>`,
    `<path d="${GEO.outlinePath}" fill="url(#body)"/>`,
    `<ellipse cx="${CEREBELLUM.x}" cy="${CEREBELLUM.y}" rx="${CEREBELLUM.rx}" ry="${CEREBELLUM.ry}" fill="url(#body)" stroke="${AMBER}" stroke-width=".8" opacity=".75"/>`,
    `<path d="M290 222C296 250 300 280 310 312M312 222C314 250 318 278 326 306" fill="none" stroke="${AMBER}" stroke-width=".8" opacity=".45"/>`,
    `<path d="${GEO.outlinePath}" fill="none" stroke="#ffa64d" stroke-width="1.4" opacity=".9"/>`,
    `<use href="#folds" stroke="#2a0d00" stroke-width="2.2" opacity=".55" transform="translate(.8 1.2)"/>`,
    `<use href="#folds" stroke="#ff9a40" stroke-width=".9" opacity=".6"/>`,
    `<path d="${GEO.outlinePath}" fill="url(#shade)"/>`,
  )

  // Dust and mesh, one path per lobe so a busy lobe can burn white-hot.
  for (const l of LOBES) {
    const hot = heat(l.id)
    const { mesh: d, nodes: dots, dust } = GEO.byLobe[l.id]
    out.push(
      `<path d="${dust}" stroke="${hot > 0.3 ? HOT : '#ffa040'}" stroke-width="1.3" stroke-linecap="round" opacity="${f(0.7 + hot * 0.3)}"/>`,
      `<defs><path id="m-${l.id}" d="${d}"/></defs><use href="#m-${l.id}" stroke="#ff8a2a" stroke-width=".6" opacity=".65"/>`,
      `<path d="${dots}" stroke="#ffd29a" stroke-width="1.8" stroke-linecap="round" opacity=".8"/>`,
    )
    if (hot > 0) {
      out.push(
        `<use href="#m-${l.id}" stroke="${tone(l.id)}" stroke-width=".9" filter="url(#glow)" opacity="${f(hot * 0.9)}"><animate attributeName="opacity" values="${f(hot * 0.4)};${f(hot)};${f(hot * 0.4)}" dur="${dur(1.6)}s" repeatCount="indefinite"/></use>`,
      )
    }
  }

  // Signals racing along the mesh.
  for (const r of calm ? [] : GEO.runners) {
    const a = GEO.pts[r.e[0]]!
    const z = GEO.pts[r.e[1]]!
    out.push(
      `<circle r="1.3" fill="#fff"><animateMotion path="M${i0(a.x)} ${i0(a.y)}L${i0(z.x)} ${i0(z.y)}" dur="${dur(r.dur)}s" begin="${begin(r.off, r.dur)}" repeatCount="indefinite"/></circle>`,
    )
  }

  // Twinkling particles.
  for (const t of calm ? [] : GEO.twinkles) {
    const p = GEO.pts[t.i]!
    out.push(
      `<circle cx="${i0(p.x)}" cy="${i0(p.y)}" r="1.6" fill="#fff7ea"><animate attributeName="opacity" values="0;1;0" dur="${dur(t.dur)}s" begin="${begin(t.off, t.dur)}" repeatCount="indefinite"/></circle>`,
    )
  }

  // Hub neurons: embers, white-hot in a lobe that's working.
  GEO.hubs.forEach((i, n) => {
    const p = GEO.pts[i]!
    const hot = heat(p.lobe)
    const o = 0.4 + hot * 0.6
    const d = 1.4 + (n % 5) * 0.6
    out.push(
      `<circle cx="${i0(p.x)}" cy="${i0(p.y)}" r="${i0(8 + hot * 8)}" fill="url(#${hot > 0.3 ? (tone(p.lobe) === RED ? 'br' : 'bh') : 'be'})" opacity="${f(o * 0.8)}"/>`,
      `<circle cx="${i0(p.x)}" cy="${i0(p.y)}" r="${f(1.8 + hot * 1.2)}" fill="${HOT}"><animate attributeName="opacity" values="${f(o * 0.4)};${f(o)};${f(o * 0.4)}" dur="${dur(d)}s" begin="${begin((n * 0.37) % 1, d)}" repeatCount="indefinite"/></circle>`,
    )
  })

  // Holographic scan sweeping through the brain.
  out.push(
    `<g clip-path="url(#clip)"><rect x="0" width="${W}" height="22" fill="url(#scan)"><animate attributeName="y" values="50;270" dur="${dur(4)}s" repeatCount="indefinite"/></rect></g>`,
  )

  // A memory flush: rings collapse into the core and the scene flashes white.
  if (isFresh && last?.kind === 'compact') {
    for (const k of [0, 0.25, 0.5]) {
      out.push(
        `<circle cx="${C.x}" cy="${C.y}" r="230" fill="none" stroke="${HOT}" stroke-width="2.5" opacity="0" filter="url(#glow)"><animate attributeName="r" values="230;6" dur="1.3s" begin="${k}s" repeatCount="2" fill="freeze"/><animate attributeName="opacity" values="0;.9;0" dur="1.3s" begin="${k}s" repeatCount="2" fill="freeze"/></circle>`,
      )
    }
    out.push(
      `<rect width="${W}" height="${H}" fill="${HOT}" opacity="0"><animate attributeName="opacity" values="0;.22;0" dur="1.3s" repeatCount="2" fill="freeze"/></rect>`,
    )
  }

  // The firing: a shockwave from the lobe that just acted.
  if (isFresh && last && last.kind !== 'compact') {
    const l = LOBES.find(x => x.id === last.region)
    const at = l ? l.at : C
    const big = l ? 60 : 170
    const color = last.isError ? RED : HOT
    out.push(
      `<circle cx="${at.x}" cy="${at.y}" r="4" fill="none" stroke="${color}" stroke-width="2" filter="url(#glow)"><animate attributeName="r" values="4;${big}" dur="1.4s" repeatCount="2" fill="freeze"/><animate attributeName="opacity" values="1;0" dur="1.4s" repeatCount="2" fill="freeze"/></circle>`,
    )
  }

  // The floor halo: a tick ring around the brain's base, lit as far as memory is full.
  const mem = v.contextPct ?? 0
  out.push(
    `<ellipse cx="${C.x}" cy="300" rx="205" ry="26" fill="none" stroke="#5a2508" stroke-width="3" stroke-dasharray="1.5 5"/>`,
    `<ellipse cx="${C.x}" cy="300" rx="205" ry="26" fill="none" stroke="${level(mem)}" stroke-width="3" pathLength="100" stroke-dasharray="${f(mem)} 100" transform="rotate(180 ${C.x} 300)" filter="url(#glow)" opacity=".85"/>`,
    `<ellipse cx="${C.x}" cy="300" rx="215" ry="30" fill="none" stroke="${AMBER}" stroke-width=".6" stroke-dasharray="40 14 6 14" opacity=".5"><animate attributeName="stroke-dashoffset" values="0;-148" dur="${dur(8)}s" repeatCount="indefinite"/></ellipse>`,
  )

  // Vital signs: memory on the left, the 5-hour limit on the right, cost between.
  const fiveHour = v.limits.find(l => l.kind === 'five_hour')
  const week = v.limits.find(l => l.kind === 'seven_day')
  const tokens = v.contextTokens !== undefined && v.contextWindow ? `${Math.round(v.contextTokens / 1000)}k/${Math.round(v.contextWindow / 1000)}k` : '--'
  out.push(
    gauge(50, 326, 'MEMORY', v.contextPct, tokens),
    gauge(430, 326, '5H LIMIT', fiveHour?.pct, fiveHour ? untilReset(fiveHour.resetsAt, now).replace('resets ', '') : '--'),
    `<text class="gc" x="${C.x}" y="386" text-anchor="middle">${v.costUsd !== undefined ? `$${v.costUsd.toFixed(2)}` : ''}${week ? `${v.costUsd !== undefined ? ' &#183; ' : ''}WEEK ${Math.round(week.pct)}%` : ''}</text>`,
  )

  // Alarms: a loop washes the scene red; a waiting prompt sends out a beacon.
  if (hud.loop) {
    out.push(
      `<rect width="${W}" height="${H}" fill="${RED}" opacity="0"><animate attributeName="opacity" values="0;.14;0" dur="1.2s" repeatCount="indefinite"/></rect>`,
      `<path d="${GEO.outlinePath}" fill="none" stroke="${RED}" stroke-width="2.5" filter="url(#glow)"><animate attributeName="opacity" values=".3;1;.3" dur="1.2s" repeatCount="indefinite"/></path>`,
      banner('⚠ LOOP DETECTED', RED),
    )
  } else if (v.waiting) {
    for (const k of [0, 1, 2]) {
      out.push(
        `<circle cx="${C.x}" cy="${C.y}" r="20" fill="none" stroke="${HOT}" stroke-width="1.5" opacity="0"><animate attributeName="r" values="20;200" dur="2.4s" begin="${k * 0.8}s" repeatCount="indefinite"/><animate attributeName="opacity" values=".8;0" dur="2.4s" begin="${k * 0.8}s" repeatCount="indefinite"/></circle>`,
      )
    }
    out.push(banner('AWAITING YOUR OK', HOT))
  }

  // Helper agents: satellites orbiting the brain while they work.
  const helpers = (hud.helpers ?? []).slice(0, 4)
  if (helpers.length > 0) {
    const orbit = `M${C.x - 215} ${C.y}a215 140 0 1 0 430 0a215 140 0 1 0 -430 0`
    const lap = 12
    out.push(`<path d="${orbit}" fill="none" stroke="${AMBER}" stroke-width=".7" stroke-dasharray="3 6" opacity=".45"/>`)
    helpers.forEach((name, i) => {
      out.push(
        `<g><circle r="11" fill="${AMBER}" opacity=".45" filter="url(#soft)"/><circle r="7" fill="none" stroke="${HOT}" stroke-width="1"><animate attributeName="r" values="6;9;6" dur="1.4s" repeatCount="indefinite"/></circle><circle r="3.5" fill="${HOT}"/><text class="sat" y="-14" text-anchor="middle">${esc(clip(name, 20))}</text><animateMotion path="${orbit}" dur="${dur(lap)}s" begin="-${f(((i / helpers.length) * lap) / speed)}s" repeatCount="indefinite"/></g>`,
      )
    })
  }

  // The newest action, named beside its lobe as it fires (the stream's top row).
  const step = [...b.feed].reverse().find(s => s.region !== 'core')
  const lobe = step && LOBES.find(l => l.id === step.region)
  if (step && lobe && now - step.at < 4000) {
    const above = lobe.at.y < C.y
    const y = lobe.at.y + (above ? -30 : 34)
    out.push(
      `<g opacity="0"><text class="lbl" x="${lobe.at.x}" y="${y}" text-anchor="middle" style="fill:${step.isError ? RED : HOT}">${lobe.name}</text><text class="sub" x="${lobe.at.x}" y="${y + 17}" text-anchor="middle">${esc(clip(`${step.verb} ${step.detail}`.trim(), 26))}</text><animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.08;.75;1" dur="4s" begin="-${f((now - step.at) / 1000)}s" fill="freeze"/></g>`,
    )
  }

  // Speaking: the outline pulses with the voice, a waveform rises from the
  // floor, and the words run beneath it.
  if (hud.speaking) {
    out.push(
      `<path d="${GEO.outlinePath}" fill="none" stroke="${HOT}" stroke-width="2" filter="url(#glow)"><animate attributeName="opacity" values=".15;.8;.35;.95;.2;.6;.15" dur="1.1s" repeatCount="indefinite"/></path>`,
    )
    for (let k = 0; k < 15; k++) {
      const x = C.x - 70 + k * 10
      const peak = 6 + ((k * 7) % 11) * 2.2 * (1 - Math.abs(k - 7) / 9)
      const d = 0.45 + ((k * 5) % 7) * 0.08
      out.push(
        `<rect x="${x - 2}" y="${300 - peak / 2}" width="4" height="${f(peak)}" rx="2" fill="${HOT}" filter="url(#glow)"><animate attributeName="height" values="2;${f(peak)};4;${f(peak * 0.7)};2" dur="${f(d)}s" repeatCount="indefinite"/><animate attributeName="y" values="299;${f(300 - peak / 2)};298;${f(300 - peak * 0.35)};299" dur="${f(d)}s" repeatCount="indefinite"/></rect>`,
      )
    }
    out.push(`<text class="say" x="${C.x}" y="350" text-anchor="middle">${esc(clip(hud.speaking, 30))}</text>`)
  }

  // HUD frame: corner brackets, edge rulers, and a ticker of recent actions.
  const ticks = (x: number, dir: number) =>
    Array.from({ length: 25 }, (_, i) => `M${x} ${70 + i * 10}h${dir * (i % 5 === 0 ? 7 : 3)}`).join('')
  out.push(
    `<path d="M6 22V6H22M458 6H474V22M6 378V394H22M458 394H474V378" fill="none" stroke="${AMBER}" stroke-width="1.4" opacity=".85"/>`,
    `<path d="${ticks(6, 1)}${ticks(474, -1)}" stroke="${AMBER}" stroke-width=".8" opacity=".5"/>`,
    `<path d="M28 25H452" stroke="${AMBER}" stroke-width=".6" opacity=".4"/>`,
  )
  const recentSteps = b.feed.filter(s => s.region !== 'core').slice(-8).reverse()
  if (recentSteps.length > 0) {
    const line = recentSteps.map(s => `${s.isError ? '✖' : '▸'} ${clip(`${s.verb} ${s.detail}`.trim(), 40)}`).join('     ')
    const width = line.length * 7.9
    const secs = (W + width) / (calm ? 14 : 38)
    out.push(
      `<g clip-path="url(#strip)"><text class="tk" y="18">${esc(line)}<animateTransform attributeName="transform" type="translate" values="${W} 0;${f(-width)} 0" dur="${f(secs)}s" repeatCount="indefinite"/></text></g>`,
    )
  }

  // Clicking a lobe: a shockwave from it, and the whole outline flares.
  const clicks = (cells: typeof GEO.cells) => cells.map(c => `c${c.n}.click`).join(';')
  const brainClicks = clicks(GEO.cells.filter(c => c.lobe))
  for (const l of LOBES) {
    const on = clicks(GEO.cells.filter(c => c.lobe === l.id))
    if (!on) continue
    out.push(
      `<circle cx="${l.at.x}" cy="${l.at.y}" r="0" fill="none" stroke="${HOT}" stroke-width="2.5" filter="url(#glow)"><animate attributeName="r" values="6;95" dur=".9s" begin="${on}" fill="freeze"/><animate attributeName="opacity" values="1;0" dur=".9s" begin="${on}" fill="freeze"/></circle>`,
    )
  }
  out.push(
    `<path d="${GEO.outlinePath}" fill="none" stroke="${HOT}" stroke-width="2.5" opacity="0" filter="url(#glow)"><animate attributeName="opacity" values="0;1;0" dur=".7s" begin="${brainClicks}"/></path>`,
  )

  // The pointer grid, then each lobe's highlight, which its cells reach by `~`.
  const cells = CELLS_MARKUP ?? (CELLS_MARKUP = GEO.cells.map(
    c =>
      `<g class="c${c.lobe ? ` L-${c.lobe}` : ''}" id="c${c.n}"><rect x="${c.x}" y="${c.y}"/><circle cx="${c.x + CELL / 2}" cy="${c.y + CELL / 2}"/></g>`,
  ).join(''))
  const highlights = LOBES.map(l => {
    const above = l.at.y < C.y
    const y = l.at.y + (above ? -30 : 34)
    return `<g class="hl h-${l.id}"><use href="#m-${l.id}" stroke="${HOT}" stroke-width="1.2" filter="url(#glow)"/><circle cx="${l.at.x}" cy="${l.at.y}" r="26" fill="url(#cur)"/><text class="lbl" x="${l.at.x}" y="${y}" text-anchor="middle">${l.name} &#183; ${b.counts[l.id]}</text><text class="sub" x="${l.at.x}" y="${y + 17}" text-anchor="middle">${esc(l.what)}</text></g>`
  })

  const age = hud.bootAge ?? BOOT_MS
  const isBooting = age < BOOT_MS
  const bootBegin = `-${f(age / 1000)}s`
  const bootMask = isBooting
    ? `<mask id="boot"><circle cx="${C.x}" cy="${C.y}" r="0" fill="#fff"><animate attributeName="r" values="0;0;380" keyTimes="0;.35;1" dur="2.4s" begin="${bootBegin}" fill="freeze"/></circle></mask>`
    : ''
  const bootOverlay = isBooting
    ? `<g class="v" opacity="1"><path d="${GEO.outlinePath}" fill="none" stroke="${HOT}" stroke-width="1.6" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1" filter="url(#glow)"><animate attributeName="stroke-dashoffset" values="1;0" dur="1.3s" begin="${bootBegin}" fill="freeze"/></path><text class="bn" x="${C.x}" y="${C.y + 4}" text-anchor="middle" fill="${HOT}">INITIALIZING NEURAL CORE</text><rect x="${C.x - 80}" y="${C.y + 14}" width="160" height="2" fill="#4a1e06"/><rect x="${C.x - 80}" y="${C.y + 14}" width="0" height="2" fill="${HOT}"><animate attributeName="width" values="0;160" dur="2.2s" begin="${bootBegin}" fill="freeze"/></rect><animate attributeName="opacity" values="1;1;0" keyTimes="0;.8;1" dur="${BOOT_MS / 1000}s" begin="${bootBegin}" fill="freeze"/></g>`
    : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * 3}" height="${H * 3}">
<style>${CSS}</style>
<defs>
<radialGradient id="bg" cx=".5" cy=".42" r=".75"><stop offset="0" stop-color="#2a0d00"/><stop offset=".55" stop-color="#110400"/><stop offset="1" stop-color="#030100"/></radialGradient>
<radialGradient id="body" cx=".45" cy=".4" r=".7"><stop offset="0" stop-color="#ff7a10" stop-opacity=".2"/><stop offset=".7" stop-color="#ff5a00" stop-opacity=".07"/><stop offset="1" stop-color="#ff5a00" stop-opacity=".02"/></radialGradient>
<radialGradient id="pool"><stop offset="0" stop-color="#e0660f" stop-opacity=".45"/><stop offset="1" stop-color="#e0660f" stop-opacity="0"/></radialGradient>
<radialGradient id="be"><stop offset="0" stop-color="${EMBER}"/><stop offset="1" stop-color="${EMBER}" stop-opacity="0"/></radialGradient>
<radialGradient id="bd"><stop offset="0" stop-color="#e03a00"/><stop offset="1" stop-color="#e03a00" stop-opacity="0"/></radialGradient>
<radialGradient id="bh"><stop offset="0" stop-color="${HOT}"/><stop offset="1" stop-color="${HOT}" stop-opacity="0"/></radialGradient>
<radialGradient id="br"><stop offset="0" stop-color="${RED}"/><stop offset="1" stop-color="${RED}" stop-opacity="0"/></radialGradient>
<radialGradient id="cur"><stop offset="0" stop-color="#ffd08a" stop-opacity=".55"/><stop offset=".45" stop-color="#ff9a3c" stop-opacity=".18"/><stop offset="1" stop-color="#ff9a3c" stop-opacity="0"/></radialGradient>
<linearGradient id="scan" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd59a" stop-opacity="0"/><stop offset=".5" stop-color="#ffd59a" stop-opacity=".28"/><stop offset="1" stop-color="#ffd59a" stop-opacity="0"/></linearGradient>
<linearGradient id="shade" x1="0" y1="0" x2=".25" y2="1"><stop offset="0" stop-color="#ffc080" stop-opacity=".16"/><stop offset=".45" stop-color="#ffe8cc" stop-opacity="0"/><stop offset="1" stop-color="#0d0300" stop-opacity=".2"/></linearGradient>
<filter id="glow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="soft" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="3.5"/></filter>
<path id="folds" d="${GEO.folds}" fill="none" stroke-linecap="round"/>
<clipPath id="clip"><path d="${GEO.outlinePath}"/></clipPath>
<clipPath id="strip"><rect x="28" y="2" width="424" height="22"/></clipPath>
${bootMask}
</defs>
<g class="v"${isBooting ? ' mask="url(#boot)"' : ''}>
${out.join('\n')}
</g>
${bootOverlay}
${cells}
${highlights.join('')}
</svg>`
}
