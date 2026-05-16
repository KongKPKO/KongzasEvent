# Forgot Password Modal Design

## Goal

Separate password recovery from the creator / manager login form so users understand it as its own flow.

## Product Decision

Use a dedicated modal popup for password recovery instead of reusing the login email field.

## Entry Point

Keep the `Forgot password?` action under the creator / manager password field.

When clicked:

- open a modal titled `Reset password`
- do not prefill the recovery email from the login form
- start with an empty email field every time the modal opens

## Modal Contents

- title: `Reset password`
- helper copy: `Enter your creator or manager email and we'll send a reset link.`
- empty email input
- primary action: `Send reset link`
- secondary action: `Cancel`

## Behavior

1. User clicks `Forgot password?`
2. Modal opens with a blank email field
3. User enters an email and submits
4. Supabase sends the recovery email with redirect to `/reset-password`
5. The modal shows neutral success copy:
   - `If an account exists for this email, a password reset link has been sent.`

The modal should stay open after success so the user can read the result before dismissing it.

## Validation And Feedback

- Blank email submission shows an inline modal error asking for the creator / manager email
- Invalid email uses browser validation from the email input
- Reset errors still resolve to the same neutral success copy so the UI does not reveal whether an account exists
- Closing and reopening the modal resets the email input, loading state, and modal-local feedback

## Login Mode Interaction

- The modal is available only from creator / manager mode
- Switching to `Staff` mode closes the modal and clears its local state
- Staff magic-link flow remains unchanged

## Testing

Verify:

- clicking `Forgot password?` opens the modal
- the modal email starts blank even if the login email field already has a value
- submitting blank email shows the modal-local required message
- submitting a valid email shows the neutral success message in the modal
- switching to `Staff` closes the modal
