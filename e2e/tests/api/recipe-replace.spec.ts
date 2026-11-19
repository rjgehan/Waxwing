import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { call, groceries, isoDate, newHousehold, newRecipe, plan, uploadImage, type Json } from '../../lib/api';

/*
 * Replace from a paste: a whole new version saved over a recipe, with the same PUT as any edit.
 * The recipe keeps its id, so everything that points at it stays — its planned meals, who it is
 * shared with, its public link, its tags, its photos. The one thing that points at a single
 * ingredient row is a planned meal's choice of optional extras, and the server carries that over
 * to the new rows by ingredient name. Groceries already added are left alone: adding the meal
 * again settles up with the new version.
 */

const COVER_JPEG = readFileSync(new URL('../fixtures/cover-8px.jpg', import.meta.url));

type Line = { name: string; qty: number | null; unit?: string; optional?: boolean };

/** The body Edit recipe sends — the web form's, which never sends photoIds. */
function version(recipe: Json, words: { name: string; servings: number; instructions: string; ingredients: Line[] }) {
  return {
    name: words.name,
    description: null,
    instructions: words.instructions,
    prepTimeMinutes: 5,
    cookTimeMinutes: 15,
    servings: words.servings,
    coverImageId: recipe.coverImageId,
    links: recipe.links,
    section: recipe.section,
    categories: recipe.categories,
    ingredients: words.ingredients.map((i) => ({
      ingredientName: i.name,
      quantity: i.qty,
      unit: i.unit ?? '',
      optional: i.optional ?? false,
    })),
  };
}

const entryOn = async (householdId: string, token: string, date: string) =>
  (await call('GET', `/api/households/${householdId}/meal-plan?start=${date}&end=${date}`, { token }))[0];

const rowFor = (recipe: Json, name: string) => recipe.ingredients.find((i: Json) => i.ingredientName === name);

test('a new version saved over a recipe keeps its id, plans, sharing, public link, tags and photos', async () => {
  const hh = await newHousehold();
  const friends = await newHousehold();
  const token = hh.owner.token;
  const cover = await uploadImage(hh.id, COVER_JPEG);
  const photo = await uploadImage(hh.id, COVER_JPEG);
  const r = await newRecipe(
    hh.id,
    'Lemon pasta',
    [
      { name: 'spaghetti', qty: 400, unit: 'g' },
      { name: 'lemon', qty: 2 },
      { name: 'salt', qty: null },
      { name: 'parmesan', qty: 50, unit: 'g', optional: true },
      { name: 'chilli flakes', qty: 1, unit: 'tsp', optional: true },
    ],
    { categories: ['Weeknight'], coverImageId: cover, photoIds: [photo], links: [{ url: 'https://example.com/lemon-pasta', label: null }] },
  );
  expect(r.categories).toEqual(['Weeknight']);
  await call('PUT', `/api/recipes/${r.id}/shares`, { token, body: { householdIds: [friends.id] } });
  await call('PUT', `/api/recipes/${r.id}/published`, { token, body: { published: true } });
  const { token: link } = await call('POST', `/api/recipes/${r.id}/link`, { token });
  // Planned at home with both extras, and by the friends with just the parmesan.
  const home = await plan(hh.id, isoDate(2), 'DINNER', {
    recipeId: r.id,
    servings: 2,
    includedOptionalIngredientIds: [rowFor(r, 'parmesan').id, rowFor(r, 'chilli flakes').id],
  });
  const theirs = await plan(friends.id, isoDate(3), 'DINNER', {
    recipeId: r.id,
    includedOptionalIngredientIds: [rowFor(r, 'parmesan').id],
  });

  // The new version, written for 2: the pasta and the parmesan stay (the parmesan typed in
  // capitals, as an AI might), the salt and the chilli go, and there is garlic now.
  const saved = await call('PUT', `/api/recipes/${r.id}`, {
    token,
    body: version(r, {
      name: 'Lemon garlic pasta',
      servings: 2,
      instructions: 'Boil the pasta.\nFry the garlic.\nToss it all with the lemon.',
      ingredients: [
        { name: 'spaghetti', qty: 200, unit: 'g' },
        { name: 'garlic', qty: 3, unit: 'clove' },
        { name: 'lemon', qty: 1 },
        { name: 'Parmesan ', qty: 30, unit: 'g', optional: true },
      ],
    }),
  });

  expect(saved.id).toBe(r.id);
  expect(saved).toMatchObject({
    name: 'Lemon garlic pasta',
    servings: 2,
    categories: ['Weeknight'],
    coverImageId: cover,
    photoIds: [photo],
    published: true,
    links: [{ url: 'https://example.com/lemon-pasta' }],
  });
  // In the order sent.
  expect(saved.ingredients.map((i: Json) => [i.ingredientName, i.quantity, i.optional])).toEqual([
    ['spaghetti', 200, false],
    ['garlic', 3, false],
    ['lemon', 1, false],
    ['parmesan', 30, true],
  ]);
  expect(saved.sharedWith).toHaveLength(1);
  expect((await call('GET', `/api/public/recipes/${link}`)).name).toBe('Lemon garlic pasta');

  // Both plans still have the meal, and the parmesan they chose is the new parmesan row; the
  // chilli is gone from the recipe, so it is gone from the choice.
  const parmesan = rowFor(saved, 'parmesan').id;
  const homeNow = await entryOn(hh.id, token, isoDate(2));
  expect(homeNow).toMatchObject({ id: home.id, recipeId: r.id, servings: 2 });
  expect(homeNow.includedOptionalIngredientIds).toEqual([parmesan]);
  const theirsNow = await entryOn(friends.id, token, isoDate(3));
  expect(theirsNow).toMatchObject({ id: theirs.id, recipeId: r.id });
  expect(theirsNow.includedOptionalIngredientIds).toEqual([parmesan]);
});

test('an ordinary edit keeps the extras a planned meal chose, and two of the same are paired in order', async () => {
  const hh = await newHousehold();
  const token = hh.owner.token;
  const r = await newRecipe(hh.id, 'Caesar salad', [
    { name: 'romaine', qty: 1 },
    { name: 'parmesan', qty: 20, unit: 'g', optional: true },
    { name: 'croutons', qty: 1, unit: 'cup', optional: true },
    { name: 'parmesan', qty: 10, unit: 'g', optional: true },
  ]);
  const [, sauce, croutons, top] = r.ingredients;
  // The parmesan on top and the croutons, but not the parmesan in the dressing.
  await plan(hh.id, isoDate(1), 'LUNCH', { recipeId: r.id, includedOptionalIngredientIds: [top.id, croutons.id] });

  // One word of the method changed, as before this kept nothing: every row is new on a save.
  const saved = await call('PUT', `/api/recipes/${r.id}`, {
    token,
    body: version(r, {
      name: 'Caesar salad',
      servings: 4,
      instructions: 'Chop. Toss. Serve.',
      ingredients: r.ingredients.map((i: Json) => ({ name: i.ingredientName, qty: i.quantity, unit: i.unit, optional: i.optional })),
    }),
  });
  expect(saved.ingredients.map((i: Json) => i.id)).not.toContain(sauce.id);
  const chosen = (await entryOn(hh.id, token, isoDate(1))).includedOptionalIngredientIds;
  expect([...chosen].sort()).toEqual([saved.ingredients[2].id, saved.ingredients[3].id].sort());
});

test('groceries already added are left alone, and adding the meal again settles up with the new version', async () => {
  const hh = await newHousehold({ cupboard: false });
  const token = hh.owner.token;
  const r = await newRecipe(hh.id, 'Fish tacos', [
    { name: 'cod', qty: 400, unit: 'g' },
    { name: 'tortillas', qty: 8 },
    { name: 'sour cream', qty: 100, unit: 'g' },
  ]);
  const day = isoDate(2);
  const meal = await plan(hh.id, day, 'DINNER', { recipeId: r.id, servings: 4 });
  await call('POST', `/api/households/${hh.id}/grocery-list/add-meal/${meal.id}`, { token });
  const status = async () =>
    (await call('GET', `/api/households/${hh.id}/grocery-list/plan-status?start=${day}&end=${day}`, { token }))[0].status;
  expect(await status()).toBe('ON_LIST');

  // Yoghurt instead of sour cream, and a lime.
  await call('PUT', `/api/recipes/${r.id}`, {
    token,
    body: version(r, {
      name: 'Fish tacos',
      servings: 4,
      instructions: 'Fry the fish.\nWarm the tortillas.',
      ingredients: [
        { name: 'cod', qty: 400, unit: 'g' },
        { name: 'tortillas', qty: 8 },
        { name: 'greek yoghurt', qty: 100, unit: 'g' },
        { name: 'lime', qty: 1 },
      ],
    }),
  });

  // The list is as it was until somebody adds the meal again; the Plan says so.
  const names = async () => (await groceries(hh.id)).map((i) => i.name).sort();
  expect(await names()).toEqual(['cod', 'sour cream', 'tortillas']);
  expect(await status()).toBe('NOT_ON_LIST');

  await call('POST', `/api/households/${hh.id}/grocery-list/add-meal/${meal.id}`, { token });
  expect(await names()).toEqual(['cod', 'greek yoghurt', 'lime', 'tortillas']);
  expect(await status()).toBe('ON_LIST');
});
