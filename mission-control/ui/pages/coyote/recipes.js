'use strict';
// Recipes & Costs — the BOM WORKLIST (page-map audit 2026-07-21). The old page rendered an editor
// form for every live SKU (474 products → a 39,076px sheet); nobody costs recipes by scrolling.
// This page is a worklist: coverage hero → "cost these next" (top-20 uncosted by £ net sold) →
// CSV bulk import (the PRIMARY first-load path) → ingredients + a search that opens ONE editor.
// Contract: { key, route, title, sub, getSection, render }. TIER 1 (this page) is SELECT-only via
// ctx.q — it RENDERS state + computes product cost (Σ quantity × exact per-unit cost, rounded only
// here at display) and coverage. TIER 2 (the edits) go to the gated POST /api/recipe-action +
// /api/recipe-import (server.js) — the ONE operator write path; the page itself never writes.
// NO-FABRICATION: a product only counts as "costed" when it has a complete recipe whose every
// ingredient carries pack cost + qty; uncosted SKUs are a visible coverage GAP, never a made-up
// cost. Products are the LIVE Lightspeed SKUs (seeded from sales), never typed here.
const S = require('../../shared.js');

const WORKLIST_CAP = 20; // the "cost these next" list — big enough to batch, small enough to finish
const FIND_CAP = 30;     // search result cap — a wider match set means "narrow the search", not "scroll"

function rowsOf(res) { return res && res.ok && Array.isArray(res.rows) ? res.rows : []; }
function num(v) { if (v === null || v === undefined) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
// £ from integer pence, rounded ONLY here (display boundary) — the store keeps exact inputs.
function gbp(pence) { const n = num(pence); return n == null ? '—' : S.fmtGbpPence(Math.round(n)); }
function pct(x) { return x == null ? '—' : `${(x * 100).toFixed(1)}%`; }

module.exports = {
  key: 'recipes', route: '/coyote/recipes', workspace: 'coyote', title: 'Recipes & Costs',
  sub: 'Bill-of-materials worklist · cost the biggest sellers first → true prime cost',

  getSection(db, ctx) {
    const q = ctx && ctx.q;
    const now = (ctx && ctx.now) || Date.now();
    if (typeof q !== 'function') return { now, subItems: [], products: [], salesWired: false, coverage: null, worklist: [], costedList: [], find: '', matches: null, nextGainPct: null };

    // Ingredients — the per-usable-unit cost is COMPUTED (pack_cost / pack_qty), never stored rounded.
    const subItems = rowsOf(q(
      `SELECT id, name, supplier, pack_description, pack_cost_pence, pack_qty, unit_of_measure, cost_source, updated_at
         FROM sub_items ORDER BY name`))
      .map((s) => ({ ...s, unit_cost: (num(s.pack_cost_pence) != null && num(s.pack_qty)) ? num(s.pack_cost_pence) / num(s.pack_qty) : null }));

    // Products (live SKUs) + recipe completeness + computed product cost. A product is "costed" iff it
    // has ≥1 recipe line AND none of its ingredients is missing pack cost/qty.
    const products = rowsOf(q(
      `SELECT p.id, p.lightspeed_sku, p.name, p.category,
          (SELECT COUNT(*) FROM recipe_lines rl WHERE rl.product_id = p.id) AS line_count,
          (SELECT COUNT(*) FROM recipe_lines rl JOIN sub_items si ON si.id = rl.sub_item_id
             WHERE rl.product_id = p.id AND (si.pack_cost_pence IS NULL OR si.pack_qty IS NULL)) AS uncosted_lines,
          (SELECT SUM(rl.quantity * CAST(si.pack_cost_pence AS REAL) / si.pack_qty)
             FROM recipe_lines rl JOIN sub_items si ON si.id = rl.sub_item_id WHERE rl.product_id = p.id) AS product_cost
         FROM products p`));

    // Existing recipe lines per product — shown inside the editor so the operator sees what a recipe
    // already holds before adding to it (the old page hid this entirely).
    const linesByProduct = new Map();
    for (const l of rowsOf(q(
      `SELECT rl.product_id, rl.sub_item_id, rl.quantity, si.name AS si_name, si.unit_of_measure,
              si.pack_cost_pence, si.pack_qty
         FROM recipe_lines rl LEFT JOIN sub_items si ON si.id = rl.sub_item_id
        ORDER BY rl.product_id, rl.sub_item_id`))) {
      const arr = linesByProduct.get(l.product_id) || [];
      const costed = num(l.pack_cost_pence) != null && num(l.pack_qty);
      arr.push({ ...l, line_cost: costed ? num(l.quantity) * num(l.pack_cost_pence) / num(l.pack_qty) : null });
      linesByProduct.set(l.product_id, arr);
    }

    // Sales volume per SKU — SORTS the worklist (biggest sellers first) + weights coverage %.
    // Slice 1 lands sales as AGGREGATES (sales_by_product), not per-line rows. total_amount_pence is
    // gross — a fine weight for "biggest sellers first" + coverage %. Table absent until the sales
    // ingest runs → safeSelect ok:false → salesWired=false → sort by name + "awaiting sales data".
    const salesRes = q(
      `SELECT sku, SUM(total_amount_pence) AS net, SUM(quantity) AS units
         FROM sales_by_product GROUP BY sku`);
    const salesWired = !!(salesRes && salesRes.ok);
    const salesBySku = new Map();
    for (const r of rowsOf(salesRes)) salesBySku.set(String(r.sku), { net: num(r.net) || 0, units: num(r.units) || 0 });

    for (const p of products) {
      const s = salesBySku.get(String(p.lightspeed_sku));
      p.net_sales = s ? s.net : 0;
      p.units = s ? s.units : 0;
      p.costed = num(p.line_count) > 0 && num(p.uncosted_lines) === 0;
      p.seen_in_sales = !!s; // a recipe whose SKU isn't in sales = a stray (drift/typo) — surfaced, not hidden
      p.lines = linesByProduct.get(p.id) || [];
    }
    products.sort((a, b) => (salesWired ? (b.net_sales - a.net_sales) : String(a.name || a.id).localeCompare(String(b.name || b.id))));

    // Coverage: % of net sales whose product is fully costed (only meaningful once sales flow).
    let coverage = null;
    if (salesWired) {
      const totalNet = products.reduce((t, p) => t + p.net_sales, 0);
      const costedNet = products.filter((p) => p.costed).reduce((t, p) => t + p.net_sales, 0);
      coverage = { pct: totalNet > 0 ? costedNet / totalNet : null, costed: products.filter((p) => p.costed).length, total: products.length, totalNet, costedNet };
    }

    // THE WORKLIST: top uncosted by £ net sold (partial recipes count as uncosted — they still need
    // work). costedList is the payoff view (collapsed). nextGainPct = coverage if the worklist were
    // finished — the "cost these 20 → X%" carrot, pure arithmetic on the same weights.
    const uncosted = products.filter((p) => !p.costed);
    const worklist = uncosted.slice(0, WORKLIST_CAP);
    const costedList = products.filter((p) => p.costed);
    let nextGainPct = null;
    if (coverage && coverage.totalNet > 0) {
      const gain = worklist.reduce((t, p) => t + p.net_sales, 0);
      nextGainPct = (coverage.costedNet + gain) / coverage.totalNet;
    }

    // SEARCH → the on-demand editor. Server-side GET (?find=) so the page stays server-rendered;
    // matches by name or SKU, case-insensitive, capped — the cap is stated, never silent.
    const find = String((ctx.query && ctx.query.find) || '').trim();
    let matches = null;
    if (find) {
      const needle = find.toLowerCase();
      const all = products.filter((p) =>
        String(p.name || '').toLowerCase().includes(needle) || String(p.lightspeed_sku || '').toLowerCase().includes(needle));
      matches = { total: all.length, shown: all.slice(0, FIND_CAP) };
    }

    return { now, subItems, products, salesWired, coverage, worklist, uncostedTotal: uncosted.length, costedList, nextGainPct, find, matches };
  },

  render(section, ctx) {
    const m = section || {};
    const esc = S.escapeHtml;
    const stamp = m.salesWired
      ? `bill-of-materials · joined to <span class="mono">live sales</span>`
      : `bill-of-materials · <span class="mono">products seed when sales flow</span>`;
    const parts = [];
    const opts = (m.subItems || []).map((s) => `<option value="${esc(s.id)}">${esc(s.id)} — ${esc(s.name || '')}</option>`).join('');

    // ONE editor row, opened on demand (<details>) — recipe lines it already holds + the add form.
    const productRow = (p, open) => {
      const badge = p.costed ? `<span class="chip green">costed ${gbp(p.product_cost)}</span>`
        : num(p.line_count) > 0 ? `<span class="chip amber">partial · ${esc(String(p.uncosted_lines))} ingredient(s) uncosted</span>`
          : `<span class="chip">no recipe</span>`;
      const stray = (m.salesWired && !p.seen_in_sales) ? ` <span class="chip amber">SKU not in live sales</span>` : '';
      const sales = m.salesWired ? ` <span class="ash mono">${gbp(p.net_sales)} net · ${esc(String(Math.round(p.units)))} sold</span>` : '';
      const lines = (p.lines || []).length
        ? `<table class="tbl" style="margin:6px 0"><thead><tr><th>ingredient</th><th>qty</th><th>line cost</th></tr></thead><tbody>${p.lines.map((l) =>
            `<tr><td>${esc(l.si_name || l.sub_item_id)}</td><td class="mono">${esc(String(l.quantity))} ${esc(l.unit_of_measure || '')}</td><td class="mono">${l.line_cost == null ? '<span class="a">ingredient has no cost yet</span>' : gbp(l.line_cost)}</td></tr>`).join('')}</tbody></table>`
        : '';
      return `<details class="rc-prod"${open ? ' open' : ''}>
        <summary class="rc-prod-head"><span class="mono">${esc(p.lightspeed_sku)}</span> <b>${esc(p.name || '')}</b> ${badge}${stray}${sales}</summary>
        ${lines}
        <form class="rc-form" data-rc="recipe_line">
          <input type="hidden" name="product_id" value="${esc(p.id)}">
          <select name="sub_item_id" required><option value="">add ingredient…</option>${opts}</select>
          <input name="quantity" placeholder="qty (in the ingredient's unit)" inputmode="decimal" required>
          <button class="btn" type="submit">Add to recipe</button>
        </form></details>`;
    };

    // ---- coverage hero (no-fabrication) ----
    parts.push(`<div class="sec-label">Recipe coverage<span class="rule"></span></div>`);
    if (!m.products.length) {
      parts.push(`<div class="banner muted">No products yet — the menu seeds from the live Lightspeed SKUs once the sales ingest is flowing. Define your ingredients now (below); attach recipes to real products once they appear.</div>`);
    } else if (m.coverage) {
      const c = m.coverage;
      const carrot = (m.worklist || []).length && m.nextGainPct != null
        ? `<div class="tile blue"><div class="lab">Cost the ${esc(String(m.worklist.length))} below</div><div class="val">→ ${pct(m.nextGainPct)}</div><div class="sub">coverage if the worklist is finished — biggest sellers first</div></div>`
        : `<div class="tile green"><div class="lab">Worklist</div><div class="val">clear</div><div class="sub">every product that sells is costed</div></div>`;
      parts.push(`<div class="tiles">
        <div class="tile ${c.pct != null && c.pct >= 0.8 ? 'green' : 'amber'}"><div class="lab">Net sales costed</div><div class="val">${pct(c.pct)}</div><div class="sub">recipes cover this share of net sales</div></div>
        <div class="tile"><div class="lab">Products costed</div><div class="val">${esc(String(c.costed))}/${esc(String(c.total))}</div><div class="sub">${esc(String(c.total - c.costed))} uncosted (shown as a gap, never estimated)</div></div>
        ${carrot}
      </div>`);
    } else {
      parts.push(`<div class="banner muted">${esc(String(m.products.length))} products defined. Coverage % lights up once sales data flows (it weights by what actually sells). Until then, use the worklist + search below.</div>`);
    }

    // ---- the worklist + search (replaces the render-every-product sheet) ----
    if (m.products.length) {
      parts.push(`<div class="sec-label">Cost these next<span class="rule"></span></div>`);
      parts.push(`<div class="panel"><div class="panel-body">`);
      parts.push(`<form method="get" action="/coyote/recipes" class="rc-form" style="margin:0 0 10px">
        <input name="find" value="${esc(m.find || '')}" placeholder="find any product (name or SKU)…">
        <button class="btn" type="submit">Find</button>${m.find ? ` <a class="btn" href="/coyote/recipes">clear</a>` : ''}
      </form>`);
      if (m.matches) {
        const cap = m.matches.total > m.matches.shown.length ? ` · showing ${m.matches.shown.length} — narrow the search` : '';
        parts.push(`<p class="ash">${esc(String(m.matches.total))} match${m.matches.total === 1 ? '' : 'es'} for <span class="mono">${esc(m.find)}</span>${esc(cap)}</p>`);
        parts.push(m.matches.shown.length
          ? m.matches.shown.map((p) => productRow(p, m.matches.shown.length === 1)).join('')
          : `<div class="empty-row">No product matches — products are the live Lightspeed SKUs, so check the till name.</div>`);
      } else if ((m.worklist || []).length) {
        parts.push(`<p class="ash">Top ${esc(String(m.worklist.length))} uncosted ${m.salesWired ? 'by £ net sold' : 'by name (awaiting sales data)'} · ${esc(String(m.uncostedTotal))} uncosted in total — the rest surface here as these are finished, or via search.</p>`);
        parts.push(m.worklist.map((p) => productRow(p, false)).join(''));
      } else {
        parts.push(`<div class="banner green">Every product that sells is costed — nothing on the worklist. New SKUs land here automatically.</div>`);
      }
      parts.push(`</div></div>`);
    }

    // ---- CSV bulk import (PRIMARY first-load) + pre-filled template ----
    parts.push(`<div class="sec-label">Bulk import<span class="rule"></span></div>`);
    parts.push(`<div class="panel"><div class="panel-body">
      <p class="ash">Fill ~30–40 recipes in one sitting. Two CSVs, both through the same validation; a bad row is reported, never silently imported.</p>
      <p><b>1. Ingredients</b> — columns: <span class="mono">id,name,supplier,pack_description,pack_cost,pack_qty,unit_of_measure</span> (pack_cost in £; unit ∈ each/g/ml/portion)</p>
      <div class="rc-import" data-kind="sub_items"><input type="file" accept=".csv"><button class="btn rc-import-btn" type="button">Import ingredients</button><span class="rc-result ash"></span></div>
      <p style="margin-top:.8rem"><b>2. Recipes</b> — columns: <span class="mono">product_sku,product_name,sub_item_id,quantity</span> — attach ingredients to your REAL SKUs. <a class="btn" href="/api/recipe-template">Download template (pre-filled with your live products)</a></p>
      <div class="rc-import" data-kind="recipes"><input type="file" accept=".csv"><button class="btn rc-import-btn" type="button">Import recipes</button><span class="rc-result ash"></span></div>
    </div></div>`);

    // ---- ingredients (sub_items) — table collapsed, add form always to hand ----
    parts.push(`<div class="sec-label">Ingredients <span class="mono">(${esc(String(m.subItems.length))})</span><span class="rule"></span></div>`);
    parts.push(`<div class="panel"><div class="panel-body">`);
    if (m.subItems.length) {
      const noCost = m.subItems.filter((s) => s.unit_cost == null).length;
      const rows = m.subItems.map((s) => `<tr>
        <td class="mono">${esc(s.id)}</td><td>${esc(s.name || '')}</td>
        <td>${esc(s.pack_description || '')}${s.supplier ? ` · <span class="ash">${esc(s.supplier)}</span>` : ''}</td>
        <td class="mono">${gbp(s.pack_cost_pence)}${num(s.pack_qty) != null ? ` / ${esc(String(s.pack_qty))} ${esc(s.unit_of_measure)}` : ''}</td>
        <td class="mono">${s.unit_cost == null ? '<span class="a">no cost yet</span>' : `${(s.unit_cost / 100).toFixed(4)} £/${esc(s.unit_of_measure)}`}</td>
        <td class="mono ash">${esc(s.cost_source || 'manual')}</td></tr>`).join('');
      parts.push(`<details${m.subItems.length <= 12 ? ' open' : ''}><summary class="ash">${esc(String(m.subItems.length))} ingredient${m.subItems.length === 1 ? '' : 's'}${noCost ? ` · <span class="a">${esc(String(noCost))} without a cost</span>` : ' · all costed'}</summary>
        <table class="tbl" style="margin-top:8px"><thead><tr><th>id</th><th>name</th><th>pack</th><th>pack cost</th><th>unit cost (computed)</th><th>source</th></tr></thead><tbody>${rows}</tbody></table></details>`);
    } else {
      parts.push(`<div class="empty-row">No ingredients yet — add your first below (pack cost + pack qty → the per-unit cost is computed), or use the CSV import above.</div>`);
    }
    // add/edit ingredient — gated form → POST /api/recipe-action upsert_sub_item
    parts.push(`<form class="rc-form" data-rc="sub_item">
      <input name="id" placeholder="id (e.g. bun)" required>
      <input name="name" placeholder="name" required>
      <input name="supplier" placeholder="supplier">
      <input name="pack_description" placeholder="pack (e.g. box of 48)">
      <input name="pack_cost" placeholder="pack cost £" inputmode="decimal">
      <input name="pack_qty" placeholder="usable qty (e.g. 48)" inputmode="decimal">
      <select name="unit_of_measure"><option value="each">each</option><option value="g">g</option><option value="ml">ml</option><option value="portion">portion</option></select>
      <button class="btn" type="submit">Save ingredient</button>
    </form>`);
    parts.push(`</div></div>`);

    // ---- the payoff view: costed products, collapsed (names + computed cost, biggest sellers first) ----
    if ((m.costedList || []).length) {
      parts.push(`<div class="sec-label">Costed products <span class="mono">(${esc(String(m.costedList.length))})</span><span class="rule"></span></div>`);
      parts.push(`<div class="panel"><div class="panel-body"><details><summary class="ash">${esc(String(m.costedList.length))} product${m.costedList.length === 1 ? '' : 's'} fully costed — open to review, or use search to edit one</summary>
        <table class="tbl" style="margin-top:8px"><thead><tr><th>sku</th><th>product</th><th>recipe cost</th>${m.salesWired ? '<th>net sold</th>' : ''}</tr></thead><tbody>${m.costedList.map((p) =>
          `<tr><td class="mono">${esc(p.lightspeed_sku)}</td><td>${esc(p.name || '')}</td><td class="mono">${gbp(p.product_cost)}</td>${m.salesWired ? `<td class="mono ash">${gbp(p.net_sales)}</td>` : ''}</tr>`).join('')}</tbody></table></details></div></div>`);
    }

    // No clientScript here — the recipe form/import wiring lives in shared.js clientScript() (keyed by
    // the data-rc / data-kind attributes above), so this page module makes no network call itself
    // (the SELECT-only page boundary, enforced by the boundary test which covers this page too).
    return { stamp, body: parts.join('\n') };
  },
};
