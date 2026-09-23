# bucketdump-sim — design

A tipping-bucket water-park simulator. Big bucket fills, *ding ding ding*,
tips, dumps on everything. For a 3-year-old operator and his applied-math dad.

Deploy target: `https://tcj.io/bigbucket/` (static build, relative asset URLs).

## Physics model

2D world, SI units, gravity −y. "Volume" is 2D area (m²); mass uses a nominal
out-of-plane depth `DEPTH` so numbers read like litres/kg.

**Bucket** = rigid body rotating about a fixed pivot. Local frame: origin at the
inside-bottom of the cavity, +y toward the opening. The cavity is a simple
polygon whose *open edge* is the last edge (rim-right → rim-left).

**Fluid** is quasi-static: its free surface is always horizontal in the world
frame. Given angle θ and volume V, the fluid region is the cavity polygon
clipped by the half-plane `y_world ≤ h`, with `h` found by bisection so that
area = V. This yields the fluid centroid (for torque) and second moment (for
inertia) exactly — no particles inside the bucket.

**Capacity** `C(θ)` = cavity area below the lowest rim point. If `V > C(θ)` the
excess spills over that lip at a weir rate `q = (2/3)·Cd·√(2g)·H^{3/2}` where H
is the head above the lip (excess / free-surface width). Spilled volume is
emitted as particles at the lip with the lip's velocity + outflow velocity.

**Dynamics:** `I(V,θ)·θ̈ = τ_g(θ,V) − c·θ̇ + τ_user`, semi-implicit Euler with
substeps, hard angle stops with restitution. Tipping is a saddle-node
bifurcation of the static equilibrium branch θ*(V); the fold volume `V_tip`
and the return volume `V_ret` give the fill/dump **hysteresis loop**, which is
computed by `analysis/equilibrium.ts` and drawn in the ∂ (diff-eq) panel.

**Particles** carry volume. They fall under gravity, bounce off pegs/ramps,
wet people, and are *captured* by any bucket whose cavity they enter — so
buckets chain naturally (a dump fills the next bucket).

## Components

| # | module | responsibility | tests |
|---|---|---|---|
| 1 | `geom/vec`, `geom/polygon` | vec ops, area/centroid/2nd-moment, half-plane clip, transforms, point-in-poly | ✓ |
| 2 | `physics/fluid` | level solve h(V,θ), capacity C(θ), lip, weir rate | ✓ |
| 3 | `physics/shapes` | cavity generators: rect, flared, vee, scoop, round (+mirror); wall outline | ✓ |
| 4 | `physics/bucketModel` | static model: shell mass props, τ(θ,V,ρ), I(θ,V) | ✓ |
| 5 | `physics/bucket` | live state (θ, ω, V, mix), step with stops, spill, shove, inflow EMA / ETA | ✓ |
| 6 | `physics/particles`, `physics/collide` | SoA particle pool; disc/segment/circle contacts, reflection | ✓ |
| 7 | `physics/materials` | water / acorns / balls / sand / slime; mixtures | via bucket |
| 8 | `world/world` | pipes → particles → capture/bounce → pegs/ramps/people/ground; events; volume ledger | ✓ |
| 9 | `world/scenario` | serialisable scene, base64url codec, content framing box | ✓ |
| 10 | `world/buildBucket` | recipe → spec: solve counterweight for a target tip fill, safe dump stop, "returns while fed" | ✓ |
| 11 | `world/presets` | 8 hand-made scenes; auto-placed cascades | ✓ (60 s headless) |
| 12 | `world/random`, `world/generator(.worker)` | seeded generator + headless validation, off-thread | ✓ |
| 13 | `analysis/equilibrium` | equilibrium set, fold V_tip, V_ret, verdict, over-the-top angle | ✓ |
| 14 | `analysis/stiffness` | k = −∂τ/∂θ, GM, period; energy landscape U(θ) | ✓ |
| 15 | `analysis/recorder` | ring-buffer traces | ✓ |
| 16 | `audio/sound` | WebAudio synth: ding-ding-ding, whoosh, splash, clack, boing, thunk, cheer | – |
| 17 | `render/view` | world↔screen fit transform | ✓ |
| 18 | `render/canvas2d` (+`people`, `debugOverlay`, `color`) | 2D painter | manual |
| 19 | `render/three3d` | lazy-loaded 3D view of the same sim | manual |
| 20 | `ui/controls`, `ui/topbar`, `ui/form` | kid panel, top bar, inspector form helpers | manual |
| 21 | `ui/dashboard`, `ui/plots` | dense table; ∂ panel (equations, hysteresis, landscape, phase, traces) | manual |
| 22 | `modes/*` | play, demo playlist, splash'em, designer | manual |
| 23 | `app`, `main` | frame loop, events → sound/effects, input, URL state, shortcuts | manual |

## Kid-facing features
- Big lever valves per pipe (tap the emoji to change fill), big red DUMP!, tap a bucket to shove it.
- Beacon + *ding ding ding* ramping up as a bucket nears tipping, then a 3-2-1 countdown.
- Glass / painted buckets; fills: water, acorns, balls, sand, slime.
- ¼× slow-mo, pause, restart; SPLOOSH! burst, splash rings, wet puddles; people get soaked.
- 🎯 Splash'em: wandering crowd, 60 s rounds, diminishing-returns score, best score remembered.
- 📺 Demo playlist: presets alternating with worker-generated random scenes, two dumps per bucket each.
- 🌈 rainbow, 🧊 3D (orbit + tap), haptics on dump (mobile), fullscreen.

## Dad-facing features
- ⊕ overlay: fluid centroid, combined COM + plumb line, lever arm, torque arc, lip, brim level.
- ▦ dashboard: V, V_tip, %tip, θ, ω, τ, I, k, GM, period, spill rate, ETA, verdict, V_ret, θ_dump; pipes; volume ledger; fps.
- ∂ panel: live governing equations; θ*(V) equilibrium set (stable/unstable) with the live
  trajectory tracing the hysteresis loop; U(θ) landscape with the bucket as a ball;
  (θ, θ̇) phase portrait; θ(t), V(t) for every bucket.
- ✏️ designer with auto-tuned counterweight or manual physics and a live verdict.
- Scene JSON in the URL hash (`s=`), presets as `p=<id>`, random scenes as `r=<seed>`.

## Not done / ideas
- Instant replay of the last dump (needs state snapshots; slow-mo covers most of the fun).
- Water wheel driven by particle impulses; sprinklers; sloshing (fluid is quasi-static).
- Pinch-zoom in 2D; the 3D view has no countdown numerals or effects yet.
