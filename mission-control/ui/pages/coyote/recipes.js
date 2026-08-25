'use strict';
// Recipes & Costs — daily recipe-cost coverage and the outstanding-work view. The page reads
// through ctx.q only. Recipe and ingredient changes still travel through the existing gated POST
// handlers wired by the shared client script; this module never writes to librarian.db.
const S = require('../../shared.js');

const WORKLIST_CAP = 20;
const COSTED_CAP = 20;
const FIND_CAP = 30;
const FAMILY_SUFFIXES = [
  ' - Single',
  ' - Double',
  ' (included)',
  ' - Eat In Deal',
  ' - CC Deal',
  ' - DEAL',
];

function rowsOf(res) { return res && res.ok && Array.isArray(res.rows) ? res.rows : []; }
function num(v) { if (v === null || v === undefined) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
function gbp(pence) { const n = num(pence); return n == null ? '—' : S.fmtGbpPence(Math.round(n)); }
function pct(x) { const n = num(x); return n == null ? '—' : `${(n * 100).toFixed(1)}%`; }

// Product names commonly carry till-only variants. Remove every trailing variant, not just the
// last one, because names can contain stacked deal/single suffixes. Families compare separately
// using a lower-cased key, while this function preserves the first member's display casing.
function normalizeRecipeFamily(value) {
  const original = String(value == null ? '' : value).trim();
  let family = original;
  let previous;
  do {
    previous = family;
    const lower = family.toLocaleLowerCase('en-GB');
    const suffix = FAMILY_SUFFIXES.find((candidate) => lower.endsWith(candidate.toLocaleLowerCase('en-GB')));
    if (suffix) family = family.slice(0, -suffix.length).trimEnd();
    family = family.replace(/[\s\p{P}]+$/u, '').trim();
  } while (family !== previous);
  return family || original || 'Unnamed product';
}

module.exports = {
  key: 'recipes', route: '/coyote/recipes', workspace: 'coyote', title: 'Recipes & Costs',
  sub: 'See how much of the last 12 months’ net sales has complete recipe costing',
  normalizeRecipeFamily,

  getSection(db, ctx) {
    const q = ctx && ctx.q;
    const now = (ctx && ctx.now) || Date.now();
    if (typeof q !== 'function') {
      return {
        now, subItems: [], products: [], recipeLineCount: null, salesWired: false,
        salesPresent: false, coverage: null, worklist: [], workFamilies: [],
        uncostedTotal: 0, costedList: [], costedTop: [], costedTotal: 0,
        costedRemaining: 0, nextOutstandingNet: null, find: '', matches: null,
      };
    }

    // A fresh count on every request distinguishes a genuinely new recipe book from partial data.
    const countRes = q(`SELECT COUNT(*) AS line_count FROM recipe_lines`);
    const countRow = rowsOf(countRes)[0];
    const recipeLineCount = countRes && countRes.ok && countRow && num(countRow.line_count) != null
      ? Math.max(0, Math.trunc(num(countRow.line_count)))
      : null;

    const subItems = rowsOf(q(
      `SELECT id, name, supplier, pack_description, pack_cost_pence, pack_qty, unit_of_measure, cost_source, updated_at
         FROM sub_items ORDER BY name`))
      .map((s) => ({
        ...s,
        unit_cost: num(s.pack_cost_pence) != null && num(s.pack_qty)
          ? num(s.pack_cost_pence) / num(s.pack_qty)
          : null,
      }));

    // Completeness is unchanged: at least one line, with pack cost and pack quantity present on
    // every linked ingredient. The verified line formula is quantity × pack cost ÷ pack quantity;
    // its product total is rounded once to integer pence before any price or GP calculation.
    const products = rowsOf(q(
      `SELECT p.id, p.lightspeed_sku, p.name, p.category,
          (SELECT COUNT(*) FROM recipe_lines rl WHERE rl.product_id = p.id) AS line_count,
          (SELECT COUNT(*) FROM recipe_lines rl JOIN sub_items si ON si.id = rl.sub_item_id
             WHERE rl.product_id = p.id AND (si.pack_cost_pence IS NULL OR si.pack_qty IS NULL)) AS uncosted_lines,
          (SELECT SUM(rl.quantity * CAST(si.pack_cost_pence AS REAL) / si.pack_qty)
             FROM recipe_lines rl JOIN sub_items si ON si.id = rl.sub_item_id WHERE rl.product_id = p.id) AS product_cost
         FROM products p`));

    const linesByProduct = new Map();
    for (const l of rowsOf(q(
      `SELECT rl.product_id, rl.sub_item_id, rl.quantity, si.name AS si_name, si.unit_of_measure,
              si.pack_cost_pence, si.pack_qty
         FROM recipe_lines rl LEFT JOIN sub_items si ON si.id = rl.sub_item_id
        ORDER BY rl.product_id, rl.sub_item_id`))) {
      const arr = linesByProduct.get(l.product_id) || [];
      const lineCanBeCosted = num(l.pack_cost_pence) != null && num(l.pack_qty);
      arr.push({
        ...l,
        line_cost: lineCanBeCosted
          ? num(l.quantity) * num(l.pack_cost_pence) / num(l.pack_qty)
          : null,
      });
      linesByProduct.set(l.product_id, arr);
    }

    // Aggregate each SKU over the trailing 12 calendar months ending on the latest available sales
    // day. This keeps the daily view stable when an ingest is late and excludes older history.
    const salesRes = q(
      `SELECT sku, SUM(total_amount_pence) AS net, SUM(quantity) AS units
         FROM sales_by_product
        WHERE business_date BETWEEN
              date((SELECT MAX(business_date) FROM sales_by_product), '-12 months', '+1 day')
              AND (SELECT MAX(business_date) FROM sales_by_product)
        GROUP BY sku`);
    const salesWired = !!(salesRes && salesRes.ok);
    const salesBySku = new Map();
    for (const r of rowsOf(salesRes)) {
      salesBySku.set(String(r.sku), {
        net: Math.round(num(r.net) || 0),
        units: num(r.units) || 0,
      });
    }
    const salesPresent = salesBySku.size > 0;

    for (const p of products) {
      const s = salesBySku.get(String(p.lightspeed_sku));
      p.net_sales = s ? s.net : 0;
      p.units = s ? s.units : 0;
      p.costed = num(p.line_count) > 0 && num(p.uncosted_lines) === 0;
      p.seen_in_sales = !!s;
      p.lines = linesByProduct.get(p.id) || [];
      p.unit_cost_pence = p.costed && num(p.product_cost) != null
        ? Math.round(num(p.product_cost))
        : null;
      // Retain the established field for the search/editor badge, now at the integer-pence boundary.
      p.product_cost = p.unit_cost_pence;
      p.achieved_price_pence = s && p.units > 0
        ? Math.round(p.net_sales / p.units)
        : null;
      p.gp_pence = p.achieved_price_pence == null || p.unit_cost_pence == null
        ? null
        : p.achieved_price_pence - p.unit_cost_pence;
      p.cost_pct = p.achieved_price_pence != null && p.achieved_price_pence > 0 && p.unit_cost_pence != null
        ? p.unit_cost_pence / p.achieved_price_pence
        : null;
    }

    // This sort and slice are the existing prioritisation semantics. Family grouping below is only
    // a display roll-up; it never changes which individual products make up the next 20.
    products.sort((a, b) => (salesWired
      ? b.net_sales - a.net_sales
      : String(a.name || a.id).localeCompare(String(b.name || b.id))));

    let coverage = null;
    if (salesWired) {
      const totalNet = products.reduce((total, p) => total + p.net_sales, 0);
      const costedNet = products.filter((p) => p.costed).reduce((total, p) => total + p.net_sales, 0);
      coverage = {
        pct: totalNet > 0 ? costedNet / totalNet : null,
        totalNet,
        costedNet,
      };
    }

    const uncosted = products.filter((p) => !p.costed);
    const worklist = uncosted.slice(0, WORKLIST_CAP);
    const nextOutstandingNet = salesPresent
      ? worklist.reduce((total, p) => total + p.net_sales, 0)
      : null;

    const familyMap = new Map();
    uncosted.forEach((p, rank) => {
      const familyName = normalizeRecipeFamily(p.name);
      const familyKey = familyName.toLocaleLowerCase('en-GB');
      let family = familyMap.get(familyKey);
      if (!family) {
        family = { name: familyName, members: [], memberCount: 0, net_sales: 0, firstRank: rank };
        familyMap.set(familyKey, family);
      }
      family.members.push(p);
      family.memberCount += 1;
      family.net_sales += p.net_sales;
    });
    const workFamilies = [...familyMap.values()]
      .sort((a, b) => (b.net_sales - a.net_sales) || (a.firstRank - b.firstRank));

    const costedList = products.filter((p) => p.costed);
    const costedTop = costedList.slice(0, COSTED_CAP);

    const find = String((ctx.query && ctx.query.find) || '').trim();
    let matches = null;
    if (find) {
      const needle = find.toLowerCase();
      const all = products.filter((p) =>
        String(p.name || '').toLowerCase().includes(needle)
        || String(p.lightspeed_sku || '').toLowerCase().includes(needle));
      matches = { total: all.length, shown: all.slice(0, FIND_CAP) };
    }

    return {
      now, subItems, products, recipeLineCount, salesWired, salesPresent, coverage,
      worklist, workFamilies, uncostedTotal: uncosted.length, nextOutstandingNet,
      costedList, costedTop, costedTotal: costedList.length,
      costedRemaining: Math.max(0, costedList.length - costedTop.length),
      find, matches,
    };
  },

  render(section, ctx) {
    const m = section || {};
    const esc = S.escapeHtml;
    const unavailable = '<span class="ash">unavailable</span>';
    const stamp = m.salesPresent
      ? `last 12 months · matched to <span class="mono">product sales</span>`
      : `recipe costs · <span class="mono">12-month sales unavailable</span>`;
    const parts = [];
    const opts = (m.subItems || [])
      .map((s) => `<option value="${esc(s.id)}">${esc(s.id)} — ${esc(s.name || '')}</option>`)
      .join('');

    // Search remains the narrow way to inspect one recipe without expanding the family worklist.
    const productRow = (p, open) => {
      const badge = p.costed ? `<span class="chip green">costed ${gbp(p.product_cost)}</span>`
        : num(p.line_count) > 0 ? `<span class="chip amber">partial · ${esc(String(p.uncosted_lines))} ingredient(s) without a pack cost or quantity</span>`
          : `<span class="chip">no recipe</span>`;
      const stray = (m.salesWired && !p.seen_in_sales) ? ` <span class="chip amber">SKU not in 12-month sales</span>` : '';
      const sales = m.salesPresent && p.seen_in_sales
        ? ` <span class="ash mono">${gbp(p.net_sales)} net · ${esc(String(p.units))} sold</span>`
        : '';
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

    const noRecipes = m.recipeLineCount === 0;

    // Coverage is strictly sales-weighted. Product counts do not participate in this percentage.
    parts.push(`<div class="sec-label">12-month recipe-cost coverage<span class="rule"></span></div>`);
    if (!(m.products || []).length) {
      parts.push(`<div class="banner muted">No products are available yet. Products appear from the live till sales feed; ingredient setup can continue below in the meantime.</div>`);
    } else if (m.salesPresent && m.coverage) {
      const c = m.coverage;
      const outstandingCount = Math.min(WORKLIST_CAP, Number(m.uncostedTotal) || 0);
      parts.push(`<div class="tiles">
        <div class="tile ${c.pct != null && c.pct >= 0.8 ? 'green' : 'amber'}"><div class="lab">12-month net sales covered</div><div class="val">${pct(c.pct)}</div><div class="sub">${gbp(c.costedNet)} costed-product net sales ÷ ${gbp(c.totalNet)} all-product net sales</div></div>
        ${noRecipes ? '' : `<div class="tile blue"><div class="lab">Next ${esc(String(outstandingCount))} outstanding product${outstandingCount === 1 ? '' : 's'}</div><div class="val">${m.nextOutstandingNet == null ? '—' : gbp(m.nextOutstandingNet)}</div><div class="sub">combined 12-month net sales represented by the same ranked product list</div></div>`}
      </div>`);
      parts.push(`<p class="ash">Coverage means the share of 12-month net sales whose products have complete recipe costs.</p>`);
      if (c.pct == null) parts.push(`<div class="banner muted">12-month sales are present, but all-product net sales are zero, so a coverage percentage is unavailable.</div>`);
    } else {
      parts.push(noRecipes
        ? `<div class="banner muted">12-month sales are unavailable, so sales-weighted coverage cannot be calculated. Recipe setup remains available below.</div>`
        : `<div class="banner muted">12-month sales are unavailable, so sales-weighted coverage and the combined net sales for the next 20 outstanding products cannot be calculated. Recipe costs and outstanding families remain visible below.</div>`);
    }

    if (noRecipes) {
      parts.push(`<div class="sec-label">Getting started<span class="rule"></span></div>`);
      parts.push(`<div class="banner muted">No product recipes have been entered yet. Add ingredient pack costs below, then open “Recipe setup: bulk CSV import” at the bottom to enter product recipes. Costed results and the outstanding-work analysis will appear after the first recipe line is entered.</div>`);
    } else {
      // ---- Costed: the daily result, ranked by 12-month product net sales ----
      parts.push(`<div class="sec-label">Costed<span class="rule"></span></div>`);
      const costedTop = m.costedTop || (m.costedList || []).slice(0, COSTED_CAP);
      if (costedTop.length) {
        if (!m.salesPresent) parts.push(`<div class="banner muted">12-month sales are unavailable. Unit costs are shown; achieved average net price, GP and cost percentage are unavailable.</div>`);
        parts.push(`<div class="panel"><div class="panel-body">
          <p class="ash">Top ${esc(String(costedTop.length))} costed product${costedTop.length === 1 ? '' : 's'}${m.salesPresent ? ' by 12-month net sales' : ''}.</p>
          <table class="tbl"><thead><tr><th>product</th><th>unit cost</th><th>achieved average net price</th><th>GP £</th><th>cost %</th></tr></thead><tbody>${costedTop.map((p) =>
            `<tr><td>${esc(p.name || '')}<div class="ash mono">${esc(p.lightspeed_sku)}</div></td><td class="mono">${p.unit_cost_pence == null ? unavailable : gbp(p.unit_cost_pence)}</td><td class="mono">${p.achieved_price_pence == null ? unavailable : gbp(p.achieved_price_pence)}</td><td class="mono">${p.gp_pence == null ? unavailable : gbp(p.gp_pence)}</td><td class="mono">${p.cost_pct == null ? unavailable : pct(p.cost_pct)}</td></tr>`).join('')}</tbody></table>
          ${(Number(m.costedRemaining) || 0) > 0 ? `<p class="ash">and ${esc(String(m.costedRemaining))} more, all costed.</p>` : `<p class="ash">All ${esc(String(m.costedTotal == null ? costedTop.length : m.costedTotal))} costed product${Number(m.costedTotal) === 1 ? '' : 's'} shown.</p>`}
        </div></div>`);
      } else {
        parts.push(`<div class="banner muted">No products have complete recipe costs yet. A product appears here once it has at least one recipe line and every linked ingredient has both a pack cost and pack quantity.</div>`);
      }

      // ---- Outstanding work: all eligible products rolled up for display, not reprioritised ----
      if ((m.products || []).length) {
        parts.push(`<div class="sec-label">Outstanding work by product family<span class="rule"></span></div>`);
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
            : `<div class="empty-row">No product matches — check the till name or SKU.</div>`);
        } else if ((m.workFamilies || []).length) {
          const nextCount = Math.min(WORKLIST_CAP, Number(m.uncostedTotal) || 0);
          parts.push(`<p class="ash">${esc(String(m.uncostedTotal))} outstanding product${Number(m.uncostedTotal) === 1 ? '' : 's'} in ${esc(String(m.workFamilies.length))} famil${m.workFamilies.length === 1 ? 'y' : 'ies'}. Families rank by combined 12-month net sales; the next ${esc(String(nextCount))} ${nextCount === 1 ? 'remains' : 'remain'} the highest-selling individual outstanding product${nextCount === 1 ? '' : 's'}.</p>`);
          parts.push(`<table class="tbl rc-family-table"><thead><tr><th>family</th><th>outstanding products</th><th>combined 12-month net sales</th><th>raw products / SKUs</th></tr></thead><tbody>${m.workFamilies.map((family) =>
            `<tr><td><b>${esc(family.name)}</b></td><td class="mono">${esc(String(family.memberCount))}</td><td class="mono">${m.salesPresent ? gbp(family.net_sales) : unavailable}</td><td><details class="rc-family"><summary>${esc(String(family.memberCount))} member${family.memberCount === 1 ? '' : 's'}</summary><ul>${family.members.map((p) =>
              `<li><span class="mono">${esc(p.lightspeed_sku)}</span> — ${esc(p.name || '')}${m.salesPresent && p.seen_in_sales ? ` · <span class="mono ash">${gbp(p.net_sales)}</span>` : ''}</li>`).join('')}</ul></details></td></tr>`).join('')}</tbody></table>`);
        } else {
          parts.push(`<div class="banner green">Every product is costed — there is no outstanding work. New till products will appear here automatically.</div>`);
        }
        parts.push(`</div></div>`);
      }
    }

    // ---- Ingredients remain usable regardless of sales/costed analytics ----
    parts.push(`<div class="sec-label">Ingredients <span class="mono">(${esc(String((m.subItems || []).length))})</span><span class="rule"></span></div>`);
    parts.push(`<div class="panel"><div class="panel-body">`);
    if ((m.subItems || []).length) {
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
      parts.push(`<div class="empty-row">No ingredients yet — add the first below, or use the CSV setup tool at the bottom.</div>`);
    }
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

    // ---- Setup tooling is deliberately last and collapsed; its existing data attributes preserve
    // the shared client-script import behaviour without adding another inline script. ----
    parts.push(`<div class="sec-label">Setup tooling<span class="rule"></span></div>`);
    parts.push(`<details class="panel rc-setup"><summary class="panel-body"><b>Recipe setup: bulk CSV import</b></summary><div class="panel-body">
      <p class="ash">Fill ~30–40 recipes in one sitting. Two CSVs use the same validation; a bad row is reported, never silently imported.</p>
      <p><b>1. Ingredients</b> — columns: <span class="mono">id,name,supplier,pack_description,pack_cost,pack_qty,unit_of_measure</span> (pack_cost in £; unit ∈ each/g/ml/portion)</p>
      <div class="rc-import" data-kind="sub_items"><input type="file" accept=".csv"><button class="btn rc-import-btn" type="button">Import ingredients</button><span class="rc-result ash"></span></div>
      <p style="margin-top:.8rem"><b>2. Recipes</b> — columns: <span class="mono">product_sku,product_name,sub_item_id,quantity</span> — attach ingredients to your real SKUs. <a class="btn" href="/api/recipe-template">Download template (pre-filled with your live products)</a></p>
      <div class="rc-import" data-kind="recipes"><input type="file" accept=".csv"><button class="btn rc-import-btn" type="button">Import recipes</button><span class="rc-result ash"></span></div>
    </div></details>`);

    return { stamp, body: parts.join('\n') };
  },
};
