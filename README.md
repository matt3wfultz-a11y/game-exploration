# The Warden

A tiny top-down dungeon crawler with one twist: **the dungeon is the opponent.**

You play the hero. The dungeon watches how you fight — where you stand, how far
you keep away, how often you mash the sword, which lane you walk down — and then
builds the next room specifically to punish *that*. Then it tells you it did.

Eight rooms. Get out.

## Run it

Open `index.html` in a browser. That's it — no build step, no server, no
dependencies. Edit a number in `src/config.js`, hit reload, feel the difference.

(If you'd rather serve it: `npx serve .` — but you don't need to.)

## Controls

| | |
|---|---|
| `WASD` / arrows | move |
| mouse | aim |
| left click | swing |
| `Shift` / `Space` | dash — brief invulnerability, this is your defense |

## The complete loop

The point of this project was to finish an *entire* game loop rather than a pile
of disconnected mechanics. Every arrow here is implemented:

```
TITLE ──▶ CARD ──▶ ROOM ──clear──▶ CARD ──▶ ROOM ──▶ … ──▶ ESCAPE (win)
             ▲       │
             └───────┘
                     └──── hp = 0 ────▶ DEAD (+ dossier) ──▶ TITLE
```

Win state, lose state, persistence (`localStorage` best depth), and a summary
screen that pays off the run. A game is the loop, not the combat.

## How the Warden works

`src/director.js` is the file worth reading. It runs a four-step cycle:

**1. Observe** (`tick`, every frame) — samples distance to the nearest enemy,
whether you're moving, how close you are to a wall, and it increments a heat
value on whatever floor tile you're standing on.

**2. Profile** (`endRoom`) — folds one room's samples into six normalized 0–1
traits using an exponential moving average, so it tracks how you're playing
*now* instead of being anchored to your first nervous minute.

**3. Counter** (`planRoom`) — spends an enemy budget on whichever types punish
your strongest habits, and lays spike plates on the floor tiles with the
highest heat. Each enemy exists to punish one specific habit:

| enemy | punishes | how |
|---|---|---|
| grunt | nothing | baseline pressure |
| charger | **kiting** | telegraphs, then crosses 300px faster than you can back up |
| bomber | **brawling** | kill it at melee range and it takes you with it |
| caster | **standing still** | free shots at anything that stops moving |

**4. Confess** (`_speak`) — states its read on the between-room card and
whispers a taunt when you enter.

That fourth step is not decoration. An adaptive system a player can't perceive
is indistinguishable from random noise, and they will never give it credit.
Announcing the read is what turns "the game got harder" into "it is doing this
to *me*."

Measured behaviour across 300 simulated runs per player type:

| simulated player | Warden's read | dominant counter | traps in their lane |
|---|---|---|---|
| kites at range | `ranged` | 53% chargers | 87% |
| fights up close | `melee` | 51% bombers | 87% |
| plants feet, hugs walls | `wallHug` | 41% casters | 87% |

## Fairness is the actual design problem

An unbeatable adversary takes about ten minutes to write and nobody wants to
play it. The interesting constraint is being *maximally* mean while staying
winnable. The clamps are deliberate and marked `FAIRNESS` in the source:

- **`minSpawnDist`** — nothing ever spawns on top of you
- **`maxConcurrent`** — a hard ceiling on simultaneous enemies
- **charger `telegraph`** — it freezes and flashes before dashing; that pause is
  your entire counterplay window
- **random trap phases** — spikes never form a permanent wall, so there's always
  a timing that gets you through
- **mercy** — enter two rooms in a row nearly dead and the budget drops 38%

Delete the mercy rule and the game gets technically harder and substantially
worse. That trade is the lesson.

## Where to tune

`src/config.js` holds every number that defines how the game feels. Start there,
change one value, reload. The three with the biggest effect on feel:

- `hero.accel` — high is snappy, low is floaty
- `fx.hitStop` — freeze frames on impact; try `0` then `0.09` and feel the gap
- `warden.learnRate` — how aggressively the dungeon chases your latest room

## Files

```
index.html          canvas + script tags in dependency order
src/config.js       all tuning values
src/util.js         math helpers
src/fx.js           particles, screen shake, hit-stop, floating text
src/input.js        keyboard/mouse, held-vs-pressed
src/room.js         tile grid, layout gen, collision, traps, door
src/hero.js         movement, sword, dash, damage
src/enemies.js      four enemy types + explosion logic
src/director.js     ← the Warden
src/game.js         state machine, fixed-timestep loop, rendering
```

Plain `<script>` tags rather than ES modules is a deliberate choice: it means
`index.html` opens straight off the filesystem, which keeps the edit → reload
loop as short as physically possible. Swap to modules when the project outgrows
it.

## Where to take it next

Roughly in order of payoff per hour:

1. **Sound.** Nothing on this list will do more for how the game feels. Three
   `WebAudio` oscillator blips — swing, hit, hurt — no asset files needed.
2. **Make the sword a decision.** Right now mashing is fine. Add a brief
   recovery window after a whiff and combat becomes a rhythm you can lose.
3. **Let the player counter-adapt.** Show the Warden's live read in the HUD
   mid-room. Now the loop closes both ways: it reads you, you read it reading
   you, you bait it. This is the highest-ceiling idea in the project.
4. **A between-room upgrade draft.** Three cards, pick one. Instantly gives runs
   a shape and gives the Warden more habits to read.
5. **More tells.** It currently ignores whether you clear the room clockwise,
   which enemy type you kill first (`killOrder` is tracked but unused), and
   whether you panic-dash at low HP.
6. **A real boss in room 8** built entirely from your profile — every attack it
   has punishes something the dossier says you do.
7. **Persist the profile across runs.** Start a new run and have it open with
   "You again. Still hugging the walls?" — nothing else on this list produces a
   reaction like that one.
