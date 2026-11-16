import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {readJson,validateResults} from './plugin-contract.mjs';
const lock=readJson(new URL('../contract.lock.json',import.meta.url));
assert.equal(lock.revision,'3db3e439ec0adc99211d49358a7cb8a29507a940');
for(const [path,hash] of Object.entries(lock.files)) {
 assert.ok(!path.includes('..') && !path.startsWith('/'));
 assert.equal(createHash('sha256').update(readFileSync(new URL('../'+path,import.meta.url))).digest('hex'),hash,`contract drift: ${path}`);
}
const base=new URL('../docs/plugin-contract/v1/',import.meta.url);
const {operations}=readJson(new URL('capabilities.json',base));
const fixtures=readJson(new URL('conformance.json',base));
for(const service of ['htp','seosmith']) assert.ok(operations.some(o=>o.service===service));
assert.equal(fixtures.live,false);
assert.equal(fixtures.evidenceKind,'synthetic');
const profile=readJson(new URL('hosts/codex.json',base));
assert.equal(profile.host,'codex');
assert.equal(profile.packageStatus,'not-implemented');
assert.equal(profile.minimumVersion,null);
assert.equal(profile.auth.method,'host-oauth');
assert.deepEqual(profile.gates,['htp#34','seosmith#18','host-package-wave1']);
assert.ok(profile.readiness.htp && profile.readiness.seosmith);
const results={contractVersion:fixtures.contractVersion,host:'codex',observations:fixtures.scenarios.map(s=>({id:s.id,result:s.expected}))};
validateResults(fixtures,results,operations);
const args=process.argv.slice(2);
if(args.length) {assert.equal(args.length,2);assert.equal(args[0],'--results');const external=readJson(args[1]);assert.equal(external.host,'codex');validateResults(fixtures,external,operations);}
console.log(`Offline Codex contract OK: ${operations.length} operations, ${fixtures.scenarios.length} scenarios; golden-only synthetic self-test; no live acceptance.`);
