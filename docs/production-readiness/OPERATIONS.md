# Maintenance activation checklist

These are deployment requirements, not evidence that production has been configured. Do not apply remote migrations or enable deletion without the user's explicit deployment approval.

## Order problem email

Deploy `operations-maintenance` with `PUBLIC_SITE_URL`, the existing `RESEND_API_KEY` and verified `APPLICATION_EMAIL_FROM` (or `PREORDER_EMAIL_FROM`). The message contains only a generic notice and a management-page link; report text and customer contact details remain behind management authorization.

Set a strong `MAINTENANCE_TOKEN` in function secrets. Store the same value as Vault secret `nireq_maintenance_token`, and the functions base URL (ending `/functions/v1`) as `nireq_functions_url`. Never put these values in client environment files, SQL committed to Git, or logs. The five-minute database job does nothing when its Vault configuration is absent.

Pending notifications retry up to six attempts within 23 hours, within the provider's 24-hour idempotency window. Failed/exhausted notifications remain visible on the report. Confirm real delivery and failure alerts before opening the service. Local Mailpit proves only local delivery.

## Retention

Leave `ENABLE_RETENTION` unset until the data inventory, exception policy, Storage deletion/retry tests and backup procedure are accepted. Setting it to `true` enables the same authenticated worker to prepare and delete eligible files. Public requests can request notification of an authorized report; they cannot invoke retention.

Completion dates without an existing fulfillment/cancellation timestamp start at migration time, deliberately avoiding premature deletion. Open problem reports and pending payment reviews/refunds hold cleanup. Six-month cleanup removes the listed customer fields and resolved problem content; twelve-month cleanup queues financial images. Sales quantities, prices and promotion snapshots remain. This is data minimization, not a claim of full anonymization.

Do not automatically restore a backup to public service: replay retention after restore before reopening customer/management access, or expired data can become accessible again. Define backup expiry and access separately from the live database policy.
