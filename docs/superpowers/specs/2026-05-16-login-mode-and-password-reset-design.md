# Login Mode And Password Reset Design

## Goal

Make the management login page easier to understand by separating creator/manager login from staff login, and add a clear password reset entry point for creator/manager users.

## Product Decision

Use a segmented role switcher at the top of the login card:

- `Creator / Manager`
- `Staff`

Only one login flow is visible at a time.

## Creator / Manager Flow

Default view on `/manage-login`.

Contents:

- Title: `Creator / Manager Login`
- Email field
- Password field
- `Forgot password?` link under the password field
- Primary button: `Login to Dashboard`

Password reset behavior:

1. User clicks `Forgot password?`
2. If the email field is empty, the UI asks for the creator/manager email first.
3. Supabase password recovery email is sent for that email.
4. The recovery link routes into the existing `/reset-password` page.
5. Success copy should confirm that the reset email was sent without exposing whether the account exists.

## Staff Flow

Second segmented option on the same page.

Contents:

- Title: `Staff Login`
- Short explanation that seller and queue staff sign in by magic link
- Staff email field
- Primary button: `Send magic link`

Staff do not receive a password reset action because this role uses passwordless login.

## Supporting Links

Keep the secondary access links outside the main login card:

- `Need a creator workspace? Apply for access`
- `Invited as staff? Create a staff account`

These remain visible regardless of the selected login mode.

## UX Rationale

- A role switcher answers the user's first question before showing a form: "Which login path applies to me?"
- Showing one flow at a time removes the current visual competition between creator login and staff magic link.
- `Forgot password?` belongs only in the creator/manager flow, next to the password input where users expect it.
- The segmented control is more discoverable than a small swap button and more compact than full page tabs.

## Error And Feedback Rules

- Creator login errors stay within the creator flow.
- Forgot password feedback should be neutral for security, for example: `If an account exists for this email, a password reset link has been sent.`
- Staff magic link errors stay within the staff flow.
- Switching modes should clear flow-specific transient errors so one role does not inherit the other's feedback.

## Testing

Verify:

- Creator/manager is the default mode.
- Staff mode hides creator password fields and shows only staff magic link controls.
- `Forgot password?` appears only in creator/manager mode.
- Password reset uses the entered email and sends the user into the existing reset flow.
- Existing login and staff magic link behaviors continue to work.
