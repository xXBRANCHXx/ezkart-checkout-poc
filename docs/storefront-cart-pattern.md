# Shared storefront cart

Ezkart templates use one shared cart entry point outside the page navigation.
The standard control is a floating shopping-bag icon, **Cart** label and item
count in the bottom-right corner. Its neutral white surface stays recognizable
across different storefront palettes. Keep the empty state accessible too.

## Behavior

- Product buttons, variant controls and repeated placements use the existing
  catalog bindings and shared cart. Templates do not implement their own cart.
- Adding a product opens the shared drawer with that variant, quantity and price.
- The floating control stays clear of fixed purchase bars, ordinary catalog purchase buttons, variant selectors, and device safe areas.
- Desktop uses a right-side drawer; mobile uses the full available width.
- Closing the drawer preserves the cart and returns focus to the opener.
  Escape, Tab and Shift+Tab work throughout the drawer.
- Quantity and subtotal changes update the same cart count everywhere. Checkout
  follows the store's existing checkout flow; local fictional concepts use the
  explicitly configured simulated checkout.

For new templates, leave the shared floating control in place and omit a second
cart control from the navigation. Existing merchant-authored cart controls remain
supported. Purchase bars may provide a contextual add action; they must not cover
the shared cart or introduce a second drawer.

Verify empty/populated states, variants, quantity limits, close/reopen, keyboard
focus, and purchase-bar overlap in the real Preview and exported storefront.
