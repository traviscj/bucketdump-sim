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
| 2 | `physics/fluid` | level solve h(V,θ), capacity C(θ), lip, fluid polygon | ✓ |
| 3 | `physics/shapes` | cavity generators: rect, flared, V, scoop, round; wall polygon | ✓ |
| 4 | `physics/bucket` | rigid-body state + step, spill, torque, inertia, push | ✓ |
| 5 | `physics/particles` | SoA particle pool, gravity, peg/ramp/ground collide, capture | ✓ |
| 6 | `physics/materials` | water / acorns / balls / sand / slime (colour, radius, bounce, Cd) | – |
| 7 | `world/world` | scene: pipes, buckets, pegs, ramps, people; fixed-step loop, events | ✓ |
| 8 | `world/scenario` | serialisable scene description (JSON, URL hash) | ✓ |
| 9 | `world/presets` | hand-tuned "known good" scenes | ✓ (all dump) |
| 10 | `world/random` | seeded generator of scenes, validated headlessly | ✓ |
| 11 | `analysis/equilibrium` | τ(θ,V), equilibrium branch, V_tip/V_ret, "works?" verdict | ✓ |
| 12 | `analysis/recorder` | ring-buffer traces for θ, ω, V, spill per bucket | ✓ |
| 13 | `audio/sound` | WebAudio synth: ding bell, splash noise, creak, cheer | – |
| 14 | `render/view` | world↔screen fit transform, hit-testing | ✓ |
| 15 | `render/canvas2d` | scene painter (transparent/opaque buckets, particles, overlays) | – |
| 16 | `render/three3d` | 3D view of the same world (lazy-loaded three.js) | – |
| 17 | `ui/controls` | kid control panel: valve levers, big DUMP button, modes | – |
| 18 | `ui/dashboard` | dense debug table (htop-style) | – |
| 19 | `ui/plots` | ∂ panel: small-multiple traces, phase portrait, hysteresis diagram | – |
| 20 | `ui/designer` | drag/edit buckets, pipes, pegs; inspector | – |
| 21 | `modes/*` | play, design, random, demo playlist, splash'em game | – |

## Kid-facing features
- Big lever valves per pipe, big red DUMP button, tap a bucket to shove it.
- Beacon + *ding ding ding* ramping up as a bucket nears tipping.
- Transparent / opaque buckets; fill materials (water, acorns, balls, sand, slime).
- Slow-mo + instant replay of the last dump.
- Splash'em: crowd of people, wetness meters, score.
- Demo playlist: random validated scenes, a couple of dumps each, then next.
- Rainbow mode, haptics on dump (mobile), fullscreen.

## Dad-facing features
- Debug overlay: bucket COM, fluid COM, combined COM, pivot, lever arm, torque arrow.
- Dashboard: V, V_tip, θ, ω, τ, I, spill rate, state per bucket; particle count, fps.
- ∂ panel: θ(t), V(t) traces; (θ, θ̇) phase portrait; θ*(V) equilibrium branch
  with stable/unstable segments and the live state dot tracing the hysteresis loop.
- Scene JSON in URL hash (shareable/reproducible); seeded randomness.
