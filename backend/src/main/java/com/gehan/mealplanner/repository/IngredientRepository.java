package com.gehan.mealplanner.repository;

import com.gehan.mealplanner.domain.Ingredient;
import com.gehan.mealplanner.domain.StoreSection;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface IngredientRepository extends JpaRepository<Ingredient, UUID> {
    Optional<Ingredient> findByNormalizedName(String normalizedName);

    List<Ingredient> findBySectionIsNull();

    List<Ingredient> findBySection(StoreSection section);

    /** Every name a household's own recipes and grocery list use, each once. */
    @Query(value = """
            SELECT DISTINCT i.name FROM ingredients i
            WHERE i.id IN (SELECT ri.ingredient_id FROM recipe_ingredients ri
                           JOIN recipes r ON r.id = ri.recipe_id WHERE r.household_id = :householdId)
               OR i.id IN (SELECT g.ingredient_id FROM grocery_list_items g
                           WHERE g.household_id = :householdId AND g.ingredient_id IS NOT NULL)
            """, nativeQuery = true)
    List<String> namesUsedBy(@Param("householdId") UUID householdId);
}
