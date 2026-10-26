import assert from "node:assert/strict";
import test from "node:test";
import { buildInviteHtml, buildInviteText } from "./email.ts";

test("staff invitation includes trusted invitation context and escapes HTML", () => {
  const input = {
    artistName: "Mali & Moon",
    inviterEmail: "owner@example.com",
    role: "seller" as const,
    roleLabel: "Seller / POS Staff",
    eventNames: ["Creator <Fest>", "Winter Market"],
    accessUrl: "https://example.com/auth?token=secret&next=%2Finvitations",
  };

  const html = buildInviteHtml(input);
  const text = buildInviteText(input);

  assert.match(html, /Invited by:<\/strong> owner@example\.com/);
  assert.match(html, /Seller \/ POS Staff/);
  assert.match(html, /Creator &lt;Fest&gt;/);
  assert.doesNotMatch(html, /Creator <Fest>/);
  assert.match(html, /Sign in and review invitation/);
  assert.match(html, /on Paimon/);
  assert.match(text, /on Paimon/);
  assert.doesNotMatch(html, /NireQ|#db2777|#f3d1e2|#fff7fb/);
  assert.match(text, /Invited by: owner@example\.com/);
  assert.match(text, /Event access: Creator <Fest>, Winter Market/);
});

test("manager invitation offers signup and returning-user destinations", () => {
  const html = buildInviteHtml({
    artistName: "Mali Studio",
    inviterEmail: "owner@example.com",
    role: "manager",
    roleLabel: "Manager",
    eventNames: [],
    accessUrl: "https://example.com/manage-login?redirect=%2Finvitations",
    managerSignupUrl: "https://example.com/staff-signup?email=manager%40example.com",
  });

  assert.match(html, /Event access:<\/strong> <strong>All events<\/strong>/);
  assert.match(html, /Create manager account/);
  assert.match(html, /Already have a Paimon account\?/);
  assert.match(html, /Sign in to review the invitation/);
  assert.doesNotMatch(html, /NireQ|#db2777|#f3d1e2|#fff7fb/);
});
