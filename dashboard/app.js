// Pre-Token Radar dashboard: renders window.RADAR_DATA (written by main.ts
// beside this page as ../data.js). No network, no framework: filtering,
// sorting and the detail view all run on the rows the program ranked.
//
// Routes (hash only, so the page works from a file):
//   #/                 the board
//   #/filter/<cat>     the board with a category chosen
//   #/p/<slug>         one protocol's detail view on its own

const DATA = window.RADAR_DATA;
const rows = DATA.rows;
const bySlug = new Map(rows.map((r) => [r.slug, r]));

const $ = (id) => document.getElementById(id);
const els = {
  stats: $('stats'), q: $('q'), cat: $('cat'), chain: $('chain'), sort: $('sort'),
  wl: $('wl'), count: $('count'), body: $('rows'), detail: $('detail'), foot: $('foot-note'),
  catRows: $('cat-rows'), bandRows: $('band-rows'), tablesNote: $('tables-note'),
};

function money(usd) {
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(2)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(1)}M`;
  if (usd >= 1e3) return `$${(usd / 1e3).toFixed(1)}K`;
  return `$${Math.round(usd)}`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function yearsListed(row) {
  if (!row.listed_at) return null;
  const days = (Date.parse(`${DATA.as_of}T00:00:00Z`) - Date.parse(`${row.listed_at}T00:00:00Z`)) / 86400000;
  return days / 365.25;
}

function signal(row) {
  const parts = [];
  const yrs = yearsListed(row);
  if (yrs !== null && yrs >= 1) parts.push(`${yrs.toFixed(1)} yrs with no token`);
  if (row.change_7d !== null && row.change_7d >= 5) parts.push(`TVL +${row.change_7d.toFixed(1)}% this week`);
  if (row.change_7d !== null && row.change_7d <= -5) parts.push(`TVL ${row.change_7d.toFixed(1)}% this week`);
  if (row.chains.length >= 4) parts.push(`live on ${row.chains.length} chains`);
  if (row.watchlist) parts.push('on the house watchlist');
  return parts.length ? parts.join(' · ') : 'steady record, no spike';
}

function fillStats() {
  const items = [
    ['Protocols scanned', DATA.protocol_count],
    ['Watchlist covered', `${DATA.watchlist_size} / ${DATA.watchlist_size}`],
    ['Candidates ranked', DATA.candidate_size],
    ['Snapshot', DATA.as_of],
  ];
  els.stats.innerHTML = items.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
  els.foot.textContent = `Data: ${DATA.source}. ${DATA.live_size} protocols were set aside because they already record a token or are a product of one that trades. Implied values are this radar's own model output, not a prediction that a token will launch.`;
}

function fillFilters() {
  const cats = [...new Set(rows.map((r) => r.category ?? 'Uncategorised'))].sort();
  els.cat.innerHTML = '<option value="">All categories</option>' + cats.map((c) => `<option>${esc(c)}</option>`).join('');
  const chains = [...new Set(rows.flatMap((r) => r.chains))].sort();
  els.chain.innerHTML = '<option value="">All chains</option>' + chains.map((c) => `<option>${esc(c)}</option>`).join('');
}

function fillTables() {
  els.catRows.innerHTML = DATA.category_table.map((t) => `
    <tr><td>${esc(t.category)}</td><td class="num">${t.traded}</td><td class="num">×${t.median_ratio.toFixed(2)}</td><td class="num">×${t.ratio_used.toFixed(2)}</td></tr>`).join('');
  els.bandRows.innerHTML = DATA.band_table.map((t) => `
    <tr><td>${esc(t.label)}</td><td class="num">${t.traded}</td><td class="num">×${t.ratio.toFixed(2)}</td></tr>`).join('');
  els.tablesNote.textContent =
    `Every ratio on the board comes from these two tables, computed from the snapshot's traded protocols. ` +
    `A category's ratio used is its median shrunk toward the global median (×${DATA.global_ratio.toFixed(2)}) when its traded count is small. ` +
    `A candidate's blended ratio weights each table by its traded count, so the curator category — one traded name, at a premium multiple — is heard once while its size band's fourteen names are heard fourteen times. ` +
    `That weighting, not a hand-set discount, is what keeps pass-through TVL from pricing the top of the board: the allocator category's own traded median already sits far under the global one, and the board takes it as it finds it.`;
}

function visibleRows() {
  const q = els.q.value.trim().toLowerCase();
  const cat = els.cat.value;
  const chain = els.chain.value;
  let out = rows.filter((r) =>
    (cat === '' || (r.category ?? 'Uncategorised') === cat) &&
    (chain === '' || r.chains.includes(chain)) &&
    (!els.wl.checked || r.watchlist) &&
    (q === '' || r.name.toLowerCase().includes(q) || r.slug.includes(q)));
  const sort = els.sort.value;
  if (sort === 'tvl') out = [...out].sort((a, b) => b.tvl_usd - a.tvl_usd);
  else if (sort === 'change') out = [...out].sort((a, b) => (b.change_7d ?? -Infinity) - (a.change_7d ?? -Infinity));
  else if (sort === 'implied') out = [...out].sort((a, b) => b.implied_value_usd - a.implied_value_usd);
  else if (sort === 'watchlist') out = [...out].sort((a, b) => (b.watchlist ? 1 : 0) - (a.watchlist ? 1 : 0) || a.rank - b.rank);
  else out = [...out].sort((a, b) => a.rank - b.rank);
  return out;
}

let selected = rows[0]?.slug;

function renderBoard() {
  const vis = visibleRows();
  els.count.textContent = `${vis.length} of ${rows.length} candidates`;
  els.body.innerHTML = vis.map((r) => `
    <tr data-slug="${esc(r.slug)}" class="${r.slug === selected ? 'selected' : ''}">
      <td class="num">${r.rank}</td>
      <td class="name-cell">${esc(r.name)}${r.watchlist ? '<span class="badge">WATCHLIST</span>' : ''}<br><span class="slug">${esc(r.slug)}</span></td>
      <td>${esc(r.category ?? 'Uncategorised')}</td>
      <td class="num">${money(r.tvl_usd)}</td>
      <td class="num ${r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'}">${r.change_7d === null ? '—' : `${r.change_7d >= 0 ? '+' : ''}${r.change_7d.toFixed(1)}%`}</td>
      <td class="num value">${money(r.implied_value_usd)}</td>
      <td class="signal">${esc(signal(r))}</td>
    </tr>`).join('');
  for (const tr of els.body.querySelectorAll('tr')) {
    tr.addEventListener('click', () => { location.hash = `#/p/${tr.dataset.slug}`; });
  }
}

function factorRow(label, factor, note) {
  const pct = Math.max(2, Math.min(100, ((factor - 0.6) / 0.9) * 100));
  return `<div class="factor"><span>${esc(label)}</span><span class="bar"><i style="width:${pct.toFixed(1)}%"></i></span><span class="fx">×${factor.toFixed(2)}</span></div>
  <div class="factor"><span></span><span class="signal">${esc(note)}</span><span></span></div>`;
}

function comparablesHtml(row) {
  const cat = row.category ?? 'Uncategorised';
  const comps = DATA.comparables[cat] ?? [];
  if (comps.length === 0) {
    return `<div class="comps"><h3>Traded comparables</h3><p class="signal">No protocol in ${esc(cat)} records a trading token in this snapshot, so the category cut falls back to the global median and the size band carries the value.</p></div>`;
  }
  const items = comps.map((c) => `<li><span>${esc(c.name)}</span><span class="comp-fig">×${c.ratio.toFixed(2)} · TVL ${money(c.tvl_usd)} · mcap ${money(c.mcap_usd)}</span></li>`).join('');
  return `<div class="comps"><h3>Traded comparables in ${esc(cat)}</h3><ul>${items}</ul><p class="signal">The category ratio above is these names' median, shrunk toward the global median; the blend then weighs it against the size band by the counts on both sides.</p></div>`;
}

function renderDetail(row) {
  if (!row) { els.detail.innerHTML = '<p class="empty">Pick a protocol on the board to see its value breakdown and farm plan.</p>'; return; }
  const yrs = yearsListed(row);
  els.detail.innerHTML = `
  <article class="detail-card">
    <a class="backlink" href="#/">&larr; Back to the board</a>
    <h2>#${row.rank} ${esc(row.name)}${row.watchlist ? '<span class="badge">WATCHLIST</span>' : ''}</h2>
    <p class="sub">${esc(row.category ?? 'Uncategorised')} · ${esc(row.chains.join(', '))} · records no token in the snapshot</p>
    <div class="detail-grid">
      <div class="factors">
        <h3>Why this value</h3>
        <dl class="kv">
          <dt>TVL</dt><dd>${money(row.tvl_usd)}</dd>
          <dt>Category ratio</dt><dd>×${row.category_ratio.toFixed(2)}</dd>
          <dt>Category evidence</dt><dd>${row.category_n} traded name${row.category_n === 1 ? '' : 's'}</dd>
          <dt>Size-band ratio</dt><dd>×${row.band_ratio.toFixed(2)}</dd>
          <dt>Band evidence</dt><dd>${row.band_n} traded name${row.band_n === 1 ? '' : 's'}</dd>
          <dt>Blended ratio</dt><dd>×${row.ratio_used.toFixed(2)}</dd>
          <dt>Base value</dt><dd>${money(row.base_value_usd)}</dd>
          <dt>Implied launch value</dt><dd>${money(row.implied_value_usd)}</dd>
          <dt>Listed since</dt><dd>${row.listed_at ?? 'not reported'}</dd>
          <dt>7d TVL change</dt><dd>${row.change_7d === null ? 'not reported' : `${row.change_7d >= 0 ? '+' : ''}${row.change_7d.toFixed(1)}%`}</dd>
        </dl>
        ${factorRow('Momentum (7d TVL)', row.momentum_factor, row.change_7d === null ? 'no 7d figure reported, held neutral' : `TVL moved ${row.change_7d >= 0 ? '+' : ''}${row.change_7d.toFixed(1)}% in the snapshot week`)}
        ${factorRow('Tokenless age', row.age_factor, yrs === null ? 'listing date not reported, held neutral' : `${yrs.toFixed(1)} years running with no token at this TVL`)}
        ${factorRow('Chain reach', row.reach_factor, `live on ${row.chains.length} chain${row.chains.length === 1 ? '' : 's'}`)}
        ${comparablesHtml(row)}
      </div>
      <div class="farm">
        <h3>Farm plan</h3>
        <ol>${row.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      </div>
    </div>
  </article>`;
}

function applyRoute() {
  const hash = location.hash || '#/';
  const detailMatch = hash.match(/^#\/p\/(.+)$/);
  const filterMatch = hash.match(/^#\/filter\/(.+)$/);
  document.body.classList.toggle('detail-only', detailMatch !== null);
  if (detailMatch) {
    const row = bySlug.get(decodeURIComponent(detailMatch[1]));
    selected = row?.slug ?? selected;
    renderDetail(row);
    window.scrollTo(0, 0);
    return;
  }
  if (filterMatch) {
    const cat = decodeURIComponent(filterMatch[1]);
    if ([...els.cat.options].some((o) => o.value === cat || o.text === cat)) els.cat.value = cat;
  }
  if (hash === '#/watchlist') els.wl.checked = true;
  renderBoard();
  renderDetail(bySlug.get(selected));
}

for (const el of [els.q, els.cat, els.chain, els.sort, els.wl]) {
  el.addEventListener('input', () => { if (!document.body.classList.contains('detail-only')) renderBoard(); });
}
window.addEventListener('hashchange', applyRoute);

fillStats();
fillFilters();
fillTables();
applyRoute();
