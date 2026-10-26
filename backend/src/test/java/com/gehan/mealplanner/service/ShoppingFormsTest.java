package com.gehan.mealplanner.service;

import com.gehan.mealplanner.service.ShoppingForms.Form;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThat;

/** What a recipe's garlic is as a thing to buy: garlic, counted in cloves. */
class ShoppingFormsTest {

    @Test
    void garlicByItsCountWordIsCountedInThatWord() {
        assertThat(ShoppingForms.of("garlic cloves, minced", null)).contains(new Form("garlic", "clove", BigDecimal.ONE));
        assertThat(ShoppingForms.of("Garlic Clove", null)).contains(new Form("garlic", "clove", BigDecimal.ONE));
        assertThat(ShoppingForms.of("cloves garlic", "cloves")).contains(new Form("garlic", "clove", BigDecimal.ONE));
        assertThat(ShoppingForms.of("garlic", "clove")).contains(new Form("garlic", "clove", BigDecimal.ONE));
        assertThat(ShoppingForms.of("head of garlic", null)).contains(new Form("garlic", "head", BigDecimal.ONE));
        assertThat(ShoppingForms.of("garlic head", null)).contains(new Form("garlic", "head", BigDecimal.ONE));
        assertThat(ShoppingForms.of("garlic", "bulbs")).contains(new Form("garlic", "head", BigDecimal.ONE));
    }

    @Test
    void aSpoonfulOfMincedGarlicIsCloves() {
        assertThat(ShoppingForms.of("minced garlic", "tbsp")).contains(new Form("garlic", "clove", BigDecimal.valueOf(3)));
        assertThat(ShoppingForms.of("Garlic (minced)", "teaspoons")).contains(new Form("garlic", "clove", BigDecimal.ONE));
        assertThat(ShoppingForms.of("finely chopped garlic", "Tbsp")).contains(new Form("garlic", "clove", BigDecimal.valueOf(3)));
    }

    @Test
    void anAmountTheShopSellsItInStays() {
        assertThat(ShoppingForms.of("crushed garlic", "g")).contains(new Form("garlic", "g", BigDecimal.ONE));
        // Plain garlic with a number and no unit says nothing new: left as it is.
        assertThat(ShoppingForms.of("garlic", null)).isEmpty();
        assertThat(ShoppingForms.of("minced garlic", null)).contains(new Form("garlic", null, BigDecimal.ONE));
    }

    @Test
    void otherThingsWithGarlicInThemAreLeftAlone() {
        assertThat(ShoppingForms.of("garlic powder", "tsp")).isEmpty();
        assertThat(ShoppingForms.of("garlic salt", null)).isEmpty();
        assertThat(ShoppingForms.of("garlic bread", null)).isEmpty();
        assertThat(ShoppingForms.of("black garlic", null)).isEmpty();
        assertThat(ShoppingForms.of("onion", "tbsp")).isEmpty();
        assertThat(ShoppingForms.of(null, null)).isEmpty();
    }
}
