package com.gehan.mealplanner.service;

import com.gehan.mealplanner.domain.CupboardItem;
import com.gehan.mealplanner.domain.Ingredient;
import com.gehan.mealplanner.mealplans.IngredientKeys;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Which cupboard item, if any, a thing on a recipe or the list is: the same ingredient, or failing
 * that the item's own name or one of its "also known as" names — so one salt covers "sea salt"
 * and "salt and pepper" once somebody has said so.
 *
 * Names match as written, give or take capitals, punctuation, brackets and a plural on the last
 * word ({@link #spelling}). Nothing looser: dropping words the way {@link IngredientKeys#key}
 * does would make a staple "pepper" swallow "red pepper", which is a vegetable.
 */
public final class CupboardMatch {

    private static final CupboardMatch NONE = new CupboardMatch(List.of());

    private final Map<UUID, CupboardItem> byIngredient = new HashMap<>();
    private final Map<String, CupboardItem> byName = new HashMap<>();
    private final List<CupboardItem> items;

    private CupboardMatch(Collection<CupboardItem> items) {
        this.items = List.copyOf(items);
        for (CupboardItem item : items) {
            byIngredient.put(item.getIngredient().getId(), item);
        }
        // An item's own name before anybody's other names: if "salt" is an item and also another
        // item's other name, the salt item is the one meant.
        for (CupboardItem item : items) {
            byName.putIfAbsent(spelling(item.getIngredient().getName()), item);
        }
        for (CupboardItem item : items) {
            for (String alias : item.getAlsoKnownAs()) {
                byName.putIfAbsent(spelling(alias), item);
            }
        }
        byName.remove("");
    }

    public static CupboardMatch of(Collection<CupboardItem> items) {
        return new CupboardMatch(items);
    }

    /** A household that keeps no cupboard: nothing matches. */
    public static CupboardMatch none() {
        return NONE;
    }

    public Optional<CupboardItem> find(Ingredient ingredient) {
        if (ingredient == null) {
            return Optional.empty();
        }
        CupboardItem same = byIngredient.get(ingredient.getId());
        return same != null ? Optional.of(same) : find(ingredient.getName());
    }

    public Optional<CupboardItem> find(String name) {
        return Optional.ofNullable(byName.get(spelling(name)));
    }

    public List<CupboardItem> items() {
        return items;
    }

    /** Every name an item answers to, in the same spelling {@link #find} looks names up by. */
    public static List<String> spellings(CupboardItem item) {
        List<String> all = new ArrayList<>();
        all.add(spelling(item.getIngredient().getName()));
        item.getAlsoKnownAs().forEach(alias -> all.add(spelling(alias)));
        return all;
    }

    /** "Sea Salt (fine)" → "sea salt", "Peppercorns" → "peppercorn". */
    public static String spelling(String name) {
        if (name == null) {
            return "";
        }
        String plain = name.toLowerCase(Locale.ROOT)
                .replaceAll("\\(.*?\\)", " ")
                .replaceAll("[^\\p{L}\\p{N}& ]", " ")
                .replaceAll("\\s+", " ")
                .trim();
        if (plain.isEmpty()) {
            return plain;
        }
        int last = plain.lastIndexOf(' ');
        return plain.substring(0, last + 1) + IngredientKeys.singular(plain.substring(last + 1));
    }
}
