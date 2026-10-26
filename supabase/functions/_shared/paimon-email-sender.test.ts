import assert from "node:assert/strict";
import test from "node:test";
import { withPaimonSenderName } from "./paimon-email-sender.ts";

test("rebrands only the NireQ display name and preserves the address", () => {
  assert.equal(
    withPaimonSenderName("NireQ <support@nireqapp.com>"),
    "Paimon <support@nireqapp.com>",
  );
  assert.equal(
    withPaimonSenderName("Nireq Support <orders@nireqapp.com>"),
    "Paimon Support <orders@nireqapp.com>",
  );
  assert.equal(
    withPaimonSenderName('"NireQ Support" <hello@nireqapp.com>'),
    '"Paimon Support" <hello@nireqapp.com>',
  );
});

test("leaves custom display names and bare addresses unchanged", () => {
  assert.equal(
    withPaimonSenderName("Studio Support <support@nireqapp.com>"),
    "Studio Support <support@nireqapp.com>",
  );
  assert.equal(
    withPaimonSenderName("support@nireqapp.com"),
    "support@nireqapp.com",
  );
});
