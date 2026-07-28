# game-exploration

Small, complete games — each one finishable in a sitting, each one with a real
beginning and end. Open `index.html` to pick one. No build step, no server, no
dependencies.

| | |
|---|---|
| **[Pest Control](games/pest-control/)** | You are the dungeon. An AI hero tries to get through. |
| **[The Warden](games/warden/)** | You are the hero. The dungeon studies you. *(earlier prototype)* |

## Sharing it

Three options, cheapest first.

**Send someone a file.** `node build.js` writes `dist/pest-control.html` — one
self-contained file, ~76 KB, no dependencies. Email it, drop it in a chat,
put it on a USB stick. They double-click it and it runs, offline, forever. This
is the most durable way to hand someone a small game.

**A public link (GitHub Pages).** `.github/workflows/pages.yml` builds and
deploys the picker page and both games on every push. It needs one manual
switch flipped first, once:

> repo **Settings → Pages → Build and deployment → Source: GitHub Actions**

After that, pushing publishes to
`https://<your-username>.github.io/game-exploration/`. Anyone can open it — no
account, no install. If nothing appears, check the **Actions** tab; the first
run has to finish before the URL exists.

**Anything that hosts a static folder** works too, since there's no build step
and no server: drag the repo folder onto Netlify Drop, or use Cloudflare Pages,
Vercel, or `npx serve .` on your own machine.

---

# Pest Control

**You are the dungeon. He is the problem.**

Spend gold on walls, traps and monsters. Hit *Send Him In* and an AI adventurer
walks into your level and plays it — pathfinding to your vault, fighting your
goblins, eating your spikes. Kill him and you keep the treasure. Lose five
treasures and the dungeon falls. Hold for eight waves and you win.

The catch: **he remembers.** Traps are invisible until they fire once. After
that he routes around them permanently, and he comes back wearing whatever
counters the thing that hurt him most. A dungeon that stops changing is a
dungeon he solves.

## Controls

| | |
|---|---|
| `1`–`5` or click the palette | pick what to build |
| left click | place · right click | salvage (85% refund) |
| `space` | send him in |
| left click a trap **during a run** | spring it by hand — your only live control |
| `Tab` / `F` | run speed (1× / 2× / 4×) |

## How the hero works

`games/pest-control/src/hero.js` and `memory.js` are the two files worth
reading. The state machine is deliberately dumb — travel, fight, flee — and
almost all of the apparent intelligence comes from one place: **the cost map it
hands to A\*.**

Remembered pain, discovered traps, and visible monsters are all just added
movement cost. There is no "avoid the spikes" branch anywhere in the code.
Encode preferences as costs and let the planner be clever; you get emergent
behaviour instead of a pile of `if` statements you'll be debugging forever.

Three things survive between waves:

- **`danger[]`** — per-tile record of where he got hurt, fed straight into the
  pathfinder. Pain bleeds to neighbouring tiles, so he learns *corridors*, not
  squares.
- **`known`** — trap tiles he has discovered. Permanent while the trap is
  there, forgotten if you pick it back up.
- **`source{}`** — how much damage each thing has dealt him, which picks the
  equipment he arrives in: Ironshod Boots (traps ×0.55), Kite Shield
  (monsters ×0.65), or Whetstone & Draught.

Verified: taught that six tiles on his route hurt, he replans and uses **zero**
of them while finding an equally short path.

## What the balance pass actually found

Worth writing down, because the bugs were design bugs and none of them were
visible from reading the code:

1. **He could never be killed.** The hero moves at 74; goblins moved at 62 and
   brutes at 40. He was faster than everything in the game, so retreating was a
   guaranteed escape and `killed` literally never occurred in 160 simulated
   waves. Fixed twice over: goblins are now *faster than he is*, and the
   entrance bars itself two seconds after he enters. You're a dungeon — of
   course the door shuts behind him.

2. **A death spiral.** Dead monsters stayed dead and losing a wave paid almost
   nothing, so one bad wave stripped your dungeon *and* your income. Now your
   garrison is permanent and revives between waves. This is the single most
   important number in the game: it makes the game about **placement** rather
   than attrition.

3. **Trap relocation — the main verb — was a trap itself.** Old trap tiles
   stayed "known" forever, so the map silently filled with scar tissue and
   moving a trap was worse than never placing it. He now forgets a tile once
   the trap is gone.

4. **A skill cliff, not a curve.** A perfect simulated player won 100% of runs;
   the same player with 15% sloppiness won 0%. Raising treasures from three to
   five converted a pass/fail exam into an actual difficulty gradient.

Current state: a perfect bot wins but limps home with 1 of 5 treasures; a
sloppy one wins about 30% of runs. **This has never been played by a human** —
if it feels wrong, `hero.hpGrowth` and `BOUNTY_BASE` are the two knobs.

## Where to take it next

Roughly in order of payoff:

1. **Sound.** Still the highest value-per-hour thing you can add to any game.
2. **Show his intent during the build phase** — draw the route he'd currently
   take. It turns building from guesswork into a conversation.
3. **Let traps combo.** A snare that holds him on a spike tile is worth more
   than either alone, and combos are where build variety comes from.
4. **More equipment, and let him pick badly.** A hero who over-corrects for
   last wave is exploitable — bait him into the wrong loadout.
5. **Named heroes with different personalities** — one greedy, one cautious,
   one that beelines the vault. Right now every wave is the same man.
6. **Persist his memory across whole runs.** "You again. Still using spikes?"

---

# The Warden *(earlier prototype)*

The same idea pointed the other way: you play a hero through eight rooms, and
an adversarial director profiles how you fight — range, footwork, how hard you
mash attack, which lane you walk — then builds each next room to punish it.
Kite everything and it sends chargers; brawl and it sends bombers; stand still
and it sends casters. Spikes get laid on the floor tiles you personally walk on.

Measured across 300 simulated runs per player type: kiters draw 53% chargers,
brawlers 51% bombers, wall-huggers 41% casters, with ~87% of traps landing in
the player's own lane.

Its lesson carried directly into Pest Control: **an adaptive system the player
can't perceive is indistinguishable from random noise.** Both games make the AI
announce what it noticed. That's what turns "it got harder" into "it is doing
this to *me*."

---

## Repo layout

```
index.html            picker
build.js              bundles a game into one self-contained file
games/pest-control/   the main game
games/warden/         the earlier prototype
  src/config.js       every tuning value lives here — start here
  src/…
```

Each game is self-contained and duplicates a little glue (`util.js`, `fx.js`)
on purpose, so you can hack on one without touching the other.

Plain `<script>` tags rather than ES modules is also deliberate: it means the
games open straight off the filesystem with no dev server, which keeps the
edit → reload loop as short as physically possible.

`node build.js` writes single-file builds to `dist/` (gitignored) for sharing
or uploading somewhere like itch.io.
