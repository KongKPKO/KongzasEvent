# LogRocket Observability

LogRocket is wired as an optional browser session replay/error tool. It is disabled unless `VITE_LOGROCKET_APP_ID` is set and `VITE_LOGROCKET_DISABLED` is not `true`.

## Environment Variables

```bash
VITE_LOGROCKET_APP_ID=org/app
VITE_LOGROCKET_DISABLED=false
VITE_LOGROCKET_CAPTURE_EMAIL=false
VITE_RELEASE_SHA=<git-sha>
```

Keep `VITE_LOGROCKET_CAPTURE_EMAIL=false` unless there is a clear support need. The default identify call uses Supabase user id, role, artist id, and platform-admin flag, not email.

## Privacy Defaults

The integration intentionally:

- disables IP capture
- sanitizes form inputs
- removes request and response bodies
- redacts auth/API headers
- redacts sensitive URL query parameters such as access tokens and reset codes

Use `data-private`, `data-sensitive`, `lr-private`, `private`, or `sensitive` on future UI areas that should not be captured.

## What To Check After Enabling

1. Deploy DEV with `VITE_LOGROCKET_APP_ID`.
2. Open customer menu, admin login, and event workspace.
3. Confirm sessions appear in LogRocket.
4. Confirm network body payloads are not visible.
5. Confirm password/input values are not visible.
6. Trigger a harmless console error in DEV and confirm it is searchable.

## Production Gate

Before enabling in production:

- confirm consent/privacy expectations for customer session replay
- verify no payment evidence image, phone, address, or auth token is captured
- verify session volume/cost is acceptable
- document who has LogRocket workspace access
