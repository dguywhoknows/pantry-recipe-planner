# pantry-recipe-planner

[![tests](https://github.com/dguywhoknows/pantry-recipe-planner/actions/workflows/tests.yml/badge.svg)](https://github.com/dguywhoknows/pantry-recipe-planner/actions/workflows/tests.yml)

Track what's in your kitchen, get AI recipes that use up what's expiring, then scale, convert, shop and cook with built-in timers.

Live: https://dguywhoknows.github.io/pantry-recipe-planner/

## Overview

Pantry Chef keeps an inventory of your kitchen with expiry dates, and you can quick-add items in plain English ("3 eggs, 500g chicken, half a cabbage"). The AI suggests three recipes that put your soon-to-expire food first. Everything after that runs locally: matching each ingredient against your pantry, a pantry-match score that weights expiring items, servings scaling with metric/US unit conversion and kitchen fractions, an auto shopping list for shortfalls, and a full-screen cook mode that turns "simmer for 12 minutes" into a one-tap timer. When you finish, the pantry deducts what you used.

## Pages

- **Kitchen**
- **Recipes**
- **Meal plan**
- **Shopping**
- **Insights**
- **Settings**

## Features

- Pantry with expiry tracking and color-coded urgency
- Natural-language quick add (AI, with a local regex parser fallback)
- AI recipes with dietary filters, time limit, cuisine and per-serving nutrition
- Fuzzy ingredient ↔ pantry matching with adjective stripping and singularization
- Unit engine: mass/volume/count families, metric ↔ US, kitchen fractions (⅓, ¾ …)
- Servings slider, shortfall-aware shopping list, 'I cooked this' pantry deduction
- Cook mode: big-text steps, keyboard navigation, auto-detected timers with an audio alarm
- Recipe box page: save suggestions, favorites, search by title or ingredient, cooked counter
- Meal plan page: Monday to Sunday planner with drag-and-drop between days, per-meal servings, auto-fill from best pantry matches, weekly nutrition totals
- Shopping page: list built from the whole week's plan, merged across recipes, scaled by servings, minus what the pantry already holds, grouped by store aisle
- Check off items as you shop, then move them into the pantry with estimated expiry dates
- Insights page: 7-day expiry timeline with the saved recipes that use each item, most-cooked leaderboard, waste vs cooked counts and an activity log
- Quick-adding an item you already have merges quantities across compatible units

## How it works

LLM calls are used for:

- Recipe generation that prioritizes expiring ingredients (JSON)
- Pantry text → structured items with estimated shelf life

Everything else (unit conversion, scaling, matching, scoring, shopping list, timers, inventory) runs locally in the browser.

## Getting started

No build step and no dependencies. Serve the folder with any static server:

```bash
git clone https://github.com/dguywhoknows/pantry-recipe-planner.git
cd pantry-recipe-planner
python -m http.server 8000
```

Then open http://localhost:8000.

### Configuration

Without an API key the app runs in demo mode with sample model output. To use a live model, open
**Settings → Configure provider** and paste a key for [Groq](https://console.groq.com/keys) or
[OpenRouter](https://openrouter.ai/keys). The key is stored in this browser's `localStorage` (namespaced to
this app) and is sent only to the selected provider.

## Testing

`src/core.js` holds the app's logic as pure functions and is covered by 15 unit tests.

```bash
node tests/run-node.js        # CI runs this on every push
```

Or open `tests/index.html` in a browser ([live](https://dguywhoknows.github.io/pantry-recipe-planner/tests/)).

## Project structure

```
index.html           markup for every page
src/app.js           UI, page wiring and event handlers
src/core.js          pure logic with no DOM access (unit-tested)
src/demo.js          sample responses used when no API key is configured
src/lib/ai.js        LLM client: Groq / OpenRouter, streaming, JSON mode, retries
src/lib/dom.js       DOM helpers, namespaced storage, markdown renderer
src/lib/router.js    hash router and the Settings page
styles/base.css      design tokens and shared components
styles/app.css       app-specific styles
tests/               unit tests (browser runner + Node runner for CI)
```

## Tech

- Unit-conversion engine with fraction rendering
- Web Audio API alarm
- localStorage persistence
- Pure logic in src/core.js covered by unit tests run in the browser and in CI
- Vanilla JavaScript, no framework or bundler
- Deployed with GitHub Pages

## License

MIT
