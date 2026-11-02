package com.gehan.mealplanner.service;

import com.gehan.mealplanner.domain.CupboardItem;
import com.gehan.mealplanner.domain.Household;
import com.gehan.mealplanner.domain.Ingredient;
import com.gehan.mealplanner.domain.MealPlanEntry;
import com.gehan.mealplanner.domain.MealType;
import com.gehan.mealplanner.domain.Place;
import com.gehan.mealplanner.domain.Recipe;
import com.gehan.mealplanner.domain.SavedLink;
import com.gehan.mealplanner.dto.MealPlanDtos.MealPlanEntryResponse;
import com.gehan.mealplanner.dto.MealPlanDtos.AddMealPlanEntryRequest;
import com.gehan.mealplanner.dto.MealPlanDtos.UpdateMealPlanEntryRequest;
import com.gehan.mealplanner.repository.CupboardItemRepository;
import com.gehan.mealplanner.repository.HouseholdRepository;
import com.gehan.mealplanner.repository.MealPlanEntryRepository;
import com.gehan.mealplanner.repository.PlaceRepository;
import com.gehan.mealplanner.repository.RecipeRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDate;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Service
public class MealPlanService {

    private final MealPlanEntryRepository mealPlanEntryRepository;
    private final HouseholdRepository householdRepository;
    private final RecipeRepository recipeRepository;
    private final PlaceRepository placeRepository;
    private final CupboardItemRepository cupboardRepository;
    private final HouseholdService householdService;
    private final IngredientService ingredientService;
    private final SavedLinkService savedLinkService;

    public MealPlanService(MealPlanEntryRepository mealPlanEntryRepository,
                            HouseholdRepository householdRepository,
                            RecipeRepository recipeRepository,
                            PlaceRepository placeRepository,
                            CupboardItemRepository cupboardRepository,
                            HouseholdService householdService,
                            IngredientService ingredientService,
                            SavedLinkService savedLinkService) {
        this.mealPlanEntryRepository = mealPlanEntryRepository;
        this.householdRepository = householdRepository;
        this.recipeRepository = recipeRepository;
        this.placeRepository = placeRepository;
        this.cupboardRepository = cupboardRepository;
        this.householdService = householdService;
        this.ingredientService = ingredientService;
        this.savedLinkService = savedLinkService;
    }

    @Transactional(readOnly = true)
    public List<MealPlanEntryResponse> listRange(UUID householdId, UUID requesterId, LocalDate start, LocalDate end) {
        householdService.assertMember(householdId, requesterId);
        CupboardMatch cupboard = cupboard(householdId);
        return mealPlanEntryRepository
                .findByHouseholdIdAndDateBetweenOrderByDateAscMealTypeAsc(householdId, start, end)
                .stream().sorted(MealPlanEntry.EATING_ORDER).map(e -> toResponse(e, cupboard)).toList();
    }

    /** Adds a dish to a slot. Call it again to put sides alongside a main. */
    @Transactional
    public MealPlanEntryResponse add(UUID householdId, UUID requesterId, AddMealPlanEntryRequest request) {
        householdService.assertMember(householdId, requesterId);
        Household household = householdRepository.findById(householdId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Household not found"));

        // Exactly one: a dish you cook, a place you go, a single thing to eat, or a saved link —
        // or the earlier meal it is left over from, which says which of those it is.
        String itemName = blankToNull(request.itemName());
        int kinds = (request.recipeId() != null ? 1 : 0) + (request.placeId() != null ? 1 : 0)
                + (itemName != null ? 1 : 0) + (request.savedLinkId() != null ? 1 : 0)
                + (request.leftoversOf() != null ? 1 : 0);
        if (kinds != 1) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Send one of a recipe, a place, an item, a saved link or the meal it is left over from.");
        }
        MealPlanEntry source = request.leftoversOf() == null ? null
                : leftoversSource(householdId, request.leftoversOf(), request.date());
        Recipe recipe = source != null ? source.getRecipe()
                : request.recipeId() == null ? null : requireRecipe(request.recipeId());
        Place place = source != null ? source.getPlace()
                : request.placeId() == null ? null : requirePlace(request.placeId(), householdId);
        Ingredient item = source != null ? source.getItem()
                : itemName == null ? null : ingredientService.findOrCreate(itemName, null);
        SavedLink savedLink = source != null ? source.getSavedLink()
                : request.savedLinkId() == null ? null
                : savedLinkService.visible(householdId, request.savedLinkId(), requesterId);
        if (recipe == null && place == null && item == null && savedLink == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "That meal has nothing left to eat.");
        }

        boolean alreadyThere = mealPlanEntryRepository
                .findByHouseholdIdAndDateAndMealTypeOrderByCreatedAtAsc(householdId, request.date(), request.mealType())
                .stream()
                .anyMatch(e -> recipe != null ? e.getRecipe() != null && e.getRecipe().getId().equals(recipe.getId())
                        : place != null ? e.getPlace() != null && e.getPlace().getId().equals(place.getId())
                        : savedLink != null ? e.getSavedLink() != null && e.getSavedLink().getId().equals(savedLink.getId())
                        : e.getItem() != null && e.getItem().getId().equals(item.getId()));
        if (alreadyThere) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "That's already on this meal.");
        }

        boolean leftovers = source != null || Boolean.TRUE.equals(request.leftovers());
        MealPlanEntry entry = MealPlanEntry.builder()
                .household(household)
                .date(request.date())
                .mealType(request.mealType())
                .recipe(recipe)
                .place(place)
                .item(item)
                .savedLink(savedLink)
                .time(request.time())
                // Servings describe cooking. A table booking or a bowl of strawberries does not have
                // them, and a saved link has no amounts for them to scale. Leftovers serve what
                // the meal they came from did, unless somebody says otherwise.
                .servings(recipe == null ? null
                        : request.servings() != null ? request.servings()
                        : source != null && source.getServings() != null ? source.getServings()
                        : household.getDefaultServings())
                .notes(request.notes())
                .leftovers(leftovers)
                .leftoversFromDate(source != null ? source.getDate() : null)
                .leftoversFromMeal(source != null ? source.getMealType() : null)
                // A mutable set, not Set.of()/copyOf() — Hibernate mutates this collection in
                // place (clear-then-refill) on every merge, which throws on an immutable one.
                .includedOptionalIngredientIds(request.includedOptionalIngredientIds() == null
                        ? new HashSet<>() : new HashSet<>(request.includedOptionalIngredientIds()))
                .build();

        return toResponse(mealPlanEntryRepository.save(entry), cupboard(householdId));
    }

    /** Changes one dish in place — swap what it is, or just adjust how many it serves. */
    @Transactional
    public MealPlanEntryResponse update(UUID entryId, UUID requesterId, UpdateMealPlanEntryRequest request) {
        MealPlanEntry entry = mealPlanEntryRepository.findById(entryId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Meal plan entry not found"));
        UUID householdId = entry.getHousehold().getId();
        householdService.assertMember(householdId, requesterId);

        // Swapping one kind for another clears the others, so an entry is only ever one thing.
        // A deleted recipe's name is one of those things: once the slot holds something else,
        // "was deleted" is no longer about it.
        String itemName = blankToNull(request.itemName());
        if (request.recipeId() != null || request.placeId() != null || itemName != null
                || request.savedLinkId() != null) {
            entry.setDeletedRecipeName(null);
            entry.setDeletedWasSavedLink(false);
            // Whatever it becomes, it is not the saved link any more — including from an older
            // app, which has never heard of them and only ever sends the other three.
            entry.setSavedLink(null);
            // Nor is it what was left over from that meal.
            endLeftovers(entry);
        }
        if (request.recipeId() != null) {
            entry.setRecipe(requireRecipe(request.recipeId()));
            entry.setPlace(null);
            entry.setItem(null);
        }
        if (request.placeId() != null) {
            entry.setPlace(requirePlace(request.placeId(), householdId));
            entry.setRecipe(null);
            entry.setItem(null);
        }
        if (itemName != null) {
            entry.setItem(ingredientService.findOrCreate(itemName, null));
            entry.setRecipe(null);
            entry.setPlace(null);
        }
        if (request.savedLinkId() != null) {
            entry.setSavedLink(savedLinkService.visible(householdId, request.savedLinkId(), requesterId));
            entry.setRecipe(null);
            entry.setPlace(null);
            entry.setItem(null);
            entry.setServings(null);
            entry.getIncludedOptionalIngredientIds().clear();
        }
        if (Boolean.TRUE.equals(request.clearTime())) {
            entry.setTime(null);
        } else if (request.time() != null) {
            entry.setTime(request.time());
        }
        if (request.servings() != null) {
            entry.setServings(request.servings());
        }
        if (request.notes() != null) {
            entry.setNotes(request.notes());
        }
        if (request.includedOptionalIngredientIds() != null) {
            entry.setIncludedOptionalIngredientIds(new HashSet<>(request.includedOptionalIngredientIds()));
        }
        if (Boolean.TRUE.equals(request.leftovers())) {
            entry.setLeftovers(true);
        } else if (Boolean.FALSE.equals(request.leftovers())) {
            endLeftovers(entry);
        }
        return toResponse(mealPlanEntryRepository.save(entry), cupboard(householdId));
    }

    private static void endLeftovers(MealPlanEntry entry) {
        entry.setLeftovers(false);
        entry.setLeftoversFromDate(null);
        entry.setLeftoversFromMeal(null);
    }

    /**
     * The meals a slot could be leftovers of: the last few days' cooking, up to the meal before
     * this one — yesterday's dinner for today's lunch — newest first, each dish once. A night out
     * counts (the takeaway's second half); single items and leftovers themselves do not.
     */
    @Transactional(readOnly = true)
    public List<MealPlanEntryResponse> leftoverChoices(UUID householdId, UUID requesterId, LocalDate date,
                                                       MealType mealType) {
        householdService.assertMember(householdId, requesterId);
        CupboardMatch cupboard = cupboard(householdId);
        Set<String> seen = new HashSet<>();
        return mealPlanEntryRepository
                .findByHouseholdIdAndDateBetweenOrderByDateAscMealTypeAsc(householdId, date.minusDays(LEFTOVER_DAYS), date)
                .stream()
                .filter(e -> e.getDate().isBefore(date) || e.getMealType().compareTo(mealType) < 0)
                .filter(e -> !e.isLeftovers() && (e.getRecipe() != null || e.getPlace() != null || e.getSavedLink() != null))
                .sorted(MealPlanEntry.EATING_ORDER.reversed())
                .filter(e -> seen.add(e.getRecipe() != null ? "r" + e.getRecipe().getId()
                        : e.getPlace() != null ? "p" + e.getPlace().getId() : "l" + e.getSavedLink().getId()))
                .map(e -> toResponse(e, cupboard))
                .toList();
    }

    /** How far back leftovers are looked for: food kept longer than this is not dinner. */
    static final int LEFTOVER_DAYS = 4;

    /** The meal named as the one these are left over from: this household's, and not after this day. */
    private MealPlanEntry leftoversSource(UUID householdId, UUID entryId, LocalDate date) {
        MealPlanEntry source = mealPlanEntryRepository.findById(entryId)
                .filter(e -> e.getHousehold().getId().equals(householdId))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Meal plan entry not found"));
        if (source.getDate().isAfter(date)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Leftovers come after the meal they are from.");
        }
        return source;
    }

    private Recipe requireRecipe(UUID recipeId) {
        return recipeRepository.findById(recipeId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Recipe not found"));
    }

    /** Places are not shared between households, so one can only be planned by its own. */
    private Place requirePlace(UUID placeId, UUID householdId) {
        Place place = placeRepository.findById(placeId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Place not found"));
        if (!place.getHousehold().getId().equals(householdId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "That place belongs to another household");
        }
        return place;
    }

    @Transactional
    public void delete(UUID entryId, UUID requesterId) {
        MealPlanEntry entry = mealPlanEntryRepository.findById(entryId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Meal plan entry not found"));
        householdService.assertMember(entry.getHousehold().getId(), requesterId);
        mealPlanEntryRepository.delete(entry);
    }

    /**
     * What the cupboard says about planned single items — "in the cupboard", "running low". Empty
     * for a household that does not keep one: the rows it kept from when it did are out of sight,
     * and an old "running low" would be a warning about a shelf nobody looks at any more.
     */
    private CupboardMatch cupboard(UUID householdId) {
        return householdRepository.findById(householdId).map(Household::isCupboardEnabled).orElse(true)
                ? CupboardMatch.of(cupboardRepository.findByHouseholdId(householdId)) : CupboardMatch.none();
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private MealPlanEntryResponse toResponse(MealPlanEntry entry, CupboardMatch cupboard) {
        Recipe recipe = entry.getRecipe();
        Ingredient item = entry.getItem();
        SavedLink link = entry.getSavedLink();
        CupboardItem stocked = cupboard.find(item).orElse(null);
        return new MealPlanEntryResponse(
                entry.getId(),
                entry.getDate(),
                entry.getMealType(),
                recipe != null ? recipe.getId() : null,
                recipe != null ? recipe.getName() : link != null ? link.getName() : entry.getDeletedRecipeName(),
                recipe != null && recipe.getIngredients().isEmpty(),
                entry.getPlace() != null ? entry.getPlace().getId() : null,
                entry.getPlace() != null ? entry.getPlace().getName() : null,
                item != null ? item.getName() : null,
                stocked != null && !stocked.isUsedUp(),
                stocked != null && stocked.isShort(),
                entry.getTime(),
                entry.getServings(),
                entry.getNotes(),
                List.copyOf(entry.getIncludedOptionalIngredientIds()),
                recipe == null && link == null && entry.getDeletedRecipeName() != null,
                recipe == null && link == null && entry.getDeletedRecipeName() != null && entry.isDeletedWasSavedLink(),
                link != null ? link.getId() : null,
                link != null ? link.getName() : null,
                link != null ? link.getUrl() : null,
                link != null ? link.getSource() : null,
                link != null && link.getCoverImage() != null ? link.getCoverImage().getId() : null,
                entry.isLeftovers(),
                entry.getLeftoversFromDate(),
                entry.getLeftoversFromMeal());
    }
}
