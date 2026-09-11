'use strict';

// Phone-first stock counting and waste capture. The page has no database contract of its own:
// its entire server-rendered model comes through the same read-only stock context used by
// GET /api/stock/context, and its browser writes use the existing five-operation engine bridge.
const S = require('../../shared.js');

const esc = S.escapeHtml;
const EMPTY_CONTEXT = Object.freeze({
  ok: false,
  countSettings: [],
  openCounts: [],
  wasteEvents: [],
  ingredients: [],
  products: [],
});

function stockContext(value) {
  const source = value && typeof value === 'object' ? value : EMPTY_CONTEXT;
  const rows = (name) => (Array.isArray(source[name]) ? source[name].filter((row) => row && typeof row === 'object') : []);
  const optionalNumber = (number) => (number === null || number === undefined || !Number.isFinite(Number(number)) ? null : Number(number));
  return {
    ok: source.ok === true,
    countSettings: rows('countSettings').map((row) => ({
      ingredientId: String(row.ingredientId || ''),
      name: String(row.name || ''),
      unitOfMeasure: String(row.unitOfMeasure || ''),
      location: String(row.location || ''),
      walkOrder: optionalNumber(row.walkOrder),
      countUnit: String(row.countUnit || ''),
      countUnitQty: optionalNumber(row.countUnitQty),
      lastCountedUnits: optionalNumber(row.lastCountedUnits),
      expectedUnits: optionalNumber(row.expectedUnits),
    })),
    // Deliberately omit openedBy/enteredBy: this operational page shows only the name remembered
    // on the current device, never an attribution history or per-person score.
    openCounts: rows('openCounts').map((row) => ({
      id: String(row.id || ''), businessDate: String(row.businessDate || ''), kind: String(row.kind || ''),
    })),
    wasteEvents: rows('wasteEvents').map((row) => ({
      id: String(row.id || ''),
      businessDate: String(row.businessDate || ''),
      target: String(row.target || ''),
      name: String(row.name || ''),
      qty: optionalNumber(row.qty),
      unit: String(row.unit || ''),
      reason: String(row.reason || ''),
      note: row.note == null ? null : String(row.note),
      voided: row.voided === true,
    })),
    ingredients: rows('ingredients').map((row) => ({ id: String(row.id || ''), name: String(row.name || '') })),
    products: rows('products').map((row) => ({ id: String(row.id || ''), name: String(row.name || '') })),
  };
}

function getSection(_db, ctx) {
  if (!ctx || typeof ctx.stockContext !== 'function') return stockContext(null);
  try { return stockContext(ctx.stockContext()); }
  catch (_) { return stockContext(null); }
}

function jsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function defaultCountKind(businessDate) {
  const value = String(businessDate || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'spot';
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return 'spot';
  return date.getUTCDay() === 0 ? 'full' : 'spot';
}

function numberText(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return String(Number(value));
}

function locationMarkup(settings) {
  const locations = [...new Set(settings.map((row) => String(row.location || '')).filter(Boolean))];
  if (!locations.length) return '<div class="stock-empty">No count locations are available yet.</div>';
  return locations.map((location, index) => `<button class="stock-chip${index === 0 ? ' selected' : ''}" type="button" data-location-choice="${esc(location)}" aria-pressed="${index === 0 ? 'true' : 'false'}">${esc(location)}</button>`).join('');
}

function openCountMarkup(openCounts) {
  if (!openCounts.length) return '<div class="stock-empty">No open count to resume.</div>';
  return openCounts.map((count) => `<button class="stock-resume" type="button" data-resume-count="${esc(count.id)}" data-count-kind="${esc(count.kind)}" data-business-date="${esc(count.businessDate)}"><span><strong>${esc(count.kind)} count</strong><small>${esc(count.businessDate)}</small></span><span aria-hidden="true">Resume →</span></button>`).join('');
}

function countRowsMarkup(settings) {
  if (!settings.length) return '<div class="stock-empty">No active count lines are supplied by the stock context.</div>';
  let lastLocation = null;
  return settings.map((row) => {
    const location = String(row.location || 'Unassigned');
    const locationHead = location === lastLocation ? '' : `<div class="stock-location-head" data-location-head="${esc(location)}">${esc(location)}</div>`;
    lastLocation = location;
    const expected = numberText(row.expectedUnits);
    const last = numberText(row.lastCountedUnits);
    return `${locationHead}<article class="stock-count-row" data-count-row data-ingredient-id="${esc(row.ingredientId)}" data-location="${esc(location)}" data-expected="${row.expectedUnits == null ? '' : esc(String(row.expectedUnits))}">
      <div class="stock-row-title"><div><strong>${esc(row.name)}</strong><small>${esc(row.countUnit)} · ${esc(numberText(row.countUnitQty))} ${esc(row.unitOfMeasure)} supplied per count unit</small></div><span class="stock-order">#${esc(String(row.walkOrder))}</span></div>
      <div class="stock-reference"><span>Last <b>${esc(last)}</b></span><span>Expected <b>${esc(expected)}</b></span></div>
      <div class="stock-entry"><button type="button" data-step="-1" aria-label="Subtract one">−1</button><input type="number" min="0" step="any" inputmode="decimal" value="" placeholder="blank" aria-label="${esc(row.name)} in ${esc(row.countUnit)}"><button type="button" data-step="1" aria-label="Add one">+1</button></div>
      <div class="stock-fractions" aria-label="Fractions of one ${esc(row.countUnit)}"><button type="button" data-fraction="0.25">¼</button><button type="button" data-fraction="0.5">½</button><button type="button" data-fraction="0.75">¾</button></div>
      <div class="stock-line-status" data-line-status aria-live="polite">Blank — not counted</div>
    </article>`;
  }).join('');
}

function wasteChoiceMarkup(model) {
  const ingredients = model.ingredients.map((item) => `<button type="button" class="stock-item" data-waste-target="${esc(item.id)}" data-waste-type="ingredient"><strong>${esc(item.name)}</strong><small>ingredient</small></button>`);
  const products = model.products.map((item) => `<button type="button" class="stock-item" data-waste-target="${esc(item.id)}" data-waste-type="product"><strong>${esc(item.name)}</strong><small>product</small></button>`);
  return ingredients.concat(products).join('') || '<div class="stock-empty">No ingredients or products are supplied yet.</div>';
}

function wasteRecentMarkup(events) {
  if (!events.length) return '<div class="stock-empty">No recent waste entries.</div>';
  return events.map((event) => `<article class="stock-recent${event.voided ? ' is-voided' : ''}"><div><strong>${esc(event.name)}</strong><small>${esc(event.businessDate)} · ${esc(numberText(event.qty))} ${esc(event.unit)} · ${esc(event.reason)}</small>${event.note ? `<small>${esc(event.note)}</small>` : ''}</div>${event.voided ? S.rcc.tag('voided', 'warn') : ''}</article>`).join('');
}

function render(section) {
  const model = stockContext(section);
  const styles = `<style>${S.rcc.css()}
    .stock-page{max-width:680px;margin:0 auto;display:flex;flex-direction:column;gap:14px;padding-bottom:80px;color:var(--rtext);color-scheme:dark}
    .stock-screen[hidden]{display:none!important}
    .stock-card{background:linear-gradient(180deg,var(--rpanel) 0%,#12161a 100%);border:1px solid var(--rline);border-radius:var(--rradius);box-shadow:var(--rshadow);padding:16px}
    .stock-card h2,.stock-card h3{margin:0;color:var(--rtext)}
    .stock-card h2{font-size:20px}.stock-card h3{font-size:15px}
    .stock-card p{color:var(--rmuted);font-size:13px;line-height:1.5;margin:6px 0 0}
    .stock-label{display:block;color:#a5aeb7;font-size:11px;text-transform:uppercase;letter-spacing:.085em;font-weight:800;margin:0 0 7px}
    .stock-field{width:100%;min-height:48px;box-sizing:border-box;border:1px solid #303941;border-radius:10px;background:#101419;color:var(--rtext);padding:10px 12px;font:inherit;font-size:16px}
    .stock-field:focus,.stock-entry input:focus{outline:2px solid var(--rblue);outline-offset:1px}
    .stock-grid{display:grid;grid-template-columns:1fr;gap:12px}
    .stock-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}
    .stock-btn,.stock-chip,.stock-entry button,.stock-fractions button,.stock-item,.stock-resume{min-height:44px;border:1px solid #303941;border-radius:10px;background:#171c22;color:var(--rtext);font:inherit;cursor:pointer}
    .stock-btn{padding:10px 14px;font-weight:800}.stock-btn.primary{background:var(--raccent);border-color:var(--raccent);color:#fff}.stock-btn.danger{border-color:#5d2e30;color:#f4a09f;background:#2a1718}.stock-btn:disabled{opacity:.5;cursor:wait}
    .stock-feedback{min-height:20px;margin-top:9px;color:var(--rmuted);font-size:12px;line-height:1.45}.stock-feedback.good,.stock-line-status.good{color:var(--rgood)}.stock-feedback.bad,.stock-line-status.bad{color:#f4a09f}.stock-feedback.warn,.stock-line-status.warn{color:var(--rwarn)}
    .stock-locations,.stock-kind,.stock-unit-chips,.stock-reasons,.stock-fractions{display:flex;flex-wrap:wrap;gap:8px}
    .stock-chip,.stock-fractions button{padding:8px 13px}.stock-chip.selected,.stock-chip[aria-pressed="true"]{border-color:var(--rblue);background:#17263a;color:#c9ddff}
    .stock-kind{display:grid;grid-template-columns:1fr 1fr}.stock-kind .stock-chip{width:100%}
    .stock-open-list,.stock-recents,.stock-items{display:flex;flex-direction:column;gap:8px;margin-top:10px}
    .stock-resume,.stock-item{width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;text-align:left}
    .stock-resume span:first-child,.stock-item{min-width:0}.stock-resume strong,.stock-resume small,.stock-item strong,.stock-item small{display:block}.stock-resume small,.stock-item small{color:var(--rmuted);font-size:11px;margin-top:3px}
    .stock-topbar{display:flex;gap:8px;align-items:center;justify-content:space-between}.stock-topbar .stock-btn{flex:0 0 auto}
    .stock-count-meta{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}
    .stock-progress{margin-top:12px}.stock-progress-line{display:flex;justify-content:space-between;color:var(--rmuted);font-size:12px}.stock-track{height:8px;background:#252c33;border-radius:99px;overflow:hidden;margin-top:6px}.stock-track span{display:block;height:100%;width:0;background:var(--rgood);transition:width .2s}
    .stock-count-list{display:flex;flex-direction:column;gap:10px}
    .stock-location-head{position:sticky;top:0;z-index:2;background:#0b0d10e8;color:var(--raccent2);font-weight:850;text-transform:uppercase;letter-spacing:.08em;font-size:12px;padding:12px 4px 5px}
    .stock-count-row{background:var(--rpanel);border:1px solid var(--rline);border-radius:14px;padding:14px;box-shadow:var(--rshadow)}
    .stock-row-title{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.stock-row-title strong,.stock-row-title small{display:block}.stock-row-title small{color:var(--rmuted);font-size:11px;line-height:1.4;margin-top:4px}.stock-order{font-size:11px;color:var(--rmuted);font-variant-numeric:tabular-nums}
    .stock-reference{display:flex;gap:14px;margin:11px 0;color:var(--rmuted);font-size:12px}.stock-reference b{color:var(--rtext);font-variant-numeric:tabular-nums}
    .stock-entry{display:grid;grid-template-columns:64px 1fr 64px;gap:8px}.stock-entry button{font-weight:850;font-size:16px}.stock-entry input{min-width:0;min-height:48px;border:1px solid #303941;border-radius:10px;background:#0f1317;color:var(--rtext);font:700 20px ui-monospace,SFMono-Regular,Menlo,monospace;text-align:center}
    .stock-fractions{margin-top:8px}.stock-fractions button{flex:1;font-size:16px}
    .stock-line-status{min-height:18px;margin-top:8px;color:var(--rmuted);font-size:11px}.stock-line-status button{min-height:44px;border:1px solid #5c4822;border-radius:9px;background:#2b2111;color:#f3c76f;padding:7px 10px;margin-top:7px;font:inherit;font-weight:800}
    .stock-close-summary{margin-top:10px;border-left:3px solid var(--rgood);background:#10251b;color:#9de3bc;border-radius:0 9px 9px 0;padding:10px 12px;font-size:12px;line-height:1.5}
    .stock-search{margin-top:12px}.stock-items{max-height:260px;overflow:auto}.stock-item.selected{border-color:var(--rblue);background:#17263a}.stock-item[hidden]{display:none}
    .stock-waste-fields{display:grid;grid-template-columns:1fr;gap:14px;margin-top:14px}.stock-unit-chips .stock-chip,.stock-reasons .stock-chip{flex:1 1 88px}
    .stock-confirm{margin-top:12px;border:1px solid #5c4822;background:#2b2111;border-radius:12px;padding:12px;color:#f3c76f;font-size:13px;line-height:1.5}.stock-confirm .stock-btn{width:100%;margin-top:10px}
    .stock-recent{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;border-bottom:1px solid #222930;padding:9px 2px}.stock-recent:last-child{border-bottom:0}.stock-recent strong,.stock-recent small{display:block}.stock-recent small{color:var(--rmuted);font-size:11px;margin-top:3px}.stock-recent.is-voided{opacity:.62}
    .stock-empty{border:1px dashed #3a434d;border-radius:10px;padding:13px;color:var(--rmuted);font-size:12px}
    @media(max-width:700px){.sidebar{display:none!important}.app{grid-template-columns:1fr!important}.main{padding:14px!important}.page-head{margin-bottom:14px}.stock-actions{grid-template-columns:1fr}.stock-page{max-width:none}}
  </style>`;

  const body = `${styles}<div class="rcc stock-page" data-stock-page>
    <section class="stock-screen stock-grid" id="stock-identity" data-stock-screen="identity">
      ${!model.ok ? '<div class="stock-card"><div class="stock-feedback bad">Stock context is unavailable. Nothing can be opened or logged until it returns.</div></div>' : ''}
      <div class="stock-card">
        <h2>Who is counting?</h2><p>This name is remembered only on this device. No attribution history or score is shown here.</p>
        <label class="stock-label" for="stock-counter-name" style="margin-top:14px">Counter name</label>
        <input class="stock-field" id="stock-counter-name" data-counter-name maxlength="64" autocomplete="name" placeholder="Your name">
      </div>
      <div class="stock-card">
        <h3>Start location</h3><p>Choose where you begin; the count continues in supplied walk order.</p>
        <div class="stock-locations" data-location-list style="margin-top:11px">${locationMarkup(model.countSettings)}</div>
      </div>
      <div class="stock-card">
        <h3>Count kind</h3><p>Sunday defaults to <b>full</b>; weekdays default to <b>spot</b>. You can switch it before opening.</p>
        <div class="stock-kind" data-kind-toggle style="margin-top:11px"><button class="stock-chip" type="button" data-kind="spot" aria-pressed="false">Spot</button><button class="stock-chip" type="button" data-kind="full" aria-pressed="false">Full</button></div>
        <label class="stock-label" for="stock-business-date" style="margin-top:14px">Business date</label><input class="stock-field" id="stock-business-date" data-business-date type="date">
        <div class="stock-actions"><button class="stock-btn primary" type="button" data-open-count>Open count</button><button class="stock-btn" type="button" data-show-waste>Waste</button></div>
        <div class="stock-feedback" data-start-feedback aria-live="polite"></div>
      </div>
      <div class="stock-card"><h3>Open counts</h3><p>Resume an existing count without opening another.</p><div class="stock-open-list" data-open-counts>${openCountMarkup(model.openCounts)}</div></div>
    </section>

    <section class="stock-screen stock-grid" id="stock-count-list" data-stock-screen="count" hidden>
      <div class="stock-card">
        <div class="stock-topbar"><button class="stock-btn" type="button" data-back-identity>← Back</button><button class="stock-btn" type="button" data-show-waste>Waste</button></div>
        <div class="stock-count-meta"><span class="r-tag info" data-count-kind-label>count</span><span class="r-tag" data-count-date-label>date</span><span class="r-tag" data-count-location-label>walk order</span></div>
        <div class="stock-progress"><div class="stock-progress-line"><span>Progress</span><b data-progress-text>0 / ${model.countSettings.length}</b></div><div class="stock-track"><span data-progress-bar></span></div></div>
      </div>
      <div class="stock-count-list" data-count-list>${countRowsMarkup(model.countSettings)}</div>
      <div class="stock-card"><button class="stock-btn primary" type="button" data-close-count style="width:100%">Close count</button><div class="stock-feedback" data-close-feedback aria-live="polite"></div><div class="stock-close-summary" data-close-summary hidden></div></div>
    </section>

    <section class="stock-screen stock-grid" id="stock-waste" data-stock-screen="waste" hidden>
      <div class="stock-card"><div class="stock-topbar"><button class="stock-btn" type="button" data-back-from-waste>← Back</button><span class="r-tag warn">Waste</span></div><h2 style="margin-top:14px">Log waste</h2><p>Search the ingredient and product data supplied by the stock context.</p><input class="stock-field stock-search" type="search" data-waste-search placeholder="Search ingredients or products" aria-label="Search waste items"><div class="stock-items" data-waste-items>${wasteChoiceMarkup(model)}</div></div>
      <div class="stock-card stock-waste-fields">
        <div><span class="stock-label">Quantity</span><input class="stock-field" type="number" min="0" step="any" inputmode="decimal" data-waste-qty placeholder="0"></div>
        <div><span class="stock-label">Valid unit</span><div class="stock-unit-chips" data-waste-units><span class="stock-empty">Choose an item first.</span></div></div>
        <div><span class="stock-label">Reason</span><div class="stock-reasons" data-waste-reasons>${['prep', 'spoiled', 'dropped', 'over-made', 'returned', 'other'].map((reason) => `<button class="stock-chip" type="button" data-waste-reason="${reason}" aria-pressed="false">${reason}</button>`).join('')}</div></div>
        <label><span class="stock-label">Note (optional)</span><textarea class="stock-field" data-waste-note maxlength="200" rows="2" placeholder="What happened?"></textarea></label>
        <button class="stock-btn primary" type="button" data-review-waste>Review waste entry</button>
        <div class="stock-feedback" data-waste-feedback aria-live="polite"></div><div data-waste-confirm></div><div data-waste-undo></div>
      </div>
      <div class="stock-card"><h3>Recent waste</h3><div class="stock-recents" data-waste-recents>${wasteRecentMarkup(model.wasteEvents)}</div></div>
    </section>
  </div>
  <script>(function(){
    'use strict';
    var state=${jsonForScript(model)};
    var OPS=['count-open','count-set','count-close','waste','waste-void'];
    var REASONS=['prep','spoiled','dropped','over-made','returned','other'];
    var NAME_KEY='coyote.stock.counterName';
    var currentCount=null;
    var currentKind='spot';
    var selectedLocation='';
    var selectedTarget=null;
    var selectedUnit='';
    var selectedReason='';
    var pendingWaste=null;
    var lastUndoId=null;
    var returnScreen='identity';
    var saveTimers={};
    var page=document.querySelector('[data-stock-page]');
    if(!page)return;
    ${defaultCountKind.toString()}
    function one(selector,root){return(root||page).querySelector(selector);}
    function all(selector,root){return Array.prototype.slice.call((root||page).querySelectorAll(selector));}
    function html(value){return String(value==null?'':value).replace(/[&<>\"]/g,function(ch){return{'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[ch];});}
    function numText(value){return value===null||value===undefined||!isFinite(Number(value))?'—':String(Number(value));}
    function localDate(){var d=new Date();var pad=function(n){return String(n).padStart(2,'0');};return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}
    function rememberedName(){return String(one('[data-counter-name]').value||'').trim();}
    function feedback(el,text,tone){if(!el)return;el.textContent=text||'';el.className='stock-feedback'+(tone?' '+tone:'');}
    function show(screen){all('[data-stock-screen]').forEach(function(node){node.hidden=node.getAttribute('data-stock-screen')!==screen;});window.scrollTo(0,0);}
    function setPressed(nodes,value,attribute){nodes.forEach(function(node){var on=node.getAttribute(attribute)===value;node.setAttribute('aria-pressed',on?'true':'false');node.classList.toggle('selected',on);});}
    function requireName(el){if(rememberedName())return true;show('identity');one('[data-counter-name]').focus();feedback(one('[data-start-feedback]'),'Enter your name on this device first.','bad');if(el)feedback(el,'Enter your name on this device first.','bad');return false;}
    function postAction(op,args,statusEl){
      if(OPS.indexOf(op)===-1)return Promise.resolve({ok:false,error:'Operation refused by this page.'});
      if(!requireName(statusEl))return Promise.resolve({ok:false,error:'Counter name required.'});
      feedback(statusEl,'Saving…','');
      return fetch('/api/stock/action',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({op:op,args:args,by:rememberedName()})}).then(function(response){return response.json().catch(function(){return{ok:false,error:'The stock engine returned an unreadable response.'};}).then(function(data){data.httpOk=response.ok;return data;});}).catch(function(){return{ok:false,error:'The stock engine could not be reached.'};});
    }
    function refreshContext(){return fetch('/api/stock/context',{method:'GET',credentials:'same-origin',headers:{'accept':'application/json'}}).then(function(response){return response.json();}).then(function(next){if(next&&next.ok){state=next;renderOpenCounts();renderWasteItems();renderRecents();}return next;}).catch(function(){return null;});}
    function locations(){var seen={};return(state.countSettings||[]).map(function(row){return String(row.location||'');}).filter(function(value){if(!value||seen[value])return false;seen[value]=true;return true;});}
    function renderLocations(){var root=one('[data-location-list]');var list=locations();if(!list.length){root.innerHTML='<div class="stock-empty">No count locations are available yet.</div>';selectedLocation='';return;}if(list.indexOf(selectedLocation)===-1)selectedLocation=list[0];root.innerHTML=list.map(function(value){return'<button class="stock-chip'+(value===selectedLocation?' selected':'')+'" type="button" data-location-choice="'+html(value)+'" aria-pressed="'+(value===selectedLocation?'true':'false')+'">'+html(value)+'</button>';}).join('');}
    function renderOpenCounts(){var root=one('[data-open-counts]');var rows=state.openCounts||[];root.innerHTML=rows.length?rows.map(function(count){return'<button class="stock-resume" type="button" data-resume-count="'+html(count.id)+'" data-count-kind="'+html(count.kind)+'" data-business-date="'+html(count.businessDate)+'"><span><strong>'+html(count.kind)+' count</strong><small>'+html(count.businessDate)+'</small></span><span aria-hidden="true">Resume →</span></button>';}).join(''):'<div class="stock-empty">No open count to resume.</div>';}
    function orderedSettings(){return(state.countSettings||[]).slice().sort(function(a,b){var al=String(a.location||'');var bl=String(b.location||'');if(al!==bl){if(al===selectedLocation)return-1;if(bl===selectedLocation)return 1;return al.localeCompare(bl);}return Number(a.walkOrder||0)-Number(b.walkOrder||0);});}
    function rowMarkup(row,resume,lastLocation){var location=String(row.location||'Unassigned');var head=location===lastLocation?'':'<div class="stock-location-head" data-location-head="'+html(location)+'">'+html(location)+'</div>';var value=resume&&row.lastCountedUnits!==null&&row.lastCountedUnits!==undefined?String(Number(row.lastCountedUnits)):'';return head+'<article class="stock-count-row" data-count-row data-ingredient-id="'+html(row.ingredientId)+'" data-location="'+html(location)+'" data-expected="'+(row.expectedUnits==null?'':html(row.expectedUnits))+'"><div class="stock-row-title"><div><strong>'+html(row.name)+'</strong><small>'+html(row.countUnit)+' · '+html(numText(row.countUnitQty))+' '+html(row.unitOfMeasure)+' supplied per count unit</small></div><span class="stock-order">#'+html(row.walkOrder)+'</span></div><div class="stock-reference"><span>Last <b>'+html(numText(row.lastCountedUnits))+'</b></span><span>Expected <b>'+html(numText(row.expectedUnits))+'</b></span></div><div class="stock-entry"><button type="button" data-step="-1" aria-label="Subtract one">−1</button><input type="number" min="0" step="any" inputmode="decimal" value="'+html(value)+'" placeholder="blank" aria-label="'+html(row.name)+' in '+html(row.countUnit)+'"><button type="button" data-step="1" aria-label="Add one">+1</button></div><div class="stock-fractions" aria-label="Fractions of one '+html(row.countUnit)+'"><button type="button" data-fraction="0.25">¼</button><button type="button" data-fraction="0.5">½</button><button type="button" data-fraction="0.75">¾</button></div><div class="stock-line-status" data-line-status aria-live="polite">'+(value?'Resume value — edit or leave as counted':'Blank — not counted')+'</div></article>';}
    function renderCountRows(resume){var rows=orderedSettings();var last='';one('[data-count-list]').innerHTML=rows.length?rows.map(function(row){var markup=rowMarkup(row,resume,last);last=String(row.location||'Unassigned');return markup;}).join(''):'<div class="stock-empty">No active count lines are supplied by the stock context.</div>';updateProgress();setTimeout(function(){var head=all('[data-location-head]').find(function(node){return node.getAttribute('data-location-head')===selectedLocation;});if(head)head.scrollIntoView({block:'start'});},0);}
    function updateProgress(){var rows=all('[data-count-row]');var complete=rows.filter(function(row){return one('input',row).value!=='';}).length;one('[data-progress-text]').textContent=complete+' / '+rows.length;one('[data-progress-bar]').style.width=(rows.length?complete/rows.length*100:0)+'%';}
    function isDiscrepancy(row,raw){var supplied=row.getAttribute('data-expected');if(raw===''||supplied==='')return false;var actual=Number(raw);var expected=Number(supplied);return isFinite(actual)&&isFinite(expected)&&Math.abs(actual-expected)>0.000001;}
    function saveLine(row,force){if(!currentCount)return;var input=one('input',row);var status=one('[data-line-status]',row);var raw=input.value;if(raw!==''&&(!isFinite(Number(raw))||Number(raw)<=0)){status.textContent='Use a positive number, or leave it blank.';status.className='stock-line-status bad';return;}if(isDiscrepancy(row,raw)&&row.getAttribute('data-confirmed-value')!==raw&&!force){status.innerHTML='Expected '+html(row.getAttribute('data-expected'))+'. Reconfirm this discrepancy.<br><button type="button" data-confirm-discrepancy>Save '+html(raw)+' anyway</button>';status.className='stock-line-status warn';return;}if(force)row.setAttribute('data-confirmed-value',raw);status.textContent='Saving…';status.className='stock-line-status';postAction('count-set',{countId:currentCount.id,ingredientId:row.getAttribute('data-ingredient-id'),location:row.getAttribute('data-location'),countUnits:raw===''?null:Number(raw)},null).then(function(result){if(result.ok){status.textContent=result.line||'Saved';status.className='stock-line-status good';}else{status.textContent=result.reason||result.error||result.line||'Save refused';status.className='stock-line-status bad';}});}
    function queueSave(row){var key=row.getAttribute('data-ingredient-id')+'|'+row.getAttribute('data-location');row.removeAttribute('data-confirmed-value');one('[data-line-status]',row).textContent='Waiting to autosave…';one('[data-line-status]',row).className='stock-line-status';clearTimeout(saveTimers[key]);saveTimers[key]=setTimeout(function(){saveLine(row,false);},450);updateProgress();}
    function beginCount(count,resume){currentCount=count;currentKind=count.kind;one('[data-count-kind-label]').textContent=String(count.kind||'count')+' count';one('[data-count-date-label]').textContent=count.businessDate||'';one('[data-count-location-label]').textContent='starts '+(selectedLocation||'in walk order');one('[data-close-summary]').hidden=true;feedback(one('[data-close-feedback]'),'','');renderCountRows(resume);show('count');}
    function itemByTarget(target){var combined=(state.ingredients||[]).map(function(item){return{id:item.id,name:item.name,type:'ingredient'};}).concat((state.products||[]).map(function(item){return{id:item.id,name:item.name,type:'product'};}));return combined.find(function(item){return item.id===target;})||null;}
    function renderWasteItems(){var root=one('[data-waste-items]');var items=(state.ingredients||[]).map(function(item){return{id:item.id,name:item.name,type:'ingredient'};}).concat((state.products||[]).map(function(item){return{id:item.id,name:item.name,type:'product'};}));root.innerHTML=items.length?items.map(function(item){return'<button type="button" class="stock-item'+(selectedTarget===item.id?' selected':'')+'" data-waste-target="'+html(item.id)+'" data-waste-type="'+item.type+'"><strong>'+html(item.name)+'</strong><small>'+item.type+'</small></button>';}).join(''):'<div class="stock-empty">No ingredients or products are supplied yet.</div>';}
    function validUnits(item){if(!item)return[];if(item.type==='product')return['portion'];var hasCount=(state.countSettings||[]).some(function(row){return row.ingredientId===item.id;});return hasCount?['base','count']:['base'];}
    function renderUnits(){var root=one('[data-waste-units]');var valid=validUnits(itemByTarget(selectedTarget));if(valid.indexOf(selectedUnit)===-1)selectedUnit=valid[0]||'';root.innerHTML=valid.length?valid.map(function(unit){return'<button class="stock-chip'+(unit===selectedUnit?' selected':'')+'" type="button" data-waste-unit="'+unit+'" aria-pressed="'+(unit===selectedUnit?'true':'false')+'">'+unit+'</button>';}).join(''):'<span class="stock-empty">Choose an item first.</span>';}
    function renderRecents(){var root=one('[data-waste-recents]');var events=state.wasteEvents||[];root.innerHTML=events.length?events.map(function(event){return'<article class="stock-recent'+(event.voided?' is-voided':'')+'"><div><strong>'+html(event.name)+'</strong><small>'+html(event.businessDate)+' · '+html(numText(event.qty))+' '+html(event.unit)+' · '+html(event.reason)+'</small>'+(event.note?'<small>'+html(event.note)+'</small>':'')+'</div>'+(event.voided?'<span class="r-tag warn">voided</span>':'')+'</article>';}).join(''):'<div class="stock-empty">No recent waste entries.</div>';}
    function clearWasteConfirmation(){pendingWaste=null;one('[data-waste-confirm]').innerHTML='';}
    function reviewWaste(){var status=one('[data-waste-feedback]');if(!requireName(status))return;var item=itemByTarget(selectedTarget);var qty=Number(one('[data-waste-qty]').value);var note=String(one('[data-waste-note]').value||'');if(!item){feedback(status,'Choose an ingredient or product.','bad');return;}if(!isFinite(qty)||qty<=0){feedback(status,'Enter a positive waste quantity.','bad');return;}if(validUnits(item).indexOf(selectedUnit)===-1){feedback(status,'Choose a valid unit.','bad');return;}if(REASONS.indexOf(selectedReason)===-1){feedback(status,'Choose a waste reason.','bad');return;}pendingWaste={target:item.id,name:item.name,qty:qty,unit:selectedUnit,reason:selectedReason,note:note};feedback(status,'Check the entry before logging it.','warn');one('[data-waste-confirm]').innerHTML='<div class="stock-confirm"><strong>Confirm waste</strong><br>'+html(item.name)+' · '+html(qty)+' '+html(selectedUnit)+' · '+html(selectedReason)+(note?'<br>'+html(note):'')+'<button class="stock-btn danger" type="button" data-log-waste>Log this waste</button></div>';}
    function logWaste(){if(!pendingWaste)return;var status=one('[data-waste-feedback]');var args={target:pendingWaste.target,qty:pendingWaste.qty,unit:pendingWaste.unit,reason:pendingWaste.reason};if(pendingWaste.note)args.note=pendingWaste.note;postAction('waste',args,status).then(function(result){if(!result.ok){feedback(status,result.reason||result.error||result.line||'Waste entry refused.','bad');return;}feedback(status,result.line||'Waste logged.','good');lastUndoId=result.id||null;one('[data-waste-confirm]').innerHTML='';pendingWaste=null;one('[data-waste-qty]').value='';one('[data-waste-note]').value='';one('[data-waste-undo]').innerHTML=lastUndoId?'<button class="stock-btn" type="button" data-undo-waste style="width:100%">Undo this waste entry</button>':'';refreshContext();});}
    function undoWaste(){if(!lastUndoId)return;var status=one('[data-waste-feedback]');var id=lastUndoId;postAction('waste-void',{id:id},status).then(function(result){if(!result.ok){feedback(status,result.reason||result.error||result.line||'Undo refused.','bad');return;}feedback(status,result.line||'Waste entry voided.','good');lastUndoId=null;one('[data-waste-undo]').innerHTML='';refreshContext();});}
    try{one('[data-counter-name]').value=localStorage.getItem(NAME_KEY)||'';}catch(_e){}
    one('[data-counter-name]').addEventListener('input',function(){try{localStorage.setItem(NAME_KEY,this.value);}catch(_e){}});
    one('[data-business-date]').value=localDate();
    currentKind=defaultCountKind(one('[data-business-date]').value);setPressed(all('[data-kind]'),currentKind,'data-kind');
    one('[data-business-date]').addEventListener('change',function(){currentKind=defaultCountKind(this.value);setPressed(all('[data-kind]'),currentKind,'data-kind');});
    renderLocations();renderOpenCounts();renderWasteItems();renderUnits();renderRecents();
    page.addEventListener('click',function(event){
      var button=event.target.closest('button');if(!button||!page.contains(button))return;
      if(button.hasAttribute('data-location-choice')){selectedLocation=button.getAttribute('data-location-choice');setPressed(all('[data-location-choice]'),selectedLocation,'data-location-choice');return;}
      if(button.hasAttribute('data-kind')){currentKind=button.getAttribute('data-kind');setPressed(all('[data-kind]'),currentKind,'data-kind');return;}
      if(button.hasAttribute('data-open-count')){var status=one('[data-start-feedback]');var date=one('[data-business-date]').value;if(!date){feedback(status,'Choose the business date.','bad');return;}button.disabled=true;postAction('count-open',{businessDate:date,kind:currentKind},status).then(function(result){button.disabled=false;if(!result.ok||!result.id){feedback(status,result.reason||result.error||result.line||'Count open refused.','bad');return;}feedback(status,result.line||'Count opened.','good');beginCount({id:result.id,businessDate:date,kind:currentKind},false);refreshContext();});return;}
      if(button.hasAttribute('data-resume-count')){if(!requireName(one('[data-start-feedback]')))return;beginCount({id:button.getAttribute('data-resume-count'),businessDate:button.getAttribute('data-business-date'),kind:button.getAttribute('data-count-kind')},true);return;}
      if(button.hasAttribute('data-show-waste')){if(!requireName(one('[data-start-feedback]')))return;returnScreen=one('[data-stock-screen="count"]').hidden?'identity':'count';show('waste');return;}
      if(button.hasAttribute('data-back-identity')){show('identity');return;}
      if(button.hasAttribute('data-back-from-waste')){show(returnScreen);return;}
      if(button.hasAttribute('data-step')||button.hasAttribute('data-fraction')){var row=button.closest('[data-count-row]');var input=one('input',row);var current=input.value===''?0:Number(input.value);if(button.hasAttribute('data-step')){var next=current+Number(button.getAttribute('data-step'));input.value=next>0?String(next):'';}else{var whole=Math.floor(Math.max(0,current));input.value=String(whole+Number(button.getAttribute('data-fraction')));}queueSave(row);return;}
      if(button.hasAttribute('data-confirm-discrepancy')){saveLine(button.closest('[data-count-row]'),true);return;}
      if(button.hasAttribute('data-close-count')){if(!currentCount)return;button.disabled=true;var closeFeedback=one('[data-close-feedback]');postAction('count-close',{countId:currentCount.id},closeFeedback).then(function(result){button.disabled=false;if(!result.ok){feedback(closeFeedback,result.reason||result.error||result.line||'Close refused.','bad');return;}feedback(closeFeedback,'Count closed by the stock engine.','good');var summary=one('[data-close-summary]');summary.textContent=result.line||'';summary.hidden=!result.line;refreshContext();});return;}
      if(button.hasAttribute('data-waste-target')){selectedTarget=button.getAttribute('data-waste-target');all('[data-waste-target]').forEach(function(node){node.classList.toggle('selected',node===button);});renderUnits();clearWasteConfirmation();return;}
      if(button.hasAttribute('data-waste-unit')){selectedUnit=button.getAttribute('data-waste-unit');setPressed(all('[data-waste-unit]'),selectedUnit,'data-waste-unit');clearWasteConfirmation();return;}
      if(button.hasAttribute('data-waste-reason')){selectedReason=button.getAttribute('data-waste-reason');setPressed(all('[data-waste-reason]'),selectedReason,'data-waste-reason');clearWasteConfirmation();return;}
      if(button.hasAttribute('data-review-waste')){reviewWaste();return;}
      if(button.hasAttribute('data-log-waste')){logWaste();return;}
      if(button.hasAttribute('data-undo-waste')){undoWaste();}
    });
    page.addEventListener('input',function(event){
      if(event.target.matches('[data-count-row] input'))queueSave(event.target.closest('[data-count-row]'));
      if(event.target.matches('[data-waste-search]')){var query=event.target.value.trim().toLowerCase();all('[data-waste-target]').forEach(function(item){item.hidden=query&&item.textContent.toLowerCase().indexOf(query)===-1;});}
      if(event.target.matches('[data-waste-qty],[data-waste-note]'))clearWasteConfirmation();
    });
  })();</script>`;

  return { stamp: model.ok ? 'live stock context' : 'stock context unavailable', body };
}

module.exports = {
  key: 'stock',
  route: '/coyote/stock',
  workspace: 'coyote',
  title: 'Stock count',
  sub: 'Count the walk and log waste — writes are validated by the stock engine',
  getSection,
  render,
  jsonForScript,
  defaultCountKind,
};
