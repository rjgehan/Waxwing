import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { call, isoDate, newHousehold, newRecipe, plan, uploadImage, type Json } from '../../lib/api';
import { signIn } from '../../lib/ui';

/*
 * Replace from a paste, on Edit recipe: the recipe as it is copied out in the paste layout for an
 * AI to revise, the answer read the same way New recipe reads one and checked in the same form,
 * then saved over the same recipe. What a paste does not say — the picture, the links, the
 * filing — stays; an ingredient keeps its leaf by name; the plans that chose an optional extra
 * still have it. tests/api/recipe-replace.spec.ts covers what the server keeps.
 */

const COVER_JPEG = readFileSync(new URL('../fixtures/cover-8px.jpg', import.meta.url));

const NEW_VERSION = `Here's the new version:

Name: Lemon garlic pasta
Servings: 2
Prep Time: 5
Cook Time: 12
Description: Brighter, with garlic.
Ingredients:
- 200 | g | spaghetti
- 3 | clove | garlic
- 1 | | lemon
- 30 | g | Parmesan
Instructions:
1. Boil the spaghetti.
2. Fry the garlic in oil.
3. Toss everything with the lemon and parmesan.`;

async function lemonPasta() {
  const hh = await newHousehold();
  const cover = await uploadImage(hh.id, COVER_JPEG);
  const r = await newRecipe(
    hh.id,
    'Lemon pasta',
    [
      { name: 'spaghetti', qty: 400, unit: 'g' },
      { name: 'lemon', qty: 1.5 },
      { name: 'salt', qty: null },
      { name: 'parmesan', qty: 50, unit: 'g', optional: true },
    ],
    {
      instructions: '1. Boil the pasta.\n2. Toss with lemon.',
      categories: ['Weeknight'],
      coverImageId: cover,
      links: [{ url: 'https://example.com/lemon-pasta', label: null }],
    },
  );
  const parmesan = r.ingredients.find((i: Json) => i.ingredientName === 'parmesan');
  const meal = await plan(hh.id, isoDate(2), 'DINNER', { recipeId: r.id, includedOptionalIngredientIds: [parmesan.id] });
  return { hh, r, cover, meal };
}

test('a pasted new version replaces the recipe’s words and keeps everything else', async ({ page }) => {
  const { hh, r, cover, meal } = await lemonPasta();
  await signIn(page, hh.owner, hh.id);
  await page.goto(`/recipes/${r.id}/edit`);

  // Both forms stay on the page, the one not in use hidden, so each is looked in by its id.
  const edit = page.locator('form#edit-recipe');
  const check = page.locator('form#replace-recipe');

  // Something typed into the form first is still there after a look at the paste and back.
  await edit.getByLabel('Method').fill('Boil the pasta well.');
  await page.getByRole('button', { name: /^Replace from a paste/ }).click();
  await expect(page.getByRole('heading', { name: 'Replace from a paste' })).toBeVisible();
  await expect(page.getByRole('note').first()).toContainText('Its photos, links, filing, plans and sharing stay.');

  // Step 1 copies the recipe as it is, in the layout the reader takes, ending with the question.
  await expect(page.getByRole('heading', { name: 'Copy the recipe as it is' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ask an AI to change it' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy recipe' })).toBeVisible();
  const copied = page.locator('[aria-label="The recipe as it is"]');
  for (const line of ['Name: Lemon pasta', 'Servings: 4', '- 400 | g | spaghetti', '- 1½ | | lemon', '- | | salt', '1. Boil the pasta.', '2. Toss with lemon.']) {
    await expect(copied).toContainText(line);
  }
  await expect(copied).toContainText(/What to change:\s*$/);
  // No dish or servings to pick: it is this recipe.
  await expect(page.getByLabel('What do you want to make?')).toHaveCount(0);

  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(edit.getByLabel('Method')).toHaveValue('Boil the pasta well.');
  await page.getByRole('button', { name: /^Replace from a paste/ }).click();

  // A link is not a recipe, and there is no From a link here to send it to.
  await page.getByLabel('The recipe to read').fill('https://example.com/another-pasta');
  await page.getByRole('button', { name: 'Read into form' }).click();
  await expect(page.getByText('That’s a link, not a recipe — paste the recipe’s text.')).toBeVisible();

  await page.getByLabel('The recipe to read').fill(NEW_VERSION);
  await page.getByRole('button', { name: 'Read into form' }).click();

  // Check recipe: the new words, the recipe's own picture and link, and the parmesan's leaf.
  await expect(page.getByRole('heading', { name: 'Check recipe' })).toBeVisible();
  await expect(page.getByText('Here’s the new version — check the amounts')).toBeVisible();
  await expect(check.getByLabel('Recipe name')).toHaveValue('Lemon garlic pasta');
  await expect(check.getByLabel('Serves')).toHaveValue('2');
  await expect(check.getByLabel('A line about it')).toHaveValue('Brighter, with garlic.');
  for (const [n, name] of ['spaghetti', 'garlic', 'lemon', 'Parmesan'].entries()) {
    await expect(check.getByLabel(`Ingredient ${n + 1}`, { exact: true })).toHaveValue(name);
  }
  await expect(check.getByLabel('Ingredient 4 optional')).toHaveAttribute('aria-pressed', 'true');
  await expect(check.getByLabel('Ingredient 1 optional')).toHaveAttribute('aria-pressed', 'false');
  await expect(check.getByLabel('Method')).toHaveValue(
    'Boil the spaghetti.\nFry the garlic in oil.\nToss everything with the lemon and parmesan.',
  );
  await expect(check.getByLabel('Link 1', { exact: true })).toHaveValue('https://example.com/lemon-pasta');

  // Cancel goes back to the paste, still pasted, to read again.
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByLabel('The recipe to read')).toHaveValue(NEW_VERSION);
  await page.getByRole('button', { name: 'Read into form' }).click();
  await expect(check.getByLabel('Recipe name')).toHaveValue('Lemon garlic pasta');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  // The same recipe, at the same address, saying the new version.
  await expect(page.getByRole('heading', { name: 'Lemon garlic pasta' })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/recipes/${r.id}$`));
  const saved = await call('GET', `/api/recipes/${r.id}?householdId=${hh.id}`, { token: hh.owner.token });
  expect(saved).toMatchObject({
    id: r.id,
    name: 'Lemon garlic pasta',
    servings: 2,
    prepTimeMinutes: 5,
    cookTimeMinutes: 12,
    description: 'Brighter, with garlic.',
    instructions: 'Boil the spaghetti.\nFry the garlic in oil.\nToss everything with the lemon and parmesan.',
    coverImageId: cover,
    categories: ['Weeknight'],
    links: [{ url: 'https://example.com/lemon-pasta', label: null }],
  });
  expect(saved.ingredients.map((i: Json) => [i.ingredientName, i.quantity, i.unit || null, i.optional])).toEqual([
    ['spaghetti', 200, 'g', false],
    ['garlic', 3, 'clove', false],
    ['lemon', 1, null, false],
    ['parmesan', 30, 'g', true],
  ]);

  // Still planned, still with the parmesan it chose — the new parmesan.
  const day = isoDate(2);
  const [entry] = await call('GET', `/api/households/${hh.id}/meal-plan?start=${day}&end=${day}`, { token: hh.owner.token });
  expect(entry).toMatchObject({ id: meal.id, recipeId: r.id });
  expect(entry.includedOptionalIngredientIds).toEqual([saved.ingredients[3].id]);
});

test('a paste that cannot be read says why, and the recipe is untouched', async ({ page }) => {
  const { hh, r } = await lemonPasta();
  await signIn(page, hh.owner, hh.id);
  await page.goto(`/recipes/${r.id}/edit`);
  await page.getByRole('button', { name: /^Replace from a paste/ }).click();
  // No From a link to point at on this page.
  await expect(page.getByRole('note').last()).not.toContainText('From a link');

  await page.getByLabel('The recipe to read').fill('Name: Lemon pasta\nJust add more lemon.');
  await page.getByRole('button', { name: 'Read into form' }).click();
  await expect(page.getByText(/Couldn’t find any ingredients/)).toBeVisible();
  await expect(page.locator('form#replace-recipe')).toHaveCount(0);

  const after = await call('GET', `/api/recipes/${r.id}?householdId=${hh.id}`, { token: hh.owner.token });
  expect(after.name).toBe('Lemon pasta');
  expect(after.ingredients).toHaveLength(4);
});
