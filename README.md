# Pre-Token Radar

A token launch radar for the make.fun `token-radar-01` bounty. The program
reads the sealed DefiLlama snapshot that ships with the bounty, ranks every
protocol that records no token by an implied launch value, and hands in a
static dashboard a reader can filter, sort and open per protocol.

## Run it

```
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
```

Node 22.18 or later, standard library only, no network. The run is
deterministic: the same snapshot writes the same bytes. It writes
`board.json` (the ranked board), `data.js` (the dashboard's data),
`dashboard/` and `screenshots/` (copied from this repository) and
`dossier.json` (written with the vendored `vendor/makefun-board.ts`, the
kit's own library, byte for byte) into the output directory. Open
`out/dashboard/index.html` in a browser to use the page.

## The board

Of the snapshot's 758 protocols, the radar sets aside every one that already
records a token (or is a wrapped, staked or bridged product of one that
trades, a bridge, an exchange venue, or a later version of a named protocol).
What remains — 197 protocols in this snapshot — are the launch candidates.
All 40 protocols on the snapshot's own watchlist are among them and are
marked on the board; the watchlist is treated as a floor, never a ceiling,
so 157 further candidates below its $50M line are ranked beside them.

## The value model

No protocol name is hardcoded anywhere. Every figure comes from the
snapshot's own fields:

1. **Category comparables.** Protocols whose tokens already trade give, per
   DefiLlama category, a market-cap-to-TVL ratio. The board uses each
   category's median ratio, shrunk toward the global median (0.17 here) by
   the weight n/(n+3), so a category with two traded names cannot be carried
   by one rich comparable. Ratios are clamped to [0.02, 3].
2. **Size-band comparables.** The same traded protocols, cut by TVL size
   instead of category, show a steep pattern: the median multiple is about
   0.31 under $50M of TVL and about 0.03 above $1B. A candidate's band
   median is the second cut, so a $2B protocol is never handed a small-cap
   multiple just because its category holds one rich comparable (one
   category here has a single traded name at 2.97x, another at 400x; the
   band cut is what keeps those from pricing the whole board).
3. **Base value.** A candidate's blended ratio is the evidence-weighted
   geometric mean of its category ratio and its size-band ratio: each cut
   is weighted by the number of traded protocols behind it, so a category
   resting on one traded name moves the blend one part in fifteen against
   a size band resting on fourteen. Its base value is its TVL times that
   blend. Every row's detail view shows both ratios and both counts, and
   the dashboard publishes the two tables in full.
4. **Adjustments**, each computed per protocol and shown in its detail view:
   - *Momentum*: the 7-day TVL change, clamped to [-30%, +50%], applied as
     1 + change/100. Unreported changes stay neutral.
   - *Tokenless age*: years between `listed_at` and the snapshot's `as_of`,
     capped at 5, applied as 1 + 0.06 per year — a protocol that has held
     real TVL for years with no token is a stronger launch candidate than
     one listed last month. Unreported dates stay neutral.
   - *Chain reach*: 1 + 0.03 per additional chain beyond the first, capped
     at six — a launch addresses every chain the protocol already serves.

The product, rounded to whole dollars, is the implied launch value; rank is
its descending order. An implied value is a model's claim about what a token
would be worth if the protocol's record stayed as it is — not a prediction
that a token will launch, and not a promise about any price.

### The pass-through check

The board's largest tokenless TVLs sit with curators and allocators, whose
TVL is other protocols' capital routed onward, so a separate haircut for
those categories was tested against their traded peers before being
rejected:

- **Onchain Capital Allocator** has three traded names, at multiples of
  0.006, 0.019 and roughly zero — a median of 0.006 against a global
  median of 0.169. The discount is real, and it is already the category
  ratio the board uses; cutting the same protocols a second time for
  being allocators would count one fact twice.
- **Risk Curators** has exactly one traded name, at 2.97x — a premium, not
  a discount. There is no traded evidence for a curator haircut at all.

So no category is discounted by name. What the evidence does support is
the weighting in step 3: the curator category's single comparable is heard
once, its size band's fourteen traded names fourteen times, and the
board's top curator lands at the band's multiple rather than the single
name's. The derivation is reproducible from the published tables.

## The farm plans

Every row carries five concrete steps, generated from the protocol's
category playbook and filled with its own name, chains and TVL tier: how to
open a position, the category-specific actions that launch snapshots
actually count (supplied balances, LP positions held over time, repeated
real trades, vault shares held across month boundaries), what the working
capital should be at its size, keeping a dated activity log, and an exit
rule set in advance. Steps name costs and durations, not slogans. All 32
categories on the board have their own playbook — insurance steps buy and
renew a real cover, payment steps route real payments weekly, restaking
steps hold across reward epochs — and no row falls back to a generic plan.

## The dashboard

`dashboard/` is three files — `index.html`, `app.css`, `app.js` — plus the
generated `data.js` the program writes beside it. The board is sortable
(rank, implied value, TVL, 7-day change, watchlist first) and filterable
(search, category, chain, watchlist-only). Each protocol has a detail view
(`#/p/<slug>`) with its value breakdown — TVL, both ratios with the traded
counts behind them, the base value and its three adjustment factors — the
list of traded comparables its category ratio was taken from, and its full
farm plan. Below the board, the page publishes the model's own tables:
every category's traded count, raw median and ratio used, and every size
band's count and median, so the whole model can be re-run from the page.
Filtered views are linkable too (`#/filter/<category>`, `#/watchlist`).
The four screenshots in `screenshots/` are captures of this dashboard
rendering this snapshot: the board, one protocol's detail view, a filtered
view, and the watchlist-only view.

## Layout

- `main.ts` — the entrypoint: snapshot in, board and dossier out.
- `lib/model.ts` — the candidate rule, the value model, the farm plans and
  a mirror of the gate's board checks, so a bad board fails locally.
- `vendor/makefun-board.ts` — the kit's dossier library, byte for byte.
- `dashboard/` — the static page. `screenshots/` — its captures.

MIT licensed; see `LICENSE`.
