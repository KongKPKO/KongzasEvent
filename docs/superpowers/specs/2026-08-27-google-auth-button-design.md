# Google Auth Button Design

## Goal

Make the Creator Login and Creator Signup Google actions look immediately recognizable as Google sign-in controls while preserving the existing Nireq authentication behavior.

## Visual Design

- Use the same treatment on `/manage-login` in Creator mode and `/creator/register` before authentication.
- Show the official multicolor Google G logo at approximately 20px to the left of “Continue with Google”.
- Use a white background, a subtle gray border, dark text, and a minimum 48px touch target.
- Use a light gray hover state and a visible keyboard focus ring that meets the product's accessibility requirements.
- Keep the existing rounded Nireq shape and full-width layout rather than copying the reference site's unrelated blue email button.
- Preserve disabled and loading feedback without changing the button's accessible name when idle.

## Implementation

- Store one official Google G image asset locally so the button does not depend on a third-party runtime URL.
- Reuse the existing button markup on both pages; do not introduce a shared component for only two call sites.
- Set the Manage Login button to the existing non-primary button variant so the primary gradient cannot override the white Google treatment.
- Do not change OAuth redirects, provider configuration, copy beneath the button, form behavior, or Staff mode.

## Verification

- Extend the existing Creator Google auth browser tests to assert that both visible Google buttons contain the logo.
- Verify Creator mode shows the button and Staff mode still does not.
- Check desktop and Pixel 5 layouts visually, including hover/focus/loading where practical.
- Run the focused Google auth test and `npm run verify` before handoff.
