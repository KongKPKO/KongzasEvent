# Manager Invitation Signup Copy Design

## Goal

Align invitation signup wording with the current authentication model:

- creators and managers use password login
- seller and queue staff use magic links

## Product Decision

Keep the existing invitation signup capability for managers, but stop presenting it as a generic staff-account path.

## Login Page

Remove the public footer link:

- `Invited as staff? Create a staff account`

The login page should only expose:

- creator / manager password login
- staff magic-link login
- creator access application link

Manager account creation should be entered from a manager invitation, not from the general login page.

## Invitation Signup Page

Keep the existing route for compatibility with already-sent invitation emails, but change the visible experience from staff-oriented to manager-oriented:

- heading: `Create Manager Account`
- workspace copy explains that the invite is for manager access
- fallback copy says the account is for accepting a manager invitation and does not create a creator profile or public booth page
- validation and error copy use `manager account`
- primary button: `Create manager account`

## Invitation Messaging

Update manager-facing copy in team management and invitation email templates so they describe the actual behavior:

- manager invite creates a password-based manager account
- email CTA becomes `Create manager account`
- email body says `create a manager account`

Seller and queue staff magic-link behavior stays unchanged.

## Compatibility

Keep `/staff-signup` as the active route for now so old invitation URLs do not break. The route name can be migrated separately later if needed.

## Testing

Verify:

- the login page no longer links to account creation for invited staff
- the invitation signup screen uses manager-specific wording
- manager invitation confirmation copy uses manager-specific wording
- invitation email HTML and text use manager-specific wording
