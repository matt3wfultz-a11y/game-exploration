# Pest Control — art asset list

Everything the game currently draws with code, and what it would take to
replace with real art. Sizes and states are taken from the actual draw calls,
not estimated.

Nothing here is required for the game to run — it works today. This is the list
for making it look like a product.

---

## Technical constraints

| | |
|---|---|
| Tile size | **40 × 40 px** |
| Board | 24 × 16 tiles = 960 × 640 px |
| Full canvas | 960 × 780 (44px HUD strip on top, 96px build bar below) |
| View | Top-down orthographic, no perspective, no isometric |
| Scaling | Canvas is drawn at 1× and CSS-scaled to fit, so art should be authored at 1× (40px tiles) or exactly 2× (80px) for crispness |
| Format | PNG with alpha. Sprite sheets preferred, one sheet per subject |
| Anchor | Tiles: top-left. Characters: **bottom-centre** (they have a drawn ground shadow) |

### Two rules the art must not break

1. **Traps have to read as armed vs spent, and known vs unknown.** The game
   dims a trap while it's recharging and marks it once the hero has mapped it.
   Both carry rules information — "which of my traps still work" is a decision
   the player makes every build phase. Whatever replaces the current dimming
   and X-mark has to be just as readable at a glance.
2. **Sprites get tinted and alpha-faded at runtime** (hit flashes, spawn fades,
   ghost previews, spent-trap dimming). Keep shading fairly flat and avoid
   baking glow or heavy highlights into the sprite, or the tints will look
   muddy.

### Existing palette

Match these or deliberately replace the whole set — don't half-migrate.

| Role | Hex | | Role | Hex |
|---|---|---|---|---|
| Floor | `#1c2130` | | Hero | `#f2e9d8` |
| Floor alt | `#191e2b` | | Vault / gold | `#f0c05a` |
| Bedrock | `#2b3243` | | Entrance | `#5f6b8a` |
| Bedrock lit face | `#3a4356` | | Danger / bad | `#e0455f` |
| Player wall | `#4a5268` | | Good | `#8ee06f` |
| Spikes | `#c8506a` | | Dart trap | `#57b0a8` |
| Goblin | `#7fae4f` | | Brute | `#b8683c` |
| Snare | `#9c8759` | | Shrieker | `#d46fa8` |

---

## Tier 1 — replaces all the programmer art

About **80 frames.** This alone would make it look like a different game.

### Terrain

| Asset | Size | Frames | Notes |
|---|---|---|---|
| Floor tiles | 40×40 | 4–6 variants | Currently a two-tone checkerboard. Variants should be subtle — this is background, the pieces on top must stay readable |
| Bedrock wall | 40×40 | 1 + lit top edge | Minimum viable. A 16-tile bitmask set (or full 47-tile blob set) looks far better where rock meets floor — worth it if you have the patience |
| Player-built wall | 40×40 | 1 + lit top edge | **Must read as clearly different from bedrock** — one you placed and can sell back, one you can't touch |
| Entrance, open | 40×40 | 1 | Where he walks in |
| Entrance, barred | 40×40 | 1 (+2 slam frames) | The portcullis drops 2s into each wave. A slam animation would sell the moment he loses his exit |
| Vault | 40×40 | 1 + 2–3 glint | The thing you're protecting. Should look worth stealing |

### Traps and monsters

| Asset | Size | Frames | Notes |
|---|---|---|---|
| Spikes | 40×40 | retracted, extended, + 3 pop | Two states are mandatory (armed / spent) |
| Dart trap | 40×40 | **4 facings × 2** = 8 | Idle and firing, for each of E/S/W/N. Player aims these with `R`, so the facing must be unmistakable |
| Snare | 40×40 | armed, sprung | Deals no damage — should look like rope/wire, not a blade |
| Shrieker | 40×40 | idle + 3 scream | Screaming frame wants to feel loud |
| Goblin | ~32×32 (r=11) | idle 2, walk 4, attack 3, death 4 | Small, fast, expendable. Faster than the hero — should look it |
| Brute | ~40×40 (r=14) | idle 2, walk 4, attack 3, death 4 | Slow, heavy, blocks corridors |
| Dart projectile | 12×4 | 1 + 3 impact | Rotates in code |

Monsters currently draw without facing. **Left/right flip is the cheap win**;
4-direction sets are better but double the frame count.

### The hero

The most-watched thing on screen — he's what the player stares at during every
run. Worth the largest share of the budget.

| Asset | Size | Frames | Notes |
|---|---|---|---|
| Body — idle | ~28×32 (r=12) | 2 | |
| Body — walk | | 6 | |
| Body — attack | | 4 | Sword swing |
| Body — death | | 6 | The payoff moment of the entire game. Make it good |
| Body — drink potion | | 3 | |
| Body — snared | | 2 | Struggling in place |

**Four archetypes** (Squire, Scout, Knight, Zealot) need to be distinguishable
at a glance, because knowing which one is coming changes how you read the run.
Cheapest approach that still works: one rig, four palette swaps plus a
silhouette-changing accessory (Knight bulkier, Scout lighter, Zealot hooded).

**Three loadout overlays** — Ironshod Boots, Kite Shield, Whetstone. Small
attachments drawn over the body. These tell the player what counter he brought,
so they need to be visible at 40px.

---

## Tier 2 — interface

The game is half spreadsheet: a build phase, a draft, a shop. UI art moves the
needle here as much as sprites do.

| Asset | Size | Count | Notes |
|---|---|---|---|
| Build palette icons | 32×32 | 7 | One per placeable — wall, spikes, dart, goblin, brute, snare, shrieker |
| Relic icons | 48×48 or 64×64 | **17** | One per relic. Grouped by 5 tags: traps, monsters, building, control, economy — tag-consistent framing or colour helps the draft read fast |
| Relic card frame | 266×260 | 1 (+hover) | Draft cards |
| Warren upgrade icons | 40×40 | 6 | 2 new pieces, 4 perks |
| Treasure pip | 16×16 | 2 | Full and lost — this is the life counter |
| Currency icons | 16×16 | 2 | Gold, Dread |
| Buttons | — | 3 | *Send Him In*, speed toggle, back |
| Ghost placement overlay | 40×40 | 2 | Valid / invalid tint |
| Hero portraits | 96×96 | 4 | One per archetype, for the wave card. Small asset, big personality return |
| Wordmark / title logo | — | 1 | |
| Display typeface | — | 1 | Currently system fonts. A single display face for titles and cards would do more than any individual sprite |

---

## Tier 3 — atmosphere

Only after the above. Diminishing returns, but this is where it stops looking
like a prototype with nice sprites and starts looking authored.

- **FX sheets** to replace the code-drawn squares: hit spark, dust puff, blood,
  explosion ring, "spotted" flash, heal sparkle, Dread wisp
- **Decorative floor props** — bones, rubble, puddles, chains, old torches.
  Scattered non-interactive, purely to make generated layouts feel built rather
  than emitted
- **Lighting pass** — a soft vignette and torch pools would flatter every other
  asset on this list
- **Wall variants** — mossy, cracked, bloodstained, so a 24×16 grid of rock
  doesn't repeat visibly
- **Vault animation** — coins spilling as he loots it

---

## Suggested order

1. **Floor + both wall types.** Everything sits on these, and they're 60% of
   the pixels on screen.
2. **The hero.** Most-watched sprite in the game.
3. **Goblin and brute.** The other things that move.
4. **The seven traps and pieces.** Preserve armed/spent and known/unknown.
5. **Palette icons + relic icons.** The build bar and draft screen are where
   half the play time goes.
6. **Portraits, wordmark, display font.** Cheap identity.
7. Everything in Tier 3.

## If you're commissioning this

The whole Tier 1 + Tier 2 list is roughly **80 sprite frames and 40 UI pieces**
— a small but real commission. If you want to test the look before committing,
the cheapest meaningful slice is **floor + bedrock + player wall + hero walk
cycle**. That's about 15 frames and it will tell you immediately whether the
direction works, because those four assets cover most of what you look at.

Keep `src/config.js` as the source of truth for sizes: if a tile size or entity
radius changes there, this document is wrong and the code is right.
