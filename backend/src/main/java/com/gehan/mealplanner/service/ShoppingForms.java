package com.gehan.mealplanner.service;

import java.math.BigDecimal;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * What a recipe line is as a thing to buy, when the recipe names it a way the shop doesn't:
 * "5 garlic cloves, minced" and "1 tbsp minced garlic" are both garlic, and the list wants one
 * row of it — "garlic · 8 cloves" — not two rows that each look like something else to buy.
 *
 * Only the grocery list reads this. Recipes keep the words they were written in, and nothing here
 * renames an ingredient: the list just puts the line on the row for the thing it is.
 *
 * Garlic is the one food here so far. Its prep words (minced, crushed…) and its count words
 * (cloves, a head) come off the name, the count word becomes the unit, and a spoonful of minced
 * garlic is counted as cloves at a teaspoon a clove. Garlic powder, garlic salt and garlic bread
 * are other things and are left alone.
 */
public final class ShoppingForms {

    private static final String PREP = "fresh|minced|chopped|crushed|grated|pressed|peeled|smashed|sliced"
            + "|finely|roughly|thinly|large|small|medium|whole";

    private static final Pattern GARLIC = Pattern.compile(
            "^(?:(?<lead>cloves?|heads?|bulbs?) (?:of )?)?(?:(?:" + PREP + ") )*garlic"
                    + "(?: (?<count>cloves?|heads?|bulbs?))?(?: (?:of|" + PREP + "))*$");

    /** A spoonful of minced garlic, in cloves: a clove minces to about a teaspoon. */
    private static final Map<String, BigDecimal> GARLIC_CLOVES_PER = Map.of(
            "tsp", BigDecimal.ONE,
            "tbsp", BigDecimal.valueOf(3),
            "cup", BigDecimal.valueOf(48));

    /** The thing to buy, the unit to count it in, and what one of the recipe's units is in that unit. */
    public record Form(String name, String unit, BigDecimal factor) {
    }

    private ShoppingForms() {
    }

    /**
     * The form to put a recipe line on the list in, or empty for a line that is already named the
     * way it is bought. {@code unit} is the recipe's own, in {@link IngredientLine#canonicalUnit}'s
     * spelling or not.
     */
    public static Optional<Form> of(String name, String unit) {
        if (name == null) {
            return Optional.empty();
        }
        String plain = name.toLowerCase(Locale.ROOT)
                .replaceAll("\\(.*?\\)", " ")
                .replaceAll("[^\\p{L} ]", " ")
                .replaceAll("\\s+", " ")
                .trim();
        Matcher garlic = GARLIC.matcher(plain);
        if (!garlic.matches()) {
            return Optional.empty();
        }
        String said = IngredientLine.canonicalUnit(unit);
        String count = garlic.group("count") != null ? garlic.group("count") : garlic.group("lead");
        if (said == null || said.isBlank()) {
            // "5 garlic cloves": the count word was in the name. Plain "garlic" with a number and
            // no unit says nothing more, so it stays as it was, apart from the name.
            if (count == null) {
                return plain.equals("garlic") ? Optional.empty() : Optional.of(new Form("garlic", null, BigDecimal.ONE));
            }
            return Optional.of(new Form("garlic", count.startsWith("clove") ? "clove" : "head", BigDecimal.ONE));
        }
        BigDecimal cloves = GARLIC_CLOVES_PER.get(said);
        if (cloves != null) {
            return Optional.of(new Form("garlic", "clove", cloves));
        }
        if (said.equals("bulb")) {
            return Optional.of(new Form("garlic", "head", BigDecimal.ONE));
        }
        return Optional.of(new Form("garlic", said, BigDecimal.ONE));
    }
}
