const NOW = new Date(2026, 4, 10, 12).getTime();
const day = (n) => new Date(NOW + n * 864e5).toISOString().slice(0, 10);

test('unitOf normalizes aliases and unknown units', () => {
  assert.eq(unitOf('Tablespoons'), 'tbsp');
  assert.eq(unitOf('lbs'), 'lb');
  assert.eq(unitOf('bunch'), 'pc');
  assert.eq(unitOf(''), '');
});

test('fraction rounds to kitchen fractions', () => {
  assert.eq(fraction(0.5), '½');
  assert.eq(fraction(1.33), '1 ⅓');
  assert.eq(fraction(2.97), '3');
  assert.eq(fraction(0.02), '0');
});

test('displayQty converts between metric and US and handles small volumes', () => {
  assert.eq(displayQty(400, 'g', 'metric'), '400 g');
  assert.eq(displayQty(1500, 'g', 'metric'), '1.5 kg');
  assert.eq(displayQty(453.592, 'g', 'us'), '1 lb');
  assert.eq(displayQty(2, 'tbsp', 'metric'), '2 tbsp');
  assert.eq(displayQty(1, 'tsp', 'us'), '1 tsp');
  assert.eq(displayQty(1.5, 'cup', 'us'), '1 ½ cup');
  assert.eq(displayQty(3, 'clove', 'metric'), '3 cloves');
});

test('normName strips adjectives and plurals', () => {
  assert.eq(normName('2 large Tomatoes (ripe)'), 'tomato');
  assert.eq(normName('Boneless skinless chicken thighs'), 'chicken thigh');
  assert.eq(normName('Berries'), 'berry');
});

test('findInPantry matches on shared words', () => {
  const pantry = [{ name: 'chicken thighs' }, { name: 'parmesan' }];
  assert.eq(findInPantry(pantry, 'boneless chicken').name, 'chicken thighs');
  assert.eq(findInPantry(pantry, 'grated parmesan cheese').name, 'parmesan');
  assert.eq(findInPantry(pantry, 'tofu'), null);
});

test('ingredientStatus detects shortfalls in compatible units', () => {
  const pantry = [{ name: 'rice', qty: 200, unit: 'g' }, { name: 'milk', qty: 1, unit: 'l' }];
  const s = ingredientStatus(pantry, { name: 'rice', qty: 300, unit: 'g' }, 1);
  assert.ok(!s.have); assert.near(s.short.qty, 100, 1e-9);
  assert.ok(ingredientStatus(pantry, { name: 'milk', qty: 2, unit: 'cup' }, 1).have);
  assert.ok(ingredientStatus([], { name: 'salt', qty: 1, unit: 'tsp' }, 1).have, 'staples assumed');
  assert.ok(!ingredientStatus(pantry, { name: 'rice', qty: 150, unit: 'g' }, 2).have, 'multiplier applied');
});

test('pantryMatch weights expiring items double', () => {
  const pantry = [{ name: 'spinach', qty: 200, unit: 'g', exp: day(1) }, { name: 'eggs', qty: 6, unit: 'pc', exp: day(20) }];
  const m = pantryMatch(pantry, { ingredients: [{ name: 'spinach', qty: 100, unit: 'g' }, { name: 'eggs', qty: 2, unit: 'pc' }, { name: 'feta', qty: 50, unit: 'g' }] }, NOW);
  assert.eq(m.pct, 75);
  assert.eq(m.rescues, 1);
});

test('aisleOf groups items for the store', () => {
  assert.eq(aisleOf('green onions'), 'Produce');
  assert.eq(aisleOf('salmon fillet'), 'Meat & fish');
  assert.eq(aisleOf('heavy cream'), 'Dairy & eggs');
  assert.eq(aisleOf('mystery item'), 'Other');
});

test('buildShoppingList merges recipes, scales servings and subtracts the pantry', () => {
  const r1 = { title: 'A', servings: 2, ingredients: [{ name: 'chicken breast', qty: 400, unit: 'g' }, { name: 'salt', qty: 1, unit: 'tsp' }] };
  const r2 = { title: 'B', servings: 4, ingredients: [{ name: 'chicken', qty: 0.5, unit: 'kg' }, { name: 'lime', qty: 2, unit: 'pc' }] };
  const list = buildShoppingList([{ recipe: r1, servings: 4 }, { recipe: r2, servings: 4 }], [{ name: 'chicken', qty: 300, unit: 'g' }]);
  const chicken = list.find((x) => /chicken/.test(x.name));
  assert.near(chicken.qty, 1000, 1e-6, '800 + 500 - 300 = 1000 g');
  assert.deepEq(chicken.recipes, ['A', 'B']);
  assert.ok(!list.some((x) => x.name === 'salt'), 'staples skipped');
  assert.eq(list.find((x) => x.name === 'lime').aisle, 'Produce');
});

test('buildShoppingList skips items the pantry fully covers', () => {
  const r = { title: 'X', servings: 1, ingredients: [{ name: 'rice', qty: 100, unit: 'g' }] };
  assert.eq(buildShoppingList([{ recipe: r, servings: 1 }], [{ name: 'rice', qty: 1, unit: 'kg' }]).length, 0);
});

test('buildShoppingList trusts the pantry when units cannot be compared', () => {
  const r = { title: 'X', servings: 2, ingredients: [{ name: 'rice', qty: 1.5, unit: 'cup' }, { name: 'cabbage', qty: 200, unit: 'g' }] };
  assert.eq(buildShoppingList([{ recipe: r, servings: 2 }], [{ name: 'rice', qty: 1, unit: 'kg' }, { name: 'cabbage', qty: 0.5, unit: 'pc' }]).length, 0);
});

test('deductRecipe subtracts quantities and drops used-up items', () => {
  const out = deductRecipe([{ name: 'eggs', qty: 3, unit: 'pc' }, { name: 'rice', qty: 1, unit: 'kg' }], { ingredients: [{ name: 'eggs', qty: 3, unit: 'pc' }, { name: 'rice', qty: 250, unit: 'g' }] }, 1);
  assert.eq(out.used, 2);
  assert.deepEq(out.pantry, [{ name: 'rice', qty: 0.75, unit: 'kg' }]);
});

test('parseTimer reads minutes, ranges, seconds and hours', () => {
  assert.eq(parseTimer('Simmer for 12 minutes'), 720);
  assert.eq(parseTimer('Bake 20-25 min'), 1500);
  assert.eq(parseTimer('Rest 30 seconds'), 30);
  assert.eq(parseTimer('Braise for 2 hours'), 7200);
  assert.eq(parseTimer('Serve'), 0);
});

test('parseQuickAdd understands numbers, words, units and fractions', () => {
  assert.deepEq(parseQuickAdd('3 eggs, 500g chicken and half a cabbage'), [{ name: 'eggs', qty: 3, unit: '' }, { name: 'chicken', qty: 500, unit: 'g' }, { name: 'cabbage', qty: 0.5, unit: '' }]);
  assert.eq(parseQuickAdd('1/2 cup milk')[0].qty, 0.5);
});

test('weekStart is Monday 00:00 and planNutrition sums servings', () => {
  const ws = new Date(weekStart(new Date(2026, 4, 14).getTime()));
  assert.eq(ws.getDay(), 1); assert.eq(ws.getDate(), 11);
  const n = planNutrition([{ recipe: { nutrition: { kcal: 400, protein_g: 30 } }, servings: 2 }, { recipe: { nutrition: { kcal: 100 } }, servings: 1 }]);
  assert.eq(n.kcal, 900); assert.eq(n.protein_g, 60);
});
