package com.gehan.mealplanner.domain;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.BatchSize;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.UUID;

/**
 * Something a household has in the house, so you can check without going to look. Goes in
 * through "Done shopping" on the grocery list, or by hand, and comes out when it is used up.
 *
 * Have it, or running low — no count. When it is used up it either just goes (Remove, most of
 * the time) or goes onto the grocery list (Buy again). Nothing here adds to the list by itself.
 */
@Entity
@Table(name = "cupboard_items",
        uniqueConstraints = @UniqueConstraint(columnNames = {"household_id", "ingredient_id"}))
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CupboardItem {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "household_id", nullable = false)
    private Household household;

    /** The same shared ingredient the grocery list and recipes use, so "eggs" is one thing everywhere. */
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "ingredient_id", nullable = false)
    private Ingredient ingredient;

    /**
     * Something you always have — salt, oil. Planned meals never put a staple on the grocery
     * list. This is what the grocery list's old "Pantry staples" became.
     */
    @Column(nullable = false)
    @Builder.Default
    private boolean staple = false;

    /**
     * Other names recipes give the same thing — "sea salt", "salt and pepper" for the household's
     * salt. A recipe line or list row by any of them counts as this item: a staple is left off the
     * list whatever the recipe calls it, and Done shopping puts it back here rather than making a
     * second item. Matched as written, give or take capitals, punctuation and a plural (see
     * {@code CupboardMatch}). Batched, so a whole cupboard's names come in a query or two.
     */
    @ElementCollection
    @CollectionTable(name = "cupboard_item_aliases", joinColumns = @JoinColumn(name = "cupboard_item_id"))
    @Column(name = "alias", nullable = false, length = 200)
    @BatchSize(size = 200)
    @Builder.Default
    private Set<String> alsoKnownAs = new LinkedHashSet<>();

    /**
     * Some left, but not much — a note for whoever checks, and nothing more. It does not put
     * anything on the grocery list. Planning does count it as not having enough, though, so a
     * planned item that is running low still goes on the list.
     *
     * The column carries its own default: Hibernate adds new columns to a table that already has
     * rows, and a bare NOT NULL there fails.
     */
    @Column(columnDefinition = "boolean not null default false")
    @Builder.Default
    private boolean runningLow = false;

    /**
     * An exact count instead of Have/Low — "3 cans of beans" rather than just Have. Null means
     * this item still uses the simple Have/Low toggle above; each household's items can mix both.
     */
    @Column(precision = 10, scale = 2)
    private BigDecimal quantity;

    private String unit;

    @Column(nullable = false, updatable = false)
    @Builder.Default
    private Instant createdAt = Instant.now();

    /**
     * The date on the packet, when somebody bothered to put it in — optional, and most things
     * never get one. With it, "use soon" is a fact ("by Thu"); without it, a guess from what the
     * thing is and when it was bought (see mealplans.UseSoon). Nullable, so adding it touched no
     * existing row.
     */
    private LocalDate useBy;

    /**
     * When it last came into the house — Done shopping, or added again by hand. What a use-soon
     * guess counts from: spinach bought on Monday is not spinach bought last month. Null on items
     * from before this was kept, which count from {@link #createdAt} instead.
     */
    private Instant boughtAt;

    /** Counted, and the count is down to nothing — as good as not having it. */
    public boolean isUsedUp() {
        return quantity != null && quantity.signum() <= 0;
    }

    /** When it came into the house, as near as is known. */
    public Instant arrivedAt() {
        return boughtAt != null ? boughtAt : createdAt;
    }

    /**
     * Bought again: the clock a use-soon guess runs on starts over. A use-by date that has
     * already passed was the old packet's, so it goes; one still ahead is kept, because the
     * older one in the cupboard is still the one to use first.
     */
    public void arrived(Instant now, LocalDate today) {
        boughtAt = now;
        if (useBy != null && useBy.isBefore(today)) {
            useBy = null;
        }
    }

    /** Low or used up: planning should not count on it. */
    public boolean isShort() {
        return runningLow || isUsedUp();
    }
}
