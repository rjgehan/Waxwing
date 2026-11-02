import { expect, test } from '@playwright/test';
import { INTEGRATION_KEY, admin, call, isoDate, newHousehold, newMember, newRecipe, plan, statusOf } from '../../lib/api';

test('the plan comes back in eating order, mains before their sides', async () => {
  const hh = await newHousehold();
  const owner = await admin();
  const main = await newRecipe(hh.id, 'Zucchini Lasagna', [{ name: 'zucchini', qty: 2 }]);
  const side = await newRecipe(hh.id, 'Apple Salad', [{ name: 'apple', qty: 1 }]);
  const lunch = await newRecipe(hh.id, 'Soup', [{ name: 'leek', qty: 1 }]);
  // Added out of order on purpose; names chosen so alphabetical order is wrong too.
  await plan(hh.id, isoDate(1), 'DINNER', { recipeId: main.id });
  await plan(hh.id, isoDate(1), 'SNACK', { itemName: 'almonds' });
  await plan(hh.id, isoDate(1), 'LUNCH', { recipeId: lunch.id });
  await plan(hh.id, isoDate(1), 'DINNER', { recipeId: side.id });
  await plan(hh.id, isoDate(1), 'BREAKFAST', { itemName: 'toast' });

  const entries = await call('GET', `/api/households/${hh.id}/meal-plan?start=${isoDate(1)}&end=${isoDate(1)}`, { token: owner.token });
  expect(entries.map((e: any) => `${e.mealType}:${e.recipeName ?? e.itemName}`)).toEqual([
    'BREAKFAST:toast', 'LUNCH:Soup', 'DINNER:Zucchini Lasagna', 'DINNER:Apple Salad', 'SNACK:almonds',
  ]);

  // The kiosk sees the same order — when the integration API is switched on at all.
  if ((await statusOf('GET', '/api/integration/households', { headers: { 'x-api-key': INTEGRATION_KEY } })) !== 503) {
    const [day] = await call('GET', `/api/integration/households/${hh.id}/plan?start=${isoDate(1)}&days=1`, {
      headers: { 'x-api-key': INTEGRATION_KEY },
    });
    const dinner = day.meals.find((m: any) => m.mealType === 'DINNER');
    expect(dinner.items.map((i: any) => i.name)).toEqual(['Zucchini Lasagna', 'Apple Salad']);
  }
});

test('plan-status says where each meal stands with the shopping, and changes nothing', async () => {
  const hh = await newHousehold();
  const owner = await admin();
  const r = await newRecipe(hh.id, 'Chili', [{ name: 'beans', qty: 2, unit: 'can' }, { name: 'onion', qty: 1 }]);
  const place = await call('POST', `/api/households/${hh.id}/places`, { token: owner.token, body: { name: 'Diner' } });
  const cooked = await plan(hh.id, isoDate(1), 'DINNER', { recipeId: r.id });
  const out = await plan(hh.id, isoDate(2), 'DINNER', { placeId: place.id });
  const path = `/api/households/${hh.id}/grocery-list/plan-status?start=${isoDate(0)}&end=${isoDate(6)}`;
  const byId = async () => new Map<string, any>((await call('GET', path, { token: owner.token })).map((s: any) => [s.entryId, s]));

  const before = await byId();
  expect(before.get(cooked.id)).toMatchObject({ status: 'NOT_ON_LIST', needs: 2 });
  expect(before.get(cooked.id).toAdd).toHaveLength(2);
  expect(before.get(out.id)).toMatchObject({ status: 'EAT_OUT', toAdd: [] });
  // Only looking.
  expect(await call('GET', `/api/households/${hh.id}/grocery-list`, { token: owner.token })).toEqual([]);

  await call('POST', `/api/households/${hh.id}/grocery-list/add-all?start=${isoDate(1)}&end=${isoDate(1)}`, { token: owner.token });
  expect((await byId()).get(cooked.id)).toMatchObject({ status: 'ON_LIST', toAdd: [] });

  // Members only, and no more than a year at a time.
  const elsewhere = await newHousehold();
  const outsider = await newMember(elsewhere.id);
  expect(await statusOf('GET', path, { token: outsider.token })).toBe(403);
  expect(
    await statusOf('GET', `/api/households/${hh.id}/grocery-list/plan-status?start=${isoDate(0)}&end=${isoDate(400)}`, {
      token: owner.token,
    }),
  ).toBe(400);
});

test('leftovers: chosen from the last few days, on the plan, and never on the list — as the phone and web send them', async () => {
  const hh = await newHousehold();
  const owner = await admin();
  const chili = await newRecipe(hh.id, 'Chili', [{ name: 'beans', qty: 2, unit: 'can' }]);
  const base = `/api/households/${hh.id}/meal-plan`;
  const cooked = await plan(hh.id, isoDate(1), 'DINNER', { recipeId: chili.id, servings: 6 });
  await call('POST', `/api/households/${hh.id}/grocery-list/add-all?start=${isoDate(1)}&end=${isoDate(1)}`, { token: owner.token });

  // The fill sheet asks what the next day's lunch could be leftovers of.
  const choices = await call('GET', `${base}/leftovers?date=${isoDate(2)}&mealType=LUNCH`, { token: owner.token });
  expect(choices.map((c: any) => c.id)).toEqual([cooked.id]);

  // And sends only which meal: the dish and its servings come from it.
  const lunch = await call('POST', `${base}/entries`, {
    token: owner.token, body: { date: isoDate(2), mealType: 'LUNCH', leftoversOf: cooked.id },
  });
  expect(lunch).toMatchObject({
    recipeId: chili.id, servings: 6, leftovers: true, leftoversFromDate: isoDate(1), leftoversFromMeal: 'DINNER',
  });
  expect(cooked.leftovers).toBe(false);

  await call('POST', `/api/households/${hh.id}/grocery-list/add-all?start=${isoDate(2)}&end=${isoDate(2)}`, { token: owner.token });
  const list = await call('GET', `/api/households/${hh.id}/grocery-list`, { token: owner.token });
  expect(list.map((i: any) => `${i.name} ${i.quantity}`)).toEqual(['beans 3']);
  const status = await call('GET', `/api/households/${hh.id}/grocery-list/plan-status?start=${isoDate(2)}&end=${isoDate(2)}`, {
    token: owner.token,
  });
  expect(status).toEqual([expect.objectContaining({ entryId: lunch.id, status: 'LEFTOVERS', toAdd: [] })]);

  // The options sheet's switch: off makes it a meal to shop for, on again takes it back off.
  expect((await call('PATCH', `${base}/entries/${lunch.id}`, { token: owner.token, body: { leftovers: false } })))
    .toMatchObject({ leftovers: false, leftoversFromDate: null });
  expect((await call('PATCH', `${base}/entries/${lunch.id}`, { token: owner.token, body: { leftovers: true } })).leftovers)
    .toBe(true);

  // Leftovers of a meal not cooked yet are refused.
  expect(await statusOf('POST', `${base}/entries`, {
    token: owner.token, body: { date: isoDate(0), mealType: 'DINNER', leftoversOf: cooked.id },
  })).toBe(400);
});
