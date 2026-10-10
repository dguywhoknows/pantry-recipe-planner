const { $, $$, h, esc, busy, toast, store } = Kit;

const state = Object.assign({ pantry: null, saved: [], plan: [], shopping: { extra: [], checked: [] }, log: [] }, store.get('state', {}));
if (!state.pantry) state.pantry = store.get('pantry.items', null) || SAMPLE_PANTRY.map((p) => Object.assign({}, p));
if (!state.saved.length && !store.get('state')) state.saved = DEMO_RECIPES.recipes.map((r, i) => Object.assign({ id: 'r' + (i + 1), fav: i === 0, cooked: 0, added: Date.now() }, r));
const save = () => store.set('state', state);
save();

let suggestions = [];
let current = null, servings = 2, detailTarget = '#detail';
const sys = () => $('#units').value;
const uid = () => Math.random().toString(36).slice(2, 9);
const byId = (id) => state.saved.find((r) => r.id === id);
const logEvent = (type, name, rid) => { state.log.unshift({ t: Date.now(), type, name, rid }); state.log = state.log.slice(0, 300); };
const fmtDay = (t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/* ================= pantry ================= */
function renderPantry() {
  const now = Date.now();
  state.pantry.sort((a, b) => (daysLeft(a, now) ?? 999) - (daysLeft(b, now) ?? 999));
  $('#pantryCount').textContent = state.pantry.length + ' items';
  const box = $('#pantry');
  box.innerHTML = '';
  if (!state.pantry.length) box.append(h('div', { class: 'empty' }, 'Pantry is empty.'));
  state.pantry.forEach((p) => {
    const dl = daysLeft(p, now);
    const tag = dl == null ? h('span') : h('span', { class: 'tag ' + (dl <= 1 ? 'bad' : dl <= 3 ? 'warn' : '') }, dl < 0 ? 'expired' : dl === 0 ? 'today' : dl + 'd');
    box.append(h('div', { class: 'pi' },
      h('div', {}, p.name, ' ', h('span', { class: 'q' }, p.qty != null ? displayQty(p.qty, p.unit, sys()) : '')),
      tag,
      h('button', { title: 'Remove', 'aria-label': 'Remove ' + p.name, onclick: () => removeItem(p, 'binned') }, '×')));
  });
}
function removeItem(p, why) {
  state.pantry = state.pantry.filter((x) => x !== p);
  const dl = daysLeft(p, Date.now());
  logEvent(dl != null && dl < 0 ? 'wasted' : why, p.name);
  save(); renderAll();
}
function addItems(items) {
  items.forEach((i) => {
    const ex = state.pantry.find((p) => normName(p.name) === normName(i.name) && p.qty != null && i.qty != null && toBase(1, p.unit).fam === toBase(1, i.unit).fam);
    if (ex) { ex.qty = +fromBase(toBase(ex.qty, ex.unit).v + toBase(i.qty, i.unit).v, ex.unit).toFixed(2); if (i.exp && (!ex.exp || i.exp > ex.exp)) ex.exp = i.exp; }
    else state.pantry.push({ name: i.name, qty: i.qty ?? null, unit: unitOf(i.unit), exp: i.exp || null });
    logEvent('added', i.name);
  });
  save(); renderAll();
}
$('#addForm').onsubmit = (e) => {
  e.preventDefault();
  const name = $('#addName').value.trim();
  if (!name) return;
  addItems([{ name, qty: $('#addQty').value ? +$('#addQty').value : null, unit: $('#addUnit').value, exp: $('#addExp').value || null }]);
  e.target.reset(); $('#addName').focus();
};
const shelfGuess = (n) => (/chicken|fish|beef|pork|salmon|milk|spinach|berr|lettuce|herb/i.test(n) ? 3 : /egg|cheese|yogurt|cabbage|carrot|lemon|lime|apple/i.test(n) ? 14 : 60);
$('#quickBtn').onclick = (e) => busy(e.currentTarget, async () => {
  const text = $('#quick').value.trim();
  if (!text) return;
  const out = await AI.chat([
    { role: 'system', content: 'Parse grocery/pantry text into items. Units must be one of: g, kg, ml, l, tsp, tbsp, cup, oz, lb, pc, clove, can. Estimate typical shelf life in days for each (fridge for fresh items). Return JSON {"items":[{"name":"","qty":number|null,"unit":"","shelf_days":number}]}.' },
    { role: 'user', content: text },
  ], { json: true, temperature: 0, demo: () => ({ items: parseQuickAdd(text).map((i) => Object.assign({}, i, { shelf_days: shelfGuess(i.name) })) }) });
  const items = (out.items || []).map((i) => ({ name: i.name, qty: i.qty ?? null, unit: i.unit, exp: i.shelf_days ? new Date(Date.now() + i.shelf_days * DAY_MS).toISOString().slice(0, 10) : null }));
  addItems(items);
  $('#quick').value = '';
  toast(`Added ${items.length} items`);
});

/* ================= suggestions ================= */
async function suggest() {
  if (!state.pantry.length) return toast('Add something to your pantry first', 'err');
  const now = Date.now();
  const diets = $$('#diets input:checked').map((c) => c.value);
  const inv = state.pantry.map((p) => { const dl = daysLeft(p, now); return `${p.name}${p.qty != null ? ` (${p.qty}${p.unit ? ' ' + p.unit : ''})` : ''}${dl != null && dl <= 3 ? ' [EXPIRES IN ' + Math.max(0, dl) + ' DAYS]' : ''}`; }).join('\n');
  const out = await AI.chat([
    { role: 'system', content: `You are a resourceful home chef who hates food waste. Suggest 3 different recipes that mostly use the pantry below, prioritizing items marked EXPIRES. Assume salt, pepper, oil and water are available. Keep missing ingredients to at most 3 per recipe.
Return JSON {"recipes":[{"title":"","time_min":number,"servings":number,"difficulty":"easy|medium|hard","cuisine":"","why":"one sentence on what it uses up","ingredients":[{"name":"","qty":number|null,"unit":"g|kg|ml|l|tsp|tbsp|cup|pc|clove|can"}],"steps":["imperative steps, include times like '5 minutes'"],"nutrition":{"kcal":number,"protein_g":number,"carbs_g":number,"fat_g":number}}]} (nutrition per serving).` },
    { role: 'user', content: `Pantry:\n${inv}\n\nConstraints: ${diets.join(', ') || 'none'}; max ${$('#time').value} minutes; cuisine: ${$('#cuisine').value}.` },
  ], { json: true, temperature: 0.8, maxTokens: 3500, demo: DEMO_RECIPES });
  suggestions = (out.recipes || []).slice(0, 3);
  current = null;
  renderSuggestions();
  $('#detail').innerHTML = '';
}
function recipeCard(r, onOpen, selected) {
  const sc = pantryMatch(state.pantry, r, Date.now());
  return h('article', { class: 'card recipe' + (selected ? ' sel' : ''), tabindex: 0, onclick: onOpen, onkeydown: (e) => e.key === 'Enter' && onOpen() },
    h('h2', {}, r.title),
    h('div', { class: 'row small muted' }, `${r.time_min} min`, '·', r.difficulty || 'easy', '·', `${r.nutrition?.kcal ?? '?'} kcal`),
    r.why ? h('div', { class: 'small' }, r.why) : null,
    h('div', { class: 'small muted' }, `Pantry match ${sc.pct}%${sc.rescues ? ` · uses ${sc.rescues} expiring` : ''}`),
    h('div', { class: 'bar use-bar' }, h('span', { style: `width:${sc.pct}%` })));
}
function renderSuggestions() {
  const box = $('#recipes');
  box.innerHTML = '';
  suggestions.forEach((r) => box.append(recipeCard(r, () => openRecipe(r, '#detail'), r === current)));
}
function openRecipe(r, target) {
  current = r;
  detailTarget = target;
  servings = r.servings || 2;
  if (target === '#detail') renderSuggestions(); else renderBox();
  renderDetail(target);
  $(target).scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function saveRecipe(r) {
  if (r.id && byId(r.id)) return r;
  const copy = Object.assign({}, r, { id: uid(), fav: false, cooked: 0, added: Date.now() });
  state.saved.unshift(copy);
  save();
  return copy;
}

function renderDetail(target) {
  const r = current, box = $(target);
  box.innerHTML = '';
  if (!r) return;
  const mult = servings / (r.servings || 1), n = r.nutrition || {};
  const saved = r.id && byId(r.id);
  const missing = r.ingredients.map((i) => ({ i, s: ingredientStatus(state.pantry, i, mult) })).filter(({ s }) => !s.have || s.short);
  box.append(h('div', { class: 'card stack' },
    h('div', { class: 'row between' }, h('h2', { style: 'margin:0;font-size:20px' }, r.title), h('div', { class: 'row' },
      h('button', { class: 'btn primary', onclick: () => startCook(r) }, 'Cook mode'),
      h('button', { class: 'btn', onclick: () => cooked(r, mult) }, 'I cooked this'),
      saved ? null : h('button', { class: 'btn', onclick: () => { current = saveRecipe(r); toast('Saved to recipe box'); renderDetail(target); renderBox(); } }, 'Save'),
      h('select', { style: 'width:auto', 'aria-label': 'Add to day', onchange: (e) => { if (!e.target.value) return; const s = saveRecipe(r); current = s; state.plan.push({ day: +e.target.value, rid: s.id, servings }); save(); renderAll(); toast(`Added to ${WEEKDAYS[+e.target.value]}`); } },
        h('option', { value: '' }, 'Add to plan…'), WEEKDAYS.map((d, i) => h('option', { value: i }, d))))),
    h('div', { class: 'row' },
      h('label', { style: 'display:flex;align-items:center;gap:10px;font-weight:600' }, 'Servings',
        h('input', { type: 'range', min: 1, max: 12, value: servings, style: 'width:160px', oninput: (e) => { servings = +e.target.value; renderDetail(target); } }), h('b', {}, servings)),
      h('span', { class: 'grow' }),
      ['kcal', 'protein_g', 'carbs_g', 'fat_g'].map((k) => h('span', { class: 'tag' }, `${n[k] ?? '?'}${k === 'kcal' ? ' kcal' : 'g ' + k.split('_')[0]}`)), h('span', { class: 'small muted' }, 'per serving')),
    h('div', { class: 'grid cols-2' },
      h('div', {}, h('h3', {}, 'Ingredients'), r.ingredients.map((i) => {
        const s = ingredientStatus(state.pantry, i, mult);
        const mark = s.p && s.short ? h('span', { class: 'miss' }, `short ${displayQty(s.short.qty, s.short.unit, sys())}`) : s.have || s.p ? h('span', { class: 'have' }, 'have') : h('span', { class: 'miss' }, 'need');
        return h('div', { class: 'ing' }, h('span', {}, h('b', {}, displayQty(i.qty != null ? i.qty * mult : null, i.unit, sys())), ' ', i.name), mark);
      }),
      missing.length ? h('button', { class: 'btn sm', style: 'margin-top:10px', onclick: () => {
        missing.forEach(({ i, s }) => state.shopping.extra.push({ id: uid(), text: `${s.short ? displayQty(s.short.qty, s.short.unit, sys()) : i.qty != null ? displayQty(i.qty * mult, i.unit, sys()) : ''} ${i.name}`.trim(), aisle: aisleOf(i.name) }));
        save(); renderShopping(); toast(`${missing.length} items added to the shopping list`);
      } }, `Add ${missing.length} missing to shopping list`) : h('p', { class: 'small muted' }, 'You have everything for this one.')),
      h('div', {}, h('h3', {}, 'Steps'), h('ol', { class: 'steps' }, r.steps.map((s) => h('li', {}, s)))))));
}

function cooked(r, mult) {
  const out = deductRecipe(state.pantry, r, mult);
  state.pantry = out.pantry;
  const s = r.id && byId(r.id);
  if (s) { s.cooked = (s.cooked || 0) + 1; s.lastCooked = Date.now(); }
  logEvent('cooked', r.title, r.id);
  save(); renderAll();
  toast(`Pantry updated: ${out.used} ingredients deducted`);
}

/* ================= cook mode ================= */
let timerInt = null;
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.35, 0.7].forEach((t) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 880; o.connect(g); g.connect(ctx.destination); g.gain.setValueAtTime(0.2, ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.3); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.3); });
  } catch {}
}
function startCook(r) {
  let i = 0;
  const box = $('#cook');
  const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const draw = () => {
    clearInterval(timerInt);
    const step = r.steps[i], secs = parseTimer(step);
    box.innerHTML = '';
    const timer = h('div', { class: 'timer' }, secs ? fmt(secs) : '');
    let left = secs;
    box.append(
      h('div', { class: 'count' }, `${r.title} · step ${i + 1} of ${r.steps.length}`),
      h('button', { class: 'btn ghost close', onclick: () => { clearInterval(timerInt); box.classList.add('hidden'); } }, 'Exit'),
      h('div', { class: 'step-text' }, step),
      secs ? timer : null,
      secs ? h('button', { class: 'btn primary', onclick: (e) => { e.currentTarget.disabled = true; timerInt = setInterval(() => { left--; timer.textContent = fmt(Math.max(0, left)); if (left <= 0) { clearInterval(timerInt); beep(); timer.textContent = 'Done'; } }, 1000); } }, `Start ${fmt(secs)} timer`) : null,
      h('div', { class: 'nav' },
        h('button', { class: 'btn', disabled: i === 0, onclick: () => { i--; draw(); } }, 'Back'),
        i < r.steps.length - 1 ? h('button', { class: 'btn primary', onclick: () => { i++; draw(); } }, 'Next') : h('button', { class: 'btn primary', onclick: () => { box.classList.add('hidden'); cooked(r, servings / (r.servings || 1)); } }, 'Finish and update pantry')));
  };
  box.classList.remove('hidden');
  draw();
}
document.addEventListener('keydown', (e) => {
  if ($('#cook').classList.contains('hidden')) return;
  if (e.key === 'Escape') $('#cook .close')?.click();
  if (e.key === 'ArrowRight') $$('#cook .nav .btn').pop()?.click();
  if (e.key === 'ArrowLeft') $('#cook .nav .btn')?.click();
});

/* ================= recipe box ================= */
function renderBox() {
  const q = $('#boxSearch').value.trim().toLowerCase(), fav = $('#favOnly').checked;
  const list = state.saved.filter((r) => (!fav || r.fav) && (!q || r.title.toLowerCase().includes(q) || r.ingredients.some((i) => i.name.toLowerCase().includes(q))));
  $('#boxSummary').textContent = `${state.saved.length} saved · ${state.saved.filter((r) => r.fav).length} favorites · cooked ${state.saved.reduce((a, r) => a + (r.cooked || 0), 0)} times`;
  const box = $('#box');
  box.innerHTML = '';
  if (!list.length) box.append(h('div', { class: 'empty' }, state.saved.length ? 'No recipes match.' : 'Saved recipes appear here. Suggest a few on the Kitchen page.'));
  list.forEach((r) => {
    const card = recipeCard(r, () => openRecipe(r, '#boxDetail'), r === current);
    card.classList.add('box-card');
    card.prepend(h('div', { class: 'row between' },
      h('span', { class: 'small muted' }, r.cooked ? `Cooked ${r.cooked}×` : 'Not cooked yet'),
      h('div', { class: 'row', style: 'gap:6px' },
        h('button', { class: 'fav' + (r.fav ? ' on' : ''), title: r.fav ? 'Unfavorite' : 'Favorite', 'aria-label': 'Favorite', onclick: (e) => { e.stopPropagation(); r.fav = !r.fav; save(); renderBox(); } }, '★'),
        h('button', { class: 'btn ghost sm', 'aria-label': 'Delete recipe', onclick: (e) => { e.stopPropagation(); if (!confirm(`Delete "${r.title}"?`)) return; state.saved = state.saved.filter((x) => x !== r); state.plan = state.plan.filter((p) => p.rid !== r.id); if (current === r) { current = null; $('#boxDetail').innerHTML = ''; } save(); renderAll(); } }, 'Delete'))));
    box.append(card);
  });
}
$('#boxSearch').oninput = renderBox;
$('#favOnly').onchange = renderBox;

/* ================= meal plan ================= */
const planEntries = () => state.plan.map((p) => ({ p, recipe: byId(p.rid) })).filter((x) => x.recipe);
function renderPlan() {
  const ws = weekStart(Date.now()), today = (new Date().getDay() + 6) % 7;
  const week = $('#week');
  week.innerHTML = '';
  WEEKDAYS.forEach((d, di) => {
    const col = h('div', { class: 'day' + (di === today ? ' today' : ''), ondragover: (e) => { e.preventDefault(); col.classList.add('over'); }, ondragleave: () => col.classList.remove('over'),
      ondrop: (e) => { e.preventDefault(); col.classList.remove('over'); const idx = +e.dataTransfer.getData('text/plain'); if (state.plan[idx]) { state.plan[idx].day = di; save(); renderPlan(); } } },
      h('h3', {}, h('span', {}, d), h('span', { class: 'small muted' }, fmtDay(ws + di * DAY_MS))));
    state.plan.forEach((p, idx) => {
      if (p.day !== di) return;
      const r = byId(p.rid);
      if (!r) return;
      col.append(h('div', { class: 'meal', draggable: 'true', ondragstart: (e) => e.dataTransfer.setData('text/plain', idx) },
        h('b', {}, r.title),
        h('div', { class: 'row' },
          h('input', { type: 'number', min: 1, max: 20, value: p.servings, title: 'Servings', 'aria-label': 'Servings', onchange: (e) => { p.servings = Math.max(1, +e.target.value || 1); save(); renderPlan(); } }),
          h('span', { class: 'small muted' }, 'servings'),
          h('span', { class: 'grow' }),
          h('button', { class: 'btn ghost sm', title: 'Cook', onclick: () => { current = r; servings = p.servings; startCook(r); } }, 'Cook'),
          h('button', { class: 'btn ghost sm', title: 'Remove', 'aria-label': 'Remove meal', onclick: () => { state.plan.splice(idx, 1); save(); renderPlan(); } }, '×'))));
    });
    const sel = h('select', { 'aria-label': 'Add a recipe to ' + d, style: 'font-size:12px', onchange: (e) => { if (!e.target.value) return; const r = byId(e.target.value); state.plan.push({ day: di, rid: r.id, servings: r.servings || 2 }); save(); renderPlan(); } },
      h('option', { value: '' }, '+ Add recipe'), state.saved.map((r) => h('option', { value: r.id }, r.title)));
    col.append(sel);
    week.append(col);
  });
  const entries = planEntries();
  const n = planNutrition(entries.map(({ p, recipe }) => ({ recipe, servings: p.servings })));
  const meals = entries.reduce((a, { p }) => a + p.servings, 0);
  $('#planSummary').textContent = `${entries.length} meals planned · ${meals} servings · ${7 - new Set(entries.map((e) => e.p.day)).size} empty days`;
  $('#planNutrition').innerHTML = '';
  [['Calories', Math.round(n.kcal).toLocaleString()], ['Protein', Math.round(n.protein_g) + ' g'], ['Carbs', Math.round(n.carbs_g) + ' g'], ['Fat', Math.round(n.fat_g) + ' g'], ['Per serving', meals ? Math.round(n.kcal / meals) + ' kcal' : '—']]
    .forEach(([k, v]) => $('#planNutrition').append(h('div', { class: 'stat' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v))));
}
$('#clearPlan').onclick = () => { if (state.plan.length && confirm('Clear every meal this week?')) { state.plan = []; save(); renderPlan(); } };
$('#autoPlan').onclick = () => {
  if (!state.saved.length) return toast('Save some recipes first', 'err');
  const now = Date.now();
  const ranked = state.saved.slice().sort((a, b) => pantryMatch(state.pantry, b, now).pct - pantryMatch(state.pantry, a, now).pct || (b.fav ? 1 : 0) - (a.fav ? 1 : 0));
  let k = 0, added = 0;
  WEEKDAYS.forEach((_, di) => { if (state.plan.some((p) => p.day === di)) return; const r = ranked[k++ % ranked.length]; state.plan.push({ day: di, rid: r.id, servings: r.servings || 2 }); added++; });
  save(); renderPlan();
  toast(added ? `Filled ${added} days, best pantry matches first` : 'Every day already has a meal');
};
$('#planToList').onclick = () => {
  const entries = planEntries();
  if (!entries.length) return toast('Plan some meals first', 'err');
  state.shopping.fromPlan = buildShoppingList(entries.map(({ p, recipe }) => ({ recipe, servings: p.servings })), state.pantry);
  state.shopping.checked = [];
  save(); renderShopping();
  toast(`${state.shopping.fromPlan.length} items on the list`);
  Router.go('shopping');
};

/* ================= shopping ================= */
function shopItems() {
  const fromPlan = (state.shopping.fromPlan || []).map((x) => ({ id: 'p:' + normName(x.name), text: `${x.qty != null ? displayQty(x.qty, x.unit, sys()) + ' ' : ''}${x.name}`, name: x.name, qty: x.qty, unit: x.unit, aisle: x.aisle, note: x.recipes.join(', ') }));
  const extra = state.shopping.extra.map((x) => Object.assign({ name: x.text.replace(/^[\d.\/½¼¾⅓⅔⅛ ]+(kg|g|ml|l|cups?|tbsp|tsp|oz|lb|cans?|cloves?)?\s*/i, '') }, x));
  return fromPlan.concat(extra);
}
function renderShopping() {
  const items = shopItems(), checked = new Set(state.shopping.checked);
  $('#shopSummary').textContent = items.length ? `${items.length} items · ${items.filter((i) => checked.has(i.id)).length} in the cart` : 'Nothing on the list yet. Build one from the meal plan or add items below.';
  const box = $('#shopList');
  box.innerHTML = '';
  const groups = {};
  items.forEach((i) => (groups[i.aisle || aisleOf(i.name)] = groups[i.aisle || aisleOf(i.name)] || []).push(i));
  Object.keys(groups).sort().forEach((aisle) => {
    box.append(h('div', { class: 'aisle' }, h('h3', {}, aisle, ' ', h('span', { class: 'small muted' }, groups[aisle].length)),
      groups[aisle].map((i) => h('label', { class: 'shop-item' + (checked.has(i.id) ? ' done' : '') },
        h('input', { type: 'checkbox', checked: checked.has(i.id), onchange: (e) => { if (e.target.checked) state.shopping.checked.push(i.id); else state.shopping.checked = state.shopping.checked.filter((x) => x !== i.id); save(); renderShopping(); } }),
        h('span', {}, i.text),
        h('span', { class: 'small muted' }, i.note || ''),
        h('button', { class: 'btn ghost sm', 'aria-label': 'Remove ' + i.text, onclick: (e) => { e.preventDefault(); removeShop(i.id); } }, '×')))));
  });
}
function removeShop(id) {
  if (id.startsWith('p:')) state.shopping.fromPlan = (state.shopping.fromPlan || []).filter((x) => 'p:' + normName(x.name) !== id);
  else state.shopping.extra = state.shopping.extra.filter((x) => x.id !== id);
  state.shopping.checked = state.shopping.checked.filter((x) => x !== id);
  save(); renderShopping();
}
$('#shopAdd').onsubmit = (e) => {
  e.preventDefault();
  const text = $('#shopItem').value.trim();
  if (!text) return;
  const parsed = parseQuickAdd(text)[0] || { name: text };
  state.shopping.extra.push({ id: uid(), text, aisle: aisleOf(parsed.name) });
  save(); renderShopping();
  $('#shopItem').value = '';
};
$('#copyList').onclick = () => {
  const items = shopItems(), byAisle = {};
  items.forEach((i) => (byAisle[i.aisle] = byAisle[i.aisle] || []).push(i.text));
  const text = Object.keys(byAisle).sort().map((a) => `${a}\n${byAisle[a].map((t) => '- ' + t).join('\n')}`).join('\n\n');
  navigator.clipboard.writeText(text).then(() => toast('Copied shopping list'));
};
$('#boughtToPantry').onclick = () => {
  const items = shopItems().filter((i) => state.shopping.checked.includes(i.id));
  if (!items.length) return toast('Tick the items you bought first', 'err');
  addItems(items.map((i) => {
    const q = i.qty != null ? { qty: +i.qty.toFixed(2), unit: i.unit } : (() => { const p = parseQuickAdd(i.text)[0] || {}; return { qty: p.qty ?? null, unit: p.unit || '' }; })();
    return { name: i.name, qty: q.qty, unit: q.unit, exp: new Date(Date.now() + shelfGuess(i.name) * DAY_MS).toISOString().slice(0, 10) };
  }));
  items.forEach((i) => removeShop(i.id));
  toast(`${items.length} items moved to the pantry`);
};
$('#clearShop').onclick = () => { if (confirm('Clear the shopping list?')) { state.shopping = { extra: [], checked: [] }; save(); renderShopping(); } };

/* ================= insights ================= */
function renderInsights() {
  const now = Date.now(), monthAgo = now - 30 * DAY_MS;
  const recent = state.log.filter((e) => e.t >= monthAgo);
  const count = (t) => recent.filter((e) => e.type === t).length;
  const expiring = state.pantry.filter((p) => { const d = daysLeft(p, now); return d != null && d <= 7; }).sort((a, b) => daysLeft(a, now) - daysLeft(b, now));
  const used = count('cooked'), wasted = count('wasted');
  $('#insKpis').innerHTML = '';
  [['Pantry items', state.pantry.length], ['Expiring this week', expiring.length], ['Meals cooked (30d)', used], ['Items wasted (30d)', wasted], ['Saved recipes', state.saved.length]]
    .forEach(([k, v]) => $('#insKpis').append(h('div', { class: 'stat' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v))));
  const tl = $('#expTimeline');
  tl.innerHTML = '';
  if (!expiring.length) tl.append(h('div', { class: 'empty' }, 'Nothing expires in the next week.'));
  expiring.forEach((p) => {
    const d = daysLeft(p, now);
    const uses = state.saved.filter((r) => r.ingredients.some((i) => findInPantry([p], i.name))).map((r) => r.title);
    tl.append(h('div', { class: 'timeline-row' },
      h('span', { class: 'tag ' + (d <= 1 ? 'bad' : d <= 3 ? 'warn' : '') }, d < 0 ? 'expired' : d === 0 ? 'today' : `in ${d}d`),
      h('div', {}, h('b', {}, p.name), ' ', h('span', { class: 'muted' }, p.qty != null ? displayQty(p.qty, p.unit, sys()) : ''),
        h('div', { class: 'small muted' }, uses.length ? 'Used in: ' + uses.slice(0, 3).join(', ') : 'Not in any saved recipe'))));
  });
  const mc = $('#mostCooked');
  mc.innerHTML = '';
  const top = state.saved.filter((r) => r.cooked).sort((a, b) => b.cooked - a.cooked).slice(0, 6);
  if (!top.length) mc.append(h('div', { class: 'empty' }, 'Cook something to start the leaderboard.'));
  const max = top[0]?.cooked || 1;
  top.forEach((r) => mc.append(h('div', { class: 'timeline-row' }, h('b', {}, r.cooked + '×'), h('div', {}, r.title, h('div', { class: 'bar use-bar' }, h('span', { style: `width:${(100 * r.cooked) / max}%` }))))));
  const act = $('#activity');
  act.innerHTML = '';
  if (!state.log.length) act.append(h('div', { class: 'empty' }, 'No activity yet.'));
  const verb = { added: 'Added', cooked: 'Cooked', binned: 'Removed', wasted: 'Threw out (expired)' };
  state.log.slice(0, 25).forEach((e) => act.append(h('div', { class: 'timeline-row' }, h('span', { class: 'small muted' }, fmtDay(e.t)), h('div', {}, `${verb[e.type] || e.type} `, h('b', {}, e.name)))));
}

/* ================= boot ================= */
function renderAll() {
  renderPantry();
  renderSuggestions();
  if (current) renderDetail(detailTarget);
  renderBox();
  renderPlan();
  renderShopping();
  renderInsights();
}
$('#suggest').onclick = (e) => busy(e.currentTarget, suggest);
$('#units').onchange = renderAll;
Router.on('recipes', renderBox);
Router.on('plan', renderPlan);
Router.on('shopping', renderShopping);
Router.on('insights', renderInsights);
renderAll();

/* ================= AI command box ================= */
const dayIdx = (d) => { const s = String(d).slice(0, 3).toLowerCase(), i = WEEKDAYS.findIndex((w) => w.toLowerCase() === s); if (i < 0) throw new Error('Days: ' + WEEKDAYS.join(', ')); return i; };
const recipeNamed = (t) => { const s = String(t).toLowerCase(); const r = state.saved.find((x) => x.title.toLowerCase() === s) || state.saved.find((x) => x.title.toLowerCase().includes(s)) || suggestions.find((x) => x.title.toLowerCase().includes(s)); if (!r) throw new Error(`No recipe "${t}"`); return r.id ? r : saveRecipe(r); };
const normRecipe = (r) => ({ title: r.title, time_min: +r.time_min || 30, servings: +r.servings || 2, difficulty: r.difficulty || 'easy', cuisine: r.cuisine || '', why: r.why || '', ingredients: (r.ingredients || []).map((i) => (typeof i === 'string' ? { name: i, qty: null, unit: '' } : { name: i.name, qty: i.qty ?? null, unit: i.unit || '' })), steps: r.steps || [], nutrition: r.nutrition || {}, tags: r.tags || [] });
Copilot.register({
  context: () => { const now = Date.now(); return `Pantry: ${state.pantry.map((p) => `${p.name}${p.qty != null ? ' ' + p.qty + (p.unit || '') : ''}${daysLeft(p, now) != null ? ` (${daysLeft(p, now)}d left)` : ''}`).join(', ') || 'empty'}. Saved recipes: ${state.saved.map((r) => r.title).join(' | ') || 'none'}. Suggestions on screen: ${suggestions.map((r) => r.title).join(' | ') || 'none'}. Week plan: ${WEEKDAYS.map((d, i) => `${d}: ${state.plan.filter((p) => p.day === i).map((p) => byId(p.rid)?.title).filter(Boolean).join(' + ') || '-'}`).join('; ')}. Units: ${sys()}.`; },
  actions: [
    { name: 'add_to_pantry', description: 'Add groceries to the pantry with estimated shelf life', params: { items: 'array of {name, qty, unit (g|kg|ml|l|tsp|tbsp|cup|oz|lb|pc|clove|can), shelf_days}' },
      run: ({ items }) => { const list = (items || []).map((i) => ({ name: i.name, qty: i.qty ?? null, unit: i.unit || '', exp: new Date(Date.now() + (+i.shelf_days || shelfGuess(i.name)) * DAY_MS).toISOString().slice(0, 10) })); addItems(list); Router.go('kitchen'); return `Added ${list.map((i) => i.name).join(', ')}`; } },
    { name: 'remove_from_pantry', description: 'Remove an item (used up or thrown away)', params: { name: 'item', reason: 'used | binned' }, run: ({ name, reason }) => { const p = findInPantry(state.pantry, name); if (!p) throw new Error('Not in the pantry: ' + name); removeItem(p, reason === 'binned' ? 'binned' : 'used'); return `Removed ${p.name}`; } },
    { name: 'suggest_recipes', description: 'Suggest three recipes from the pantry with constraints', params: { diets: 'array from vegetarian, vegan, gluten-free, dairy-free, high-protein', max_minutes: '20 | 35 | 60 | 120', cuisine: 'any | Italian | Mexican | Indian | Chinese | Japanese | Thai | Mediterranean | Korean' },
      run: async ({ diets, max_minutes, cuisine }) => { Router.go('kitchen'); $$('#diets input').forEach((c) => (c.checked = (diets || []).includes(c.value))); if (max_minutes) $('#time').value = String([20, 35, 60, 120].reduce((a, b) => (Math.abs(b - max_minutes) < Math.abs(a - max_minutes) ? b : a))); if (cuisine) $('#cuisine').value = [...$('#cuisine').options].find((o) => o.textContent.toLowerCase() === String(cuisine).toLowerCase())?.value || 'any'; await suggest(); return suggestions.map((r) => r.title).join(' | '); } },
    { name: 'add_recipe', description: 'Save a recipe you wrote to the recipe box (use when planning meals that need specific recipes)', params: { title: 'title', time_min: 'minutes', servings: 'number', tags: 'e.g. ["vegetarian"]', ingredients: 'array of {name, qty, unit}', steps: 'array of steps', nutrition: '{kcal, protein_g, carbs_g, fat_g} per serving' },
      run: (r) => { const x = saveRecipe(normRecipe(r)); renderBox(); return `Saved ${x.title}`; } },
    { name: 'plan_meal', description: 'Put a saved or suggested recipe on a day of this week\'s plan', params: { day: WEEKDAYS.join(' | '), recipe: 'recipe title', servings: 'optional' },
      run: ({ day, recipe, servings: sv }) => { const di = dayIdx(day), r = recipeNamed(recipe); state.plan = state.plan.filter((p) => p.day !== di); state.plan.push({ day: di, rid: r.id, servings: +sv || r.servings || 2 }); save(); Router.go('plan'); renderPlan(); return `${WEEKDAYS[di]}: ${r.title}`; } },
    { name: 'auto_plan', description: 'Fill empty days with the saved recipes that best match the pantry', params: {}, run: () => { Router.go('plan'); $('#autoPlan').click(); return $('#planSummary').textContent; } },
    { name: 'shopping_list', description: 'Build the shopping list from the plan minus what is in the pantry', params: {}, run: () => { $('#planToList').click(); return `${(state.shopping.fromPlan || []).length} items: ${(state.shopping.fromPlan || []).map((x) => x.name).join(', ')}`; } },
    { name: 'add_to_shopping', description: 'Add items to the shopping list', params: { items: 'array of strings like "2 lemons"' }, run: ({ items }) => { (Array.isArray(items) ? items : [items]).forEach((text) => { const p = parseQuickAdd(text)[0] || { name: text }; state.shopping.extra.push({ id: uid(), text, aisle: aisleOf(p.name) }); }); save(); Router.go('shopping'); renderShopping(); return 'Added to the list'; } },
    { name: 'cook', description: 'Open step-by-step cooking mode for a recipe', params: { recipe: 'title', servings: 'optional' }, run: ({ recipe, servings: sv }) => { const r = recipeNamed(recipe); current = r; servings = +sv || r.servings || 2; startCook(r); return `Cooking ${r.title}`; } },
  ],
});
