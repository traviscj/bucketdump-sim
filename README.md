# 🪣 Big Bucket (bucketdump-sim)

A tipping-bucket water park simulator. The bucket fills, the beacon flashes,
*ding ding ding*, **3… 2… 1…**, SPLOOSH. Built for a 3-year-old operator and
his applied-math dad. Live at **https://tcj.io/bigbucket/**.

```sh
npm install
npm run dev        # http://localhost:5173 (also on the LAN, for phones)
npm test           # 83 unit/headless tests (~10 s)
npm run build      # static site in dist/ (relative URLs; works from any subpath)
scripts/deploy.sh  # test + build + rsync to tcj.io:/var/www/tcj.io/bigbucket/  (--dry-run available)
```

## For the operator (kid)
- **Big lever** = how much water. Tap the 💧 to switch to acorns, balls, sand or slime.
- **DUMP!** shoves the fullest bucket. You can also **tap a bucket** to dump it early.
- 🐢 **slow** = slow motion. ⏸ pause, ↺ start over.
- Scenes along the top; 🎲 makes up a brand-new park; 📺 demo plays by itself;
  🎯 **splash'em**: soak the wandering crowd before the clock runs out.
- 👁 glass buckets vs painted ones (can you guess when it'll tip?), 🌈 rainbow water, 🧊 3D.

## For the dad
- **⊕ com**: fluid centroid, combined COM + plumb line, lever arm, torque arc, lip, brim level.
- **▦ dash**: V, V_tip, θ, ω, τ, I, stiffness k = −∂τ/∂θ, effective metacentric height GM,
  small-oscillation period, spill rate, ETA, verdict, V_ret.
- **∂ plots**: the governing ODEs with live numbers; the equilibrium set θ\*(V) (stable green /
  unstable red) with the live trajectory tracing the **hysteresis loop**; the potential U(θ) with
  the bucket as a ball; the (θ, ω) phase portrait; θ(t) and V(t) for every bucket.
- ✏️ **design**: drag things; the inspector re-solves the counterweight for a target tip fill,
  or turn auto-tune off and break it (overflows / stuck / unstable are diagnosed live).
  🔗 share copies a URL with the whole park encoded.

Keys: `space` dump · `s` slow · `p` pause · `r` random · `g` glass · `c` COM · `b` dashboard ·
`d` plots · `m` mute · `3` 3D · `f` fullscreen.

## The model (short version — see DESIGN.md)
Rigid bucket on an axle; fluid is quasi-static (free surface ⟂ g), solved exactly as a polygon
clip with bisection on the level. `I(θ,V)·θ̈ = τ(θ,V) − c·θ̇`, overflow drains over the lower lip at
the 2D weir rate `⅔·Cd·√(2g)·H^{3/2}` and becomes particles that can land in other buckets.
Tipping is a saddle-node fold of the equilibrium branch — the empty bucket rests on a stop held
by its counterweight, the fill pushes the torque at the stop through zero, and it snaps over.
It's the same free-surface destabilisation that capsizes ships (the bucket even has a GM).
