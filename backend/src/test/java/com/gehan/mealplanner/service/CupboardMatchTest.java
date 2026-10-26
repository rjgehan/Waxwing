package com.gehan.mealplanner.service;

import com.gehan.mealplanner.domain.CupboardItem;
import com.gehan.mealplanner.domain.Ingredient;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/** Which cupboard item a recipe's line is: the same ingredient, its name, or a name it is also known by. */
class CupboardMatchTest {

    @Test
    void theSameIngredientThenTheNameThenAnOtherName() {
        CupboardItem salt = item("Salt", "sea salt", "Salt and Pepper");
        CupboardMatch match = CupboardMatch.of(List.of(salt, item("Black pepper")));

        assertThat(match.find(salt.getIngredient())).contains(salt);
        assertThat(match.find(ingredient("salt"))).contains(salt);
        assertThat(match.find(ingredient("Sea Salt"))).contains(salt);
        assertThat(match.find(ingredient("salt & pepper"))).isEmpty();
        assertThat(match.find(ingredient("salt and pepper"))).contains(salt);
        assertThat(match.find(ingredient("kosher salt"))).isEmpty();
    }

    @Test
    void capitalsPunctuationBracketsAndAPluralDoNotMatter() {
        CupboardMatch match = CupboardMatch.of(List.of(item("peppercorns", "black peppercorn (whole)")));

        assertThat(match.find("Peppercorn")).isPresent();
        assertThat(match.find("black peppercorns")).isPresent();
        assertThat(match.find("black-peppercorn")).isPresent();
    }

    @Test
    void nothingLooserThanThat() {
        CupboardMatch match = CupboardMatch.of(List.of(item("pepper"), item("butter")));

        // Dropping colour words would make the staple pepper swallow a vegetable.
        assertThat(match.find("red pepper")).isEmpty();
        assertThat(match.find("salted butter")).isEmpty();
    }

    @Test
    void anItemsOwnNameBeatsAnotherItemsOtherName() {
        CupboardItem salt = item("salt");
        CupboardItem mix = item("seasoning", "salt");

        assertThat(CupboardMatch.of(List.of(mix, salt)).find("salt")).contains(salt);
    }

    @Test
    void noCupboardMatchesNothing() {
        assertThat(CupboardMatch.none().find("salt")).isEmpty();
        assertThat(CupboardMatch.none().find((Ingredient) null)).isEmpty();
    }

    private static CupboardItem item(String name, String... alsoKnownAs) {
        return CupboardItem.builder().id(UUID.randomUUID()).ingredient(ingredient(name))
                .alsoKnownAs(new LinkedHashSet<>(List.of(alsoKnownAs))).build();
    }

    private static Ingredient ingredient(String name) {
        return Ingredient.builder().id(UUID.randomUUID()).name(name).build();
    }
}
