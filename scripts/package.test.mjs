import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';

const root = new URL('../', import.meta.url);
const json = p => JSON.parse(readFileSync(new URL(p, root)));
test('marketplace points to a versioned Codex plugin with canonical HTP skills', () => {
  const market = json('.agents/plugins/marketplace.json');
  const manifest = json('plugin/.codex-plugin/plugin.json');
  assert.equal(market.plugins[0].source.path, './plugin');
  assert.equal(market.plugins[0].name, manifest.name);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.skills, './skills/');
  const source = new URL('contract/audit-export-1.2/plugins/htp/skills/', root);
  const target = new URL('plugin/skills/', root);
  function compare(dir = '') {
    for (const entry of readdirSync(new URL(dir, source), {withFileTypes:true})) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) compare(path + '/');
      else assert.deepEqual(readFileSync(new URL(path, target)), readFileSync(new URL(path, source)), path);
    }
  }
  compare();
});
test('SEOsmith instructions gate capabilities and preserve uncertainty', () => {
  const skill = readFileSync(new URL('plugin/skills/seosmith-operations/SKILL.md', root), 'utf8');
  for (const text of ['adapter_version', 'seosmith.start', 'seosmith.status', 'seosmith.cancel', 'seosmith.report', 'seosmith.export', 'cancellation_terminal', 'identical request ID', 'shell execution disabled']) assert.ok(skill.includes(text), text);
});
