/* Units, ingredient matching, shopping-list aggregation and meal-plan helpers (pure, unit-tested). */

var DAY_MS = 864e5;
var UNITS = {
  g: ['mass', 1], kg: ['mass', 1000], oz: ['mass', 28.3495], lb: ['mass', 453.592],
  ml: ['vol', 1], l: ['vol', 1000], tsp: ['vol', 4.92892], tbsp: ['vol', 14.7868], cup: ['vol', 236.588], 'fl oz': ['vol', 29.5735],
  pc: ['count', 1], '': ['count', 1], clove: ['count', 1], can: ['count', 1], pinch: ['count', 1],
};
var ALIAS = { gram: 'g', grams: 'g', kilogram: 'kg', kilograms: 'kg', ounce: 'oz', ounces: 'oz', pound: 'lb', pounds: 'lb', lbs: 'lb', milliliter: 'ml', milliliters: 'ml', liter: 'l', liters: 'l', litre: 'l', teaspoon: 'tsp', teaspoons: 'tsp', tablespoon: 'tbsp', tablespoons: 'tbsp', cups: 'cup', piece: 'pc', pieces: 'pc', whole: 'pc', cloves: 'clove', cans: 'can' };
function unitOf(u) { u = String(u || '').toLowerCase().trim(); u = ALIAS[u] || u; return UNITS[u] ? u : u ? 'pc' : ''; }
function toBase(qty, u) { var x = UNITS[unitOf(u)]; return { fam: x[0], v: qty * x[1] }; }
function fromBase(v, u) { return v / UNITS[unitOf(u)][1]; }

/* Kitchen fractions to the nearest 1/8 or 1/3. */
function fraction(x) {
  var whole = Math.floor(x), r = x - whole;
  var fr = [[0, ''], [1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [3 / 8, '⅜'], [1 / 2, '½'], [5 / 8, '⅝'], [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞'], [1, '']];
  var best = fr[0];
  fr.forEach(function (f) { if (Math.abs(r - f[0]) < Math.abs(r - best[0])) best = f; });
  var w = best[0] === 1 ? whole + 1 : whole;
  return (w ? w : '') + (best[1] ? (w ? ' ' : '') + best[1] : w ? '' : '0');
}
/* Human-friendly quantity in metric or US units; small volumes as tsp/tbsp. */
function displayQty(qty, u, system) {
  if (qty == null || isNaN(qty)) return '';
  u = unitOf(u);
  var fam = UNITS[u][0];
  if (fam === 'count') return (qty % 1 ? fraction(qty) : String(qty)) + (u && u !== 'pc' ? ' ' + u + (qty > 1 && u !== 'pinch' ? 's' : '') : '');
  var v = toBase(qty, u).v;
  if (fam === 'vol' && v < 45) { var t = v / UNITS.tsp[1]; return t >= 3 ? fraction(v / UNITS.tbsp[1]) + ' tbsp' : fraction(t) + ' tsp'; }
  if (system === 'us') {
    if (fam === 'mass') return v >= 453 ? fraction(v / UNITS.lb[1]) + ' lb' : fraction(v / UNITS.oz[1]) + ' oz';
    return fraction(v / UNITS.cup[1]) + ' cup';
  }
  if (fam === 'mass') return v >= 1000 ? +(v / 1000).toFixed(2) + ' kg' : Math.round(v / 5) * 5 + ' g';
  return v >= 1000 ? +(v / 1000).toFixed(2) + ' l' : Math.round(v / 5) * 5 + ' ml';
}

/* ---------- ingredient matching ---------- */
var ADJ = /\b(fresh|chopped|diced|minced|sliced|large|small|medium|boneless|skinless|ripe|frozen|dried|ground|whole|raw|cooked|grated|shredded|extra|virgin|organic|unsalted|salted|to taste|optional|of|a|an|the)\b/g;
function normName(s) {
  return String(s).toLowerCase().replace(/\(.*?\)/g, '').replace(ADJ, '').replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean)
    .map(function (w) { return w.length > 3 ? w.replace(/(oes|ies|es|s)$/, function (m) { return m === 'ies' ? 'y' : m === 'oes' ? 'o' : ''; }) : w; }).join(' ').trim();
}
var STAPLES = /^(salt|pepper|black pepper|water|oil|olive oil|vegetable oil|sugar|flour)$/;
function findInPantry(pantry, name) {
  var n = normName(name);
  if (!n) return null;
  return pantry.find(function (p) {
    var pn = normName(p.name);
    return pn === n || pn.split(' ').some(function (w) { return w.length > 2 && n.split(' ').indexOf(w) >= 0; }) || n.indexOf(pn) >= 0 || pn.indexOf(n) >= 0;
  }) || null;
}
/* Do we have enough of an ingredient? Returns {p, have, short:{qty,unit}|null}. */
function ingredientStatus(pantry, ing, mult) {
  mult = mult || 1;
  var p = findInPantry(pantry, ing.name);
  if (!p) return { p: null, have: STAPLES.test(normName(ing.name)), short: null };
  if (ing.qty == null || p.qty == null) return { p: p, have: true, short: null };
  var need = toBase(ing.qty * mult, ing.unit), got = toBase(p.qty, p.unit);
  if (need.fam !== got.fam) return { p: p, have: true, short: null };
  return { p: p, have: got.v >= need.v * 0.95, short: got.v < need.v ? { qty: fromBase(need.v - got.v, ing.unit), unit: ing.unit } : null };
}
function daysLeft(item, now) { return item.exp ? Math.ceil((new Date(item.exp) - now) / DAY_MS) : null; }
/* Share of ingredients on hand, where items expiring within 3 days count double. */
function pantryMatch(pantry, recipe, now) {
  var have = 0, weight = 0, rescues = 0;
  recipe.ingredients.forEach(function (i) {
    var s = ingredientStatus(pantry, i, 1), dl = s.p ? daysLeft(s.p, now) : null, w = dl != null && dl <= 3 ? 2 : 1;
    weight += w;
    if (s.have || s.p) { have += w; if (w === 2) rescues++; }
  });
  return { pct: weight ? Math.round((100 * have) / weight) : 0, rescues: rescues };
}

/* ---------- shopping list ---------- */
var AISLES = [
  ['Produce', /lettuce|spinach|kale|cabbage|onion|garlic|tomato|potato|carrot|pepper|lemon|lime|apple|banana|berry|herb|basil|cilantro|parsley|ginger|mushroom|cucumber|zucchini|avocado|scallion|green onion|celery|broccoli/],
  ['Meat & fish', /chicken|beef|pork|lamb|turkey|bacon|sausage|fish|salmon|tuna|shrimp|prawn|tofu/],
  ['Dairy & eggs', /milk|cream|cheese|parmesan|butter|yogurt|egg/],
  ['Bakery', /bread|bun|tortilla|pita|bagel/],
  ['Pantry', /rice|pasta|noodle|flour|sugar|oil|vinegar|sauce|stock|broth|bean|lentil|can|oat|spice|cumin|paprika|salt|honey|soy|sesame/],
  ['Frozen', /frozen|ice cream|peas/],
];
function aisleOf(name) {
  var n = String(name).toLowerCase();
  var hit = AISLES.find(function (a) { return a[1].test(n); });
  return hit ? hit[0] : 'Other';
}
/* Combine ingredients from several (recipe, servings) pairs, subtract what the pantry already has. */
function buildShoppingList(plan, pantry) {
  var need = {};
  plan.forEach(function (entry) {
    var mult = entry.servings / (entry.recipe.servings || 1);
    entry.recipe.ingredients.forEach(function (i) {
      if (STAPLES.test(normName(i.name))) return;
      var nn = normName(i.name), b = i.qty == null ? null : toBase(i.qty * mult, i.unit);
      var key = Object.keys(need).find(function (k) { return k === nn || k.split(' ').some(function (w) { return w.length > 2 && nn.split(' ').indexOf(w) >= 0; }); }) || nn;
      var cur = need[key] || (need[key] = { name: i.name, fam: b ? b.fam : null, v: 0, unit: i.unit, unitless: false, recipes: [] });
      if (!b || (cur.fam && cur.fam !== b.fam)) cur.unitless = true; else { cur.v += b.v; cur.fam = b.fam; }
      if (cur.recipes.indexOf(entry.recipe.title) < 0) cur.recipes.push(entry.recipe.title);
    });
  });
  var out = [];
  Object.keys(need).forEach(function (k) {
    var n = need[k], p = findInPantry(pantry, n.name);
    var remaining = n.v;
    if (p && (n.unitless || p.qty == null)) return;
    if (p) { var g = toBase(p.qty, p.unit); if (g.fam !== n.fam) return; remaining = Math.max(0, n.v - g.v); }
    if (!n.unitless && remaining <= n.v * 0.05 && p) return;
    out.push({ name: n.name, qty: n.unitless ? null : fromBase(remaining, n.unit), unit: n.unit, aisle: aisleOf(n.name), recipes: n.recipes });
  });
  return out.sort(function (a, b) { return a.aisle.localeCompare(b.aisle) || a.name.localeCompare(b.name); });
}
/* Deduct a cooked recipe from the pantry. Returns {pantry, used}. Items used up are removed. */
function deductRecipe(pantry, recipe, mult) {
  var used = 0, next = pantry.map(function (p) { return Object.assign({}, p); });
  recipe.ingredients.forEach(function (i) {
    var p = findInPantry(next, i.name);
    if (!p || i.qty == null || p.qty == null) return;
    var need = toBase(i.qty * mult, i.unit), got = toBase(p.qty, p.unit);
    if (need.fam !== got.fam) return;
    p.qty = +fromBase(got.v - need.v, p.unit).toFixed(2);
    used++;
  });
  return { pantry: next.filter(function (p) { return p.qty == null || p.qty > 0.01; }), used: used };
}

/* ---------- parsing ---------- */
function parseTimer(step) {
  var m = String(step).match(/(\d+)(?:\s*(?:-|to|–)\s*(\d+))?\s*(sec|second|min|minute|hour|hr)/i);
  if (!m) return 0;
  var v = +(m[2] || m[1]);
  return v * (/^sec/i.test(m[3]) ? 1 : /^(hour|hr)/i.test(m[3]) ? 3600 : 60);
}
/* "3 eggs, 500g chicken and half a cabbage" -> [{name, qty, unit}] */
function parseQuickAdd(text) {
  var words = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, half: 0.5, dozen: 12 };
  return String(text).split(/,|\band\b|\n/).map(function (s) { return s.trim(); }).filter(Boolean).map(function (s) {
    var m = s.match(/^([\d.]+\/?\d*|[a-z]+)\s*(kg|g|ml|l|lbs?|oz|cups?|tbsp|tsp|cans?|cloves?)?\s*(?:of\s+)?(?:a\s+)?(.*)$/i);
    if (!m) return { name: s, qty: null, unit: '' };
    var q = m[1].indexOf('/') > 0 ? (function () { var p = m[1].split('/'); return +p[0] / +p[1]; })() : isNaN(+m[1]) ? words[m[1].toLowerCase()] : +m[1];
    if (q == null) return { name: s, qty: null, unit: '' };
    return { name: (m[3] || s).trim(), qty: q, unit: unitOf(m[2] || '') };
  });
}

/* ---------- meal plan ---------- */
var WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function weekStart(now) { var d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); }
/* Sum per-serving nutrition across a plan: plan = [{recipe, servings}] */
function planNutrition(plan) {
  var t = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
  plan.forEach(function (e) { var n = e.recipe.nutrition || {}; Object.keys(t).forEach(function (k) { t[k] += (+n[k] || 0) * e.servings; }); });
  return t;
}
