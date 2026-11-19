import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { Recipe } from '../api/types';
import { useHousehold } from '../household/HouseholdContext';
import { useTablessScreen } from '../components/Layout';
import { Button, Card, EmptyState, NavBar, NoteBox, Tile } from '../components/ui';
import { Icon } from '../components/icons';
import RecipeForm, { type RecipeDraft } from '../components/RecipeForm';
import { PasteFromAi } from '../components/RecipePaste';
import { DeleteRecipeAlert } from '../components/recipe/RecipeSheets';

/**
 * The same form as writing a new one, seeded from the recipe and saving over it: Cancel, "Edit
 * recipe" and Save along the top, as the mockup's 3.20 has it, and Delete at the very foot.
 *
 * Replace from a paste, at the top, is for a whole new version — one an AI wrote after the
 * recipe was cooked and found wanting. It is New recipe's paste and check, saved over this
 * recipe rather than as another: the same recipe, so its plans, photos, links, tags and
 * sharing all stay with it. Each step is a page of its own, and going back keeps what was there
 * — the form's own edits behind the paste, the paste behind the check.
 */
export default function EditRecipePage() {
  const { recipeId } = useParams<{ recipeId: string }>();
  const { activeHouseholdId, households } = useHousehold();
  const navigate = useNavigate();
  useTablessScreen();
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pasting, setPasting] = useState(false);
  /** A new version read from the paste, open in Check recipe; `n` so a second read starts afresh. */
  const [replacement, setReplacement] = useState<{ draft: RecipeDraft; n: number } | null>(null);

  useEffect(() => {
    if (!recipeId || !activeHouseholdId) return;
    api<Recipe>('GET', `/api/recipes/${recipeId}?householdId=${activeHouseholdId}`)
      .then(setRecipe)
      .catch(() => setError('Could not load that recipe.'));
  }, [recipeId, activeHouseholdId]);

  // Each step starts at its top, with the bar and its Save in view.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pasting, replacement]);

  /** Back to the recipe — the way it came, when it came from there. */
  function leave() {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(`/recipes/${recipeId}`, { replace: true });
  }

  const cancel = (
    <button type="button" className="press text-[1.0625rem] text-accent-ink" onClick={leave}>
      Cancel
    </button>
  );

  if (error) {
    return (
      <div className="flex flex-col gap-2">
        <NavBar title="Edit recipe" left={cancel} />
        <Card>
          <EmptyState>{error}</EmptyState>
        </Card>
      </div>
    );
  }
  if (!activeHouseholdId || !recipe) {
    return <p className="py-16 text-center text-sm text-muted">Loading…</p>;
  }
  // Sharing a recipe does not hand over the pencil; the owner household edits it.
  if (recipe.shared) {
    return (
      <div className="flex flex-col gap-2">
        <NavBar title="Edit recipe" left={cancel} />
        <Card>
          <EmptyState>This recipe belongs to another household, so you can't edit it.</EmptyState>
        </Card>
      </div>
    );
  }

  const saved = (r: Recipe) => navigate(`/recipes/${r.id}`, { replace: true });
  const save = (form: string) => (
    <button type="submit" form={form} className="press font-semibold">
      Save
    </button>
  );

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 pb-6">
      {replacement ? (
        <NavBar
          title="Check recipe"
          left={
            // Back to the paste, to try again — as New recipe's Check recipe does.
            <button type="button" className="press text-[1.0625rem] text-accent-ink" onClick={() => setReplacement(null)}>
              Cancel
            </button>
          }
          right={save('replace-recipe')}
        />
      ) : pasting ? (
        <NavBar title="Replace from a paste" back={() => setPasting(false)} backLabel="Edit" />
      ) : (
        <NavBar title="Edit recipe" left={cancel} right={save('edit-recipe')} />
      )}

      {replacement && (
        <>
          <NoteBox tone="herb" icon="check">
            Here’s the new version — check the amounts, change anything, then save. It replaces what “{recipe.name}” says
            now; its photos, links, filing, plans and sharing stay.
          </NoteBox>
          <RecipeForm
            key={replacement.n}
            id="replace-recipe"
            householdId={activeHouseholdId}
            recipe={recipe}
            draft={replacement.draft}
            onSaved={saved}
          />
        </>
      )}

      {/* Hidden, not unmounted, so Cancel on the check comes back to the paste as it was. The
          wrappers carry no display class: Tailwind's `flex` would beat the `hidden` attribute. */}
      {pasting && (
        <div hidden={!!replacement}>
          <div className="flex flex-col gap-4">
            <div role="note">
              <NoteBox tone="sky" icon="info">
                A new version takes the place of the name, servings, times, description, ingredients and method of “{recipe.name}”.
                Its photos, links, filing, plans and sharing stay.
              </NoteBox>
            </div>
            <PasteFromAi
              householdId={activeHouseholdId}
              revising={recipe}
              onSaved={saved}
              onDraft={(draft) => setReplacement((was) => ({ draft, n: (was?.n ?? 0) + 1 }))}
            />
          </div>
        </div>
      )}

      <div hidden={pasting}>
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => setPasting(true)}
            className="card press flex items-center gap-3 p-3.5 text-left active:bg-surface2"
          >
            <Tile icon="sparkles" tone="plum" size={40} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[0.9375rem] font-semibold">Replace from a paste</span>
              <span className="text-[0.8125rem] leading-snug text-muted">
                A whole new version from an AI, in place of this one. Its plans, photos and sharing stay.
              </span>
            </span>
            <Icon name="chevR" size={18} className="shrink-0 text-faint" />
          </button>

          <RecipeForm id="edit-recipe" householdId={activeHouseholdId} recipe={recipe} onSaved={saved} />

          {/* A red word, not a red slab: it is the rarest thing on the page, and the last. It asks
              first, in an alert rather than a browser confirm(), and cannot be undone. */}
          <Button variant="ghost" icon="trash" className="mt-2 self-center text-danger" onClick={() => setDeleting(true)}>
            Delete this recipe
          </Button>
        </div>
      </div>

      {deleting && (
        <DeleteRecipeAlert
          recipe={recipe}
          households={households}
          onCancel={() => setDeleting(false)}
          onDeleted={() => navigate('/recipes', { replace: true })}
        />
      )}
    </div>
  );
}
