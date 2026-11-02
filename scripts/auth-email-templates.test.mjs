import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('auth email templates retain a single confirmation link and Paimon branding', () => {
  const config = readFileSync('supabase/config.toml', 'utf8');
  for (const name of ['confirmation', 'recovery', 'magic_link', 'invite', 'email_change']) {
    const html = readFileSync(`supabase/templates/${name}.html`, 'utf8');
    assert.ok(config.includes(`[auth.email.template.${name}]`), `${name} must be configured`);
    assert.ok(config.includes(`content_path = "./supabase/templates/${name}.html"`));
    assert.equal((html.match(/{{\s*\.ConfirmationURL\s*}}/g) || []).length, 1);
    assert.match(html, /href="{{\s*\.ConfirmationURL\s*}}"/);
    assert.match(html, /Paimon/);
    assert.doesNotMatch(html, /nireq/i);
  }
});
