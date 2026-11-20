// token-radar-01: the value model, the farm plans and the board checks.
//
// Everything on the board is derived from the sealed snapshot's own figures.
// No protocol name is hardcoded anywhere in this file: the candidate rule, the
// category ratios and the adjustments are all computed from the data the
// snapshot carries, so the same code would rank any snapshot it is handed.
//
// The model, in one paragraph. A protocol that records no token is a launch
// candidate. What its token might be worth at launch is estimated from the
// protocols whose tokens already trade, in two cuts of the same data: the
// median market-cap-to-TVL ratio of the candidate's DefiLlama category
// (shrunk toward the global median when the category has few traded names),
// and the median ratio of the candidate's TVL size band — across the whole
// snapshot, big protocols trade at far lower multiples of TVL than small
// ones, and a $2B protocol must not be handed a small-cap multiple just
// because its category has one rich comparable. The two ratios are blended
// on a log scale, each weighted by the number of traded protocols standing
// behind it, and applied to the candidate's TVL: a cut resting on one name
// moves the price a fifteenth as much as a cut resting on fifteen, so thin
// evidence can inform a value but never carry it. Three adjustments follow,
// each from a field the snapshot carries: seven-day TVL momentum, how long
// the protocol has run with no token (listed_at against the snapshot's
// as_of), and how many chains it reaches. The product, rounded to whole
// dollars, is the implied launch value; rank is its order.
//
// The pass-through question, settled with the snapshot's own numbers. The
// board's largest tokenless TVLs sit with curators and allocators, whose
// TVL is other protocols' capital routed onward, so a separate haircut for
// those categories was tested against their traded peers. The allocator
// category's traded median (0.006 across 3 names) already sits far under
// the global median (0.169) — the discount is inside its category ratio,
// and cutting again would count it twice. The curator category has exactly
// one traded name, at 2.97x — a premium, not a discount. No separate
// haircut is applied; the evidence weighting above is the mechanism that
// keeps the one-name curator cut from pricing the board's top on its own,
// and the dashboard publishes both comparable tables so any reader can
// re-run the argument.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  tvl_usd: number;
  category: string | null;
  chains: string[];
  change_7d: number | null;
  listed_at: string | null;
  watchlist: boolean;
  ratio_used: number;
  category_ratio: number;
  band_ratio: number;
  category_n: number;
  band_n: number;
  base_value_usd: number;
  momentum_factor: number;
  age_factor: number;
  reach_factor: number;
}

export interface Comparable {
  name: string;
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
}

export interface CategoryTableRow {
  category: string;
  traded: number;
  median_ratio: number;
  ratio_used: number;
}

export interface BandTableRow {
  label: string;
  min_usd: number;
  traded: number;
  ratio: number;
}

export interface Radar {
  as_of: string;
  source: string;
  floor_usd: number;
  protocol_count: number;
  watchlist_size: number;
  candidate_size: number;
  live_size: number;
  global_ratio: number;
  category_table: CategoryTableRow[];
  band_table: BandTableRow[];
  comparables: Record<string, Comparable[]>;
  rows: BoardRow[];
}

/** Parse and lightly validate the sealed snapshot; throws on a shape we cannot read. */
export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (typeof raw.as_of !== 'string' || !Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: expected as_of, protocols and watchlist');
  }
  for (const p of raw.protocols) {
    if (typeof p.slug !== 'string' || typeof p.tvl_usd !== 'number') {
      throw new Error('snapshot: a protocol is missing its slug or tvl_usd');
    }
  }
  return raw;
}

// Categories whose protocols are products of a token that already trades, or
// venues that are not launch candidates of their own. The watchlist rule in
// the snapshot's README names the same families; a candidate must also record
// no token, carry no version marker and no wrapped/staked word in its name,
// and not begin with an exchange's name.
const PRODUCT_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** True when the protocol records no token and is not a product of one that trades. */
export function isCandidate(p: Protocol): boolean {
  if (p.gecko_id !== null || p.symbol !== null) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSION_MARKER.test(p.name)) return false;
  const words = p.name.toLowerCase().split(/[^a-z]+/);
  if (words.includes('wrapped') || words.includes('staked') || words.includes('staking')) return false;
  if (EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x))) return false;
  return true;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const RATIO_FLOOR = 0.02;
const RATIO_CAP = 3;

/**
 * The market-cap-to-TVL ratio a category's traded protocols support.
 * Categories with few traded names are shrunk toward the global median, so a
 * single rich comparable cannot carry a whole category on its own. The
 * traded count and the raw median travel with the shrunk ratio: the blend
 * weights each cut by its count, and the dashboard publishes all three.
 */
export function categoryRatios(snapshot: Snapshot): {
  global: number;
  byCategory: Map<string, number>;
  counts: Map<string, number>;
  rawMedian: Map<string, number>;
} {
  const all: number[] = [];
  const perCategory = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    const key = p.category ?? 'Uncategorised';
    const list = perCategory.get(key) ?? [];
    list.push(ratio);
    perCategory.set(key, list);
  }
  const global = median(all);
  const byCategory = new Map<string, number>();
  const counts = new Map<string, number>();
  const rawMedian = new Map<string, number>();
  for (const [key, list] of perCategory) {
    const own = median(list);
    const weight = list.length / (list.length + 3);
    const shrunk = own * weight + global * (1 - weight);
    byCategory.set(key, Math.min(RATIO_CAP, Math.max(RATIO_FLOOR, shrunk)));
    counts.set(key, list.length);
    rawMedian.set(key, own);
  }
  return { global, byCategory, counts, rawMedian };
}

/**
 * The traded protocols behind each category's ratio, richest multiple
 * first, capped so the dashboard's evidence list stays readable. This is
 * the list a reader audits a category ratio against.
 */
export function categoryComparables(snapshot: Snapshot): Record<string, Comparable[]> {
  const perCategory = new Map<string, Comparable[]>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const key = p.category ?? 'Uncategorised';
    const list = perCategory.get(key) ?? [];
    list.push({ name: p.name, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, ratio: round4(p.mcap_usd / p.tvl_usd) });
    perCategory.set(key, list);
  }
  const out: Record<string, Comparable[]> = {};
  for (const key of [...perCategory.keys()].sort()) {
    out[key] = perCategory
      .get(key)!
      .sort((a, b) => b.ratio - a.ratio || (a.name < b.name ? -1 : 1))
      .slice(0, 15);
  }
  return out;
}

// TVL size bands, by lower bound in dollars. Across the snapshot the traded
// protocols' median market-cap-to-TVL ratio falls steeply with size (about
// 0.31 under $50M of TVL, about 0.03 above $1B), so the band a protocol sits
// in is evidence about its multiple in its own right.
const TVL_BANDS: { min: number; label: string }[] = [
  { min: 1_000_000_000, label: 'TVL $1B and up' },
  { min: 250_000_000, label: 'TVL $250M to $1B' },
  { min: 50_000_000, label: 'TVL $50M to $250M' },
  { min: 0, label: 'TVL under $50M' },
];

export function bandOf(tvl: number): number {
  const at = TVL_BANDS.findIndex((b) => tvl >= b.min);
  return at === -1 ? TVL_BANDS.length - 1 : at;
}

/** The median traded ratio inside each TVL band, and the count behind it. */
export function bandRatios(snapshot: Snapshot): { ratios: number[]; counts: number[] } {
  const perBand: number[][] = TVL_BANDS.map(() => []);
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    perBand[bandOf(p.tvl_usd)]!.push(p.mcap_usd / p.tvl_usd);
  }
  return {
    ratios: perBand.map((list) => (list.length === 0 ? 0 : median(list))),
    counts: perBand.map((list) => list.length),
  };
}

/** Whole years between a YYYY-MM-DD day and the snapshot's as_of day, never negative. */
export function yearsListed(listedAt: string | null, asOf: string): number {
  if (listedAt === null) return 0;
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  const end = Date.parse(`${asOf}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0;
  return (end - start) / (365.25 * 24 * 60 * 60 * 1000);
}

const round4 = (x: number): number => Math.round(x * 10_000) / 10_000;

/** The three adjustments, each a multiplier with 1 as its neutral point. */
export function adjustments(p: Protocol, asOf: string): { momentum: number; age: number; reach: number } {
  const change = p.change_7d === null ? 0 : Math.min(50, Math.max(-30, p.change_7d));
  const momentum = 1 + change / 100;
  const age = 1 + 0.06 * Math.min(5, yearsListed(p.listed_at, asOf));
  const reach = 1 + 0.03 * Math.min(6, Math.max(0, p.chains.length - 1));
  return { momentum: round4(momentum), age: round4(age), reach: round4(reach) };
}

function money(usd: number): string {
  if (usd >= 1_000_000_000) return `$${(usd / 1_000_000_000).toFixed(2)}B`;
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(1)}K`;
  return `$${Math.round(usd)}`;
}

type Tier = 'anchor' | 'major' | 'early';

function tierOf(tvl: number, floor: number): Tier {
  if (tvl >= floor) return 'anchor';
  if (tvl >= floor / 5) return 'major';
  return 'early';
}

const TIER_CAPITAL: Record<Tier, string> = {
  anchor: 'Start with $2,000-$5,000 of working capital; at this size smaller tickets earn little after fees.',
  major: 'Start with $500-$2,000 of working capital so gas and spreads stay a small share of the position.',
  early: 'Start with $100-$500 of working capital; early protocols carry contract risk, so size it as a ticket, not a core holding.',
};

/**
 * Five concrete steps per protocol, built from its category's playbook and
 * filled with its own name, chains and TVL tier. Every step names an action,
 * and the set as a whole names what it costs and how long it takes.
 */
export function farmSteps(p: Protocol, tier: Tier): string[] {
  const chain = p.chains[0] ?? 'its main chain';
  const chainList = p.chains.length > 1 ? p.chains.slice(0, 3).join(', ') : chain;
  const tvl = money(p.tvl_usd);
  const open = `Open ${p.name} on ${chain} and connect a wallet you control; it holds ${tvl} of TVL across ${p.chains.length} chain${p.chains.length === 1 ? '' : 's'} (${chainList}).`;
  const track = `Keep a dated log of every deposit, fee and reward in ${p.name}; if a token or points programme is announced, the log is your proof of early use. Review it weekly, 10 minutes.`;
  const exit = `Set an exit rule before you start: withdraw from ${p.name} if its TVL falls 30% from your entry week or if a token launches and your share is worth more than 20x your fees paid.`;
  const byCategory: Record<string, [string, string]> = {
    Dexs: [
      `Provide liquidity to the deepest ${p.name} pool on ${chain} (usually its main stable or ETH pair); LP fees are the position, expect $1-$5 a day per $1,000 at typical volumes.`,
      `Route a real swap through ${p.name} at least twice a week for 6-8 weeks; consistent volume history is what most DEX airdrop snapshots count, and each swap costs under $1 of gas on ${chain}.`,
    ],
    Lending: [
      `Supply a blue-chip asset (ETH or a major stablecoin) to ${p.name} on ${chain} and leave it supplied for at least 30 days; supplied balances are the metric lending launches reward.`,
      `Borrow 30-40% against your supply and loop once, keeping the health factor above 2; the borrow side doubles your footprint for roughly one extra transaction of gas.`,
    ],
    CDP: [
      `Mint the ${p.name} stablecoin against an ETH deposit on ${chain}, keeping collateral at 200% or more so a 30% drawdown cannot liquidate you.`,
      `Hold or deploy the minted stablecoin inside ${p.name}'s own ecosystem for at least 30 days; minted-and-held balances are the footprint CDP launches track.`,
    ],
    Derivatives: [
      `Trade small, real positions on ${p.name} two or three times a week for 6 weeks; open interest and trade count are what derivatives launches snapshot, and $100 of margin is enough to register.`,
      `Post margin on ${chain} and keep one position open over each weekly boundary; time-weighted margin is harder to fake and is usually weighted more than raw volume.`,
    ],
    Yield: [
      `Deposit into the flagship ${p.name} vault on ${chain} and hold the vault shares untouched for at least 30 days; vault age is the cheapest signal to earn.`,
      `Claim and re-deposit every reward the vault pays, weekly; compounding in-protocol keeps your balance visible in its own accounting the whole time.`,
    ],
    'Yield Aggregator': [
      `Deposit into the flagship ${p.name} vault on ${chain} and hold the vault shares untouched for at least 30 days; vault age is the cheapest signal to earn.`,
      `Claim and re-deposit every reward the vault pays, weekly; compounding in-protocol keeps your balance visible in its own accounting the whole time.`,
    ],
    RWA: [
      `Complete ${p.name}'s onboarding on ${chain} early, including any KYC it asks for; verified accounts are a fixed, small set and launches reward them first. Budget one hour.`,
      `Hold the smallest qualifying RWA position in ${p.name} for a full quarter; RWA launches weight duration and account age over size.`,
    ],
    Chain: [
      `Bridge a small amount to ${p.name}'s chain and make it your active chain for a month: swaps, one NFT mint and one contract deployment if you can, each under $1 of gas.`,
      `Hold a balance on the chain across at least four weekly boundaries; chain launches snapshot active addresses and balance duration, not one-day tourists.`,
    ],
    Launchpad: [
      `Register on ${p.name} and complete one small participation end to end; a completed allocation, even a tiny one, puts your wallet in its participant set.`,
      `Stay active on ${p.name} across three separate launches rather than one large one; breadth of participation is the footprint launchpads can verify.`,
    ],
    Privacy: [
      `Make a small shielded deposit into ${p.name} on ${chain} and leave it for at least 30 days; shielded balances held over time are the usage privacy launches can count without exposing you.`,
      `Use one private transfer or withdrawal a week for a month; repeated real use, not a single deposit, is what separates users from sybil wallets.`,
    ],
    'Risk Curators': [
      `Deposit into the highest-TVL vault ${p.name} curates on ${chain} and hold the vault shares for at least 30 days; a curator's launch counts its vault depositors, and the vault's own yield is your carry while you wait.`,
      `Add a second, smaller deposit into a different ${p.name} vault, ideally on another of its ${p.chains.length} chains; depositors across several vaults are the set a curator can verify with no points programme at all.`,
    ],
    'Onchain Capital Allocator': [
      `Allocate into ${p.name}'s main strategy on ${chain} and leave the allocation untouched for a full quarter; allocator launches weight capital that stayed through a whole cycle.`,
      `Add a second allocation after 30 days instead of one large deposit on day one; a two-date deposit history reads as a user, not a snapshot tourist.`,
    ],
    'Prediction Market': [
      `Trade small positions in ${p.name}'s most liquid markets two or three times a week for 6 weeks; resolved-market volume from real, returning accounts is what prediction launches snapshot.`,
      `Hold one position to resolution every month and keep a platform balance across market cycles; a settled history plus balance duration is the footprint that can be verified.`,
    ],
    'Basis Trading': [
      `Open the flagship basis position in ${p.name} on ${chain} at a size you can hold for 60 days; basis launches count time in position, and closing early resets the clock.`,
      `Rebalance only when the interface asks you to; every extra transaction is gas, and the position's age, not its trade count, is the signal being farmed.`,
    ],
    Indexes: [
      `Buy and hold the main ${p.name} basket on ${chain} for at least 60 days; index launches reward holders of record across repeated snapshots.`,
      `Add to the position monthly in equal steps; a ladder of buys across three months is a holder history no single-day purchase can fake.`,
    ],
    'Liquidity Manager': [
      `Deposit into an actively managed ${p.name} vault on ${chain} and hold the shares for at least 30 days; managed-vault depositors are the set a manager's launch can count.`,
      `Keep the position through one full rebalance cycle of the vault; staying through rebalances is the behaviour that separates LPs from tourists.`,
    ],
    'Uncollateralized Lending': [
      `Complete ${p.name}'s lender onboarding, including any KYC it asks for, before depositing a cent; verified lenders are a small fixed set and are counted first. Budget one hour.`,
      `Lend into one pool on ${chain} and leave the loan to maturity; loans held to term, not deposits withdrawn early, are the footprint these launches verify.`,
    ],
    'Staking Pool': [
      `Stake a small amount through ${p.name} on ${chain} and leave it staked across at least two reward epochs; staked duration is the metric pool launches use.`,
      `Claim your rewards inside ${p.name} rather than through a third party; in-protocol claims keep your whole staker history in one verifiable place.`,
    ],
    'Anchor BTC': [
      `Deposit bitcoin (or the wrapped BTC ${p.name} accepts) as collateral on ${chain} and borrow against it at no more than half the maximum loan-to-value; BTC collateral held through a full month is the usage these launches count.`,
      `Keep the position through at least two weekly epochs and top the collateral up whenever BTC falls 10%; an unbroken collateral record, not the position's size, is the footprint that survives a snapshot.`,
    ],
    'CDP Manager': [
      `Open a managed CDP vault in ${p.name} on ${chain} with an ETH or BTC deposit and let the manager run it; a vault that stays open and managed for 30 days is the position its launch can verify.`,
      `Check the vault's collateral ratio weekly and add collateral before it drifts near the manager's floor; surviving one market dip inside the vault is the behaviour that separates users from tourists.`,
    ],
    CeDeFi: [
      `Complete ${p.name}'s registration and KYC before depositing a cent; verified accounts are a fixed, small set and are counted first at any launch. Budget one hour for onboarding.`,
      `Deposit into one ${p.name} yield product on ${chain} and hold it to its full term, at least 30 days; terms completed, not deposits churned, are the record CeDeFi launches reward.`,
    ],
    'Collateral Markets': [
      `Supply a blue-chip collateral asset to ${p.name} on ${chain} and leave it supplied for at least 30 days; supplied collateral balances are the metric these markets snapshot.`,
      `Borrow a small amount against your collateral once and repay it inside the same month; one completed borrow-and-repay cycle proves you used the market, not just parked in it.`,
    ],
    'Crypto Card Issuer': [
      `Order and activate the ${p.name} card and make it your card for everyday spend for a month; a real transaction history is the one record a card issuer's launch cannot be faked into cheaply.`,
      `Keep a balance in your ${p.name} account across at least two monthly boundaries and spend at least once a week; balance duration plus spend cadence is the footprint card launches weight.`,
    ],
    'Decentralized BTC': [
      `Deposit a small amount of BTC into ${p.name} on ${chain} to mint or hold its decentralised BTC asset, and hold it for at least 30 days; minted supply held over time is the usage that counts.`,
      `Use the BTC asset once inside ${p.name}'s own ecosystem, a swap or a liquidity deposit, rather than only holding it; one in-ecosystem transaction a month marks you as a user, not a minter who left.`,
    ],
    'Dual-Token Stablecoin': [
      `Mint or buy the ${p.name} stablecoin on ${chain} and hold it for at least 30 days; stablecoin balances held across snapshots are the footprint a dual-token launch rewards on the stable side.`,
      `Take a small position in the system's second token or its staking contract inside ${p.name} itself and hold both legs together for a full month; holding both sides of the system is the rarest, most verifiable user record it keeps.`,
    ],
    Farm: [
      `Deposit into one ${p.name} farm on ${chain} and leave the position farming for at least 6 weeks; time in the farm, across several harvest cycles, is what farm launches snapshot.`,
      `Harvest your rewards weekly and re-deposit them into the same farm; a compounding record inside ${p.name}'s own accounting is visible proof you farmed it, not parked once.`,
    ],
    'Governance Incentives': [
      `Take the position ${p.name} pays incentives on, on ${chain}, and hold it through at least one full incentive epoch; epochs completed are the unit these programmes count.`,
      `Claim every incentive inside ${p.name} itself and vote in any governance poll that opens while you hold; claims plus votes are the two records an incentives launch can verify without trusting anyone.`,
    ],
    Insurance: [
      `Buy one small, real cover policy through ${p.name} on ${chain} and hold it to expiry; a paid premium held to term is a customer record no sybil farm can fake at scale. Budget the premium itself as the cost of the farm.`,
      `Renew the cover once when it expires instead of letting it lapse; two consecutive cover periods read as a customer, and underwriters in ${p.name}'s pools are counted on the other side of the same record.`,
    ],
    'Interest Rate Derivatives': [
      `Open a small interest-rate position on ${p.name}, a swap or a fixed-rate leg, and hold it across one rate fixing or reset date; positions alive at a fixing are what rate markets snapshot.`,
      `Trade a second, opposite-tenor position in a later week rather than enlarging the first; two dated positions across the curve read as a rates user, not a one-off ticket.`,
    ],
    'Leveraged Farming': [
      `Open a small leveraged position in ${p.name} on ${chain} at no more than 2-3x and size it so a 20% adverse move cannot liquidate you; the position, held, is the farm.`,
      `Hold the position through at least two funding or reward cycles and top up collateral instead of closing when it wobbles; leveraged positions that survive a full cycle are the set these launches can verify.`,
    ],
    'OTC Marketplace': [
      `Complete one small OTC trade end to end on ${p.name}, quote to settlement; a settled trade, even a tiny one, puts your wallet in its verified trader set.`,
      `Come back for a second and third trade in separate weeks rather than splitting one trade into pieces; distinct, dated settlements are the history an OTC launch can count.`,
    ],
    Payments: [
      `Route real payments through ${p.name} at least once a week for 6 weeks, paying for things you would buy anyway; dated payment volume from a returning account is the record payment launches snapshot.`,
      `Keep a working balance in ${p.name} across at least two monthly boundaries; balances that stay, not balances that pass through on snapshot day, are what separates users from farmers.`,
    ],
    Restaking: [
      `Restake a small amount through ${p.name} on ${chain} and leave it restaked across at least two reward epochs; restaked duration is the metric these launches are built on.`,
      `Claim every reward inside ${p.name} rather than through a third party, and re-restake it; a claim-and-restake record keeps your whole history in the protocol's own accounting.`,
    ],
    'Stablecoin Wrapper': [
      `Wrap a major stablecoin into ${p.name}'s wrapped version on ${chain} and hold the wrapped balance for at least 30 days; wrapped supply held over time is the usage these launches count.`,
      `Deploy part of the wrapped balance inside ${p.name}'s own ecosystem, its vault or its main pool, and keep it there across two monthly boundaries; a wrapper that circulates at home is worth more to its launch than one that only sits.`,
    ],
  };
  const pair = byCategory[p.category ?? ''] ?? [
    `Use ${p.name}'s core product on ${chain} with real funds at least once a week for 6 weeks; regular, dated activity is the footprint every launch snapshot can verify.`,
    `Hold your position in ${p.name} across at least two monthly boundaries; duration is the signal that costs farmers the most and is weighted accordingly.`,
  ];
  return [open, pair[0], pair[1], TIER_CAPITAL[tier] + ' ' + track, exit].map((s) => s.trim());
}

/** Build the ranked board and the radar summary the dashboard renders. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: Radar } {
  const { global, byCategory, counts, rawMedian } = categoryRatios(snapshot);
  const bands = bandRatios(snapshot);
  const watch = new Set(snapshot.watchlist);
  const rows: BoardRow[] = [];
  let live = 0;
  for (const p of snapshot.protocols) {
    if (!isCandidate(p)) {
      live += 1;
      continue;
    }
    const key = p.category ?? 'Uncategorised';
    const catRatio = byCategory.get(key) ?? global;
    const bandIdx = bandOf(p.tvl_usd);
    const bandRatio = bands.ratios[bandIdx] || global;
    const catN = counts.get(key) ?? 0;
    const bandN = bands.ratios[bandIdx] > 0 ? bands.counts[bandIdx]! : 0;
    // Evidence-weighted blend of the two cuts: a ratio is a multiple, so
    // its average belongs on a log scale, and each cut speaks in proportion
    // to the traded protocols behind it. A category resting on one name
    // (the curator category here) is heard, but the size band's fourteen
    // names speak fourteen times louder; a cut with no names behind it
    // falls silent and the other decides alone.
    let blended: number;
    if (catN > 0 && bandN > 0) {
      blended = Math.exp((catN * Math.log(catRatio) + bandN * Math.log(bandRatio)) / (catN + bandN));
    } else if (catN > 0) {
      blended = catRatio;
    } else if (bandN > 0) {
      blended = bandRatio;
    } else {
      blended = global;
    }
    const ratio = Math.min(RATIO_CAP, Math.max(RATIO_FLOOR, blended));
    const base = p.tvl_usd * ratio;
    const adj = adjustments(p, snapshot.as_of);
    const implied = Math.max(1, Math.round(base * adj.momentum * adj.age * adj.reach));
    rows.push({
      slug: p.slug,
      name: p.name,
      rank: 0,
      implied_value_usd: implied,
      farm_steps: farmSteps(p, tierOf(p.tvl_usd, snapshot.floor_usd)),
      tvl_usd: p.tvl_usd,
      category: p.category,
      chains: p.chains,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      watchlist: watch.has(p.slug),
      ratio_used: round4(ratio),
      category_ratio: round4(catRatio),
      band_ratio: round4(bandRatio),
      category_n: catN,
      band_n: bandN,
      base_value_usd: Math.round(base),
      momentum_factor: adj.momentum,
      age_factor: adj.age,
      reach_factor: adj.reach,
    });
  }
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
  rows.forEach((row, i) => {
    row.rank = i + 1;
  });
  const categoryTable: CategoryTableRow[] = [...byCategory.keys()].sort().map((key) => ({
    category: key,
    traded: counts.get(key) ?? 0,
    median_ratio: round4(rawMedian.get(key) ?? 0),
    ratio_used: round4(byCategory.get(key)!),
  }));
  const bandTable: BandTableRow[] = TVL_BANDS.map((band, i) => ({
    label: band.label,
    min_usd: band.min,
    traded: bands.counts[i]!,
    ratio: round4(bands.ratios[i] || global),
  }));
  const radar: Radar = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    protocol_count: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    candidate_size: rows.length,
    live_size: live,
    global_ratio: round4(global),
    category_table: categoryTable,
    band_table: bandTable,
    comparables: categoryComparables(snapshot),
    rows,
  };
  return { board: rows, radar };
}

/** The dashboard's data file: the whole radar as one deterministic script. */
export function dataScript(radar: Radar): string {
  return `window.RADAR_DATA = ${JSON.stringify(radar)};\n`;
}

/** Mirror of the gate's board rows, so a bad board fails here before it ships. Returns the issue or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100 to 4000`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const row of board) {
    if (!slugs.has(row.slug)) return `row names a protocol the snapshot does not: ${row.slug}`;
    if (seen.has(row.slug)) return `slug appears twice: ${row.slug}`;
    seen.add(row.slug);
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0) return `bad implied value on ${row.slug}`;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `farm_steps count off on ${row.slug}`;
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `farm step of ${len} characters on ${row.slug}`;
    }
  }
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist protocol missing from the board: ${slug}`;
  }
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 0; i < byRank.length; i += 1) {
    if (byRank[i]!.rank !== i + 1) return 'ranks are not exactly 1 to N';
    if (i > 0 && byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return 'implied value rises as rank ascends';
  }
  return null;
}
