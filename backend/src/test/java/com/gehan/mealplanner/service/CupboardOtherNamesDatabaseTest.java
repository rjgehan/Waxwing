package com.gehan.mealplanner.service;

import com.gehan.mealplanner.domain.User;
import com.gehan.mealplanner.dto.CupboardDtos.AddCupboardItemRequest;
import com.gehan.mealplanner.dto.CupboardDtos.CupboardItemResponse;
import com.gehan.mealplanner.dto.CupboardDtos.UpdateCupboardItemRequest;
import com.gehan.mealplanner.dto.GroceryListDtos.AddItemRequest;
import com.gehan.mealplanner.dto.HouseholdDtos.CreateHouseholdRequest;
import com.gehan.mealplanner.dto.RecipeDtos.RecipeIngredientRequest;
import com.gehan.mealplanner.dto.RecipeDtos.RecipeRequest;
import com.gehan.mealplanner.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * A cupboard item's other names — "Also known as" — against the real database: kept tidy,
 * refused when another item is called that, carried along when two items become one or a
 * cupboard is copied, and suggested from the household's own recipes and list. Rolled back
 * after each test.
 */
@SpringBootTest
@Transactional
class CupboardOtherNamesDatabaseTest {

    @Autowired CupboardService cupboardService;
    @Autowired GroceryListService groceryListService;
    @Autowired HouseholdService householdService;
    @Autowired RecipeService recipeService;
    @Autowired UserRepository userRepository;

    private UUID me;
    private UUID home;
    private String tag;

    @BeforeEach
    void household() {
        tag = UUID.randomUUID().toString().substring(0, 8);
        me = userRepository.save(User.builder().username("aka-" + tag).displayName("Me").build()).getId();
        home = householdService.create(me, new CreateHouseholdRequest("Home")).id();
        Kitchens.turnOnCupboard(householdService, home, me);
    }

    @Test
    void otherNamesAreTrimmedKeptOnceAndNeverTheItemsOwnName() {
        CupboardItemResponse salt = add("salt-" + tag);

        CupboardItemResponse saved = names(salt, " sea   salt-" + tag + " ", "Sea Salt-" + tag, "SALT-" + tag, "",
                "salt and pepper-" + tag);

        assertThat(saved.alsoKnownAs()).containsExactly("salt and pepper-" + tag, "sea salt-" + tag);
        assertThat(cupboardService.list(home, me).get(0).alsoKnownAs()).hasSize(2);
        // Null leaves them alone; an empty list clears them.
        assertThat(cupboardService.update(home, salt.id(), me,
                new UpdateCupboardItemRequest(true, null, null, null, null, null)).alsoKnownAs()).hasSize(2);
        assertThat(names(salt).alsoKnownAs()).isEmpty();
    }

    @Test
    void aNameAnotherItemIsCalledIsRefused() {
        CupboardItemResponse salt = add("salt-" + tag);
        add("sea salt-" + tag);

        assertThatThrownBy(() -> names(salt, "sea salt-" + tag))
                .isInstanceOfSatisfying(ResponseStatusException.class, e -> {
                    assertThat(e.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
                    assertThat(e.getReason()).isEqualTo("\"sea salt-" + tag + "\" is its own item in the cupboard.");
                });
    }

    @Test
    void addingByAnOtherNameSaysYouHaveThatItemAgain() {
        CupboardItemResponse salt = add("salt-" + tag);
        cupboardService.update(home, salt.id(), me, new UpdateCupboardItemRequest(true, null, null, null,
                null, null, null, List.of("sea salt-" + tag)));

        CupboardItemResponse again = add("Sea Salt-" + tag);

        assertThat(again.id()).isEqualTo(salt.id());
        assertThat(again.runningLow()).isFalse();
        assertThat(cupboardService.list(home, me)).hasSize(1);
    }

    @Test
    void twoItemsBecomingOneKeepEverythingEitherWasCalled() {
        CupboardItemResponse salt = names(add("salt-" + tag), "sea salt-" + tag);
        CupboardItemResponse kosher = names(add("kosher salt-" + tag), "flaky salt-" + tag);

        CupboardItemResponse merged = cupboardService.update(home, kosher.id(), me,
                new UpdateCupboardItemRequest(null, null, "salt-" + tag, null, null, null));

        assertThat(merged.id()).isEqualTo(salt.id());
        assertThat(merged.alsoKnownAs()).containsExactly("flaky salt-" + tag, "sea salt-" + tag);
    }

    @Test
    void aCopiedCupboardBringsItsOtherNames() {
        names(add("salt-" + tag), "sea salt-" + tag);
        UUID cabin = householdService.create(me, new CreateHouseholdRequest("Cabin")).id();
        Kitchens.turnOnCupboard(householdService, cabin, me);

        cupboardService.copyFrom(cabin, home, me);

        assertThat(cupboardService.list(cabin, me).get(0).alsoKnownAs()).containsExactly("sea salt-" + tag);
    }

    @Test
    void suggestionsAreTheHouseholdsOwnNamesWithTheWholeNameInThem() {
        // Untagged, so "salt" can be a whole word in the others; every name here is only this
        // household's, and all of it is rolled back.
        CupboardItemResponse salt = add("salt");
        add("garlic salt");
        recipeService.create(home, me, new RecipeRequest("Soup", null, null, null, null, 2, null, null, null, null,
                null, null, null, List.of(line("Sea Salt"), line("salt and pepper"), line("salted butter"),
                line("garlic salt"), line("Basalt rock"))));
        groceryListService.addManualItem(home, me, new AddItemRequest("kosher salt", null, null));

        assertThat(cupboardService.otherNameSuggestions(home, salt.id(), me))
                .containsExactly("kosher salt", "salt and pepper", "sea salt");

        names(salt, "sea salt");
        assertThat(cupboardService.otherNameSuggestions(home, salt.id(), me))
                .containsExactly("kosher salt", "salt and pepper");
    }

    private CupboardItemResponse add(String name) {
        return cupboardService.add(home, me, new AddCupboardItemRequest(name, true));
    }

    private CupboardItemResponse names(CupboardItemResponse item, String... names) {
        return cupboardService.update(home, item.id(), me,
                new UpdateCupboardItemRequest(null, null, null, null, null, null, null, List.of(names)));
    }

    private static RecipeIngredientRequest line(String name) {
        return new RecipeIngredientRequest(name, null, null, null, false);
    }
}
