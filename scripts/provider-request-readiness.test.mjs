// Varied-context construction adapted from canonical PR44 tests; test data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, cpSync, appendFileSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const fixtures = JSON.parse(readFileSync(join(root,'contract/provider-request-1.1/docs/plugin-contract/v1.1/conformance.json')));
const results = () => ({contractVersion:'1.1.0',host:'codex',observations:fixtures.scenarios.map(s=>({id:s.id,steps:structuredClone(s.steps.map(t=>t.expected))}))});
function measuredResults() {
  const r=results(), shift=30*86400000;
  const key = k => /^[A-Za-z0-9._~-]{1,128}$/.test(k) ? (k.length===128 ? 'y'.repeat(128) : 'pg17~run.'+k) : k;
  const stamp = v => new Date(Date.parse(v)+shift).toISOString();
  const assoc = a => ({...a,fqdn:'measured.example.test',propertyId:typeof a.propertyId==='string' && /^\d+$/.test(a.propertyId) ? '900'+a.propertyId : a.propertyId});
  for (let i=0;i<r.observations.length;i++) {
    const o=r.observations[i], s=fixtures.scenarios[i];
    o.context={evidenceRefs:['evidence://pg17/run-7/transactions-and-wire.json'],steps:s.steps.map(t=>({
      id:t.id, now:stamp(t.now), request:{...structuredClone(t.request),websiteId:t.request.websiteId==='site-a' ? '8f000000-0000-4000-8000-000000000001' : '8f000000-0000-4000-8000-000000000002',requestKey:key(t.request.requestKey),input:{...t.request.input,...(/^\d+$/.test(t.request.input.propertyId ?? '') ? {propertyId:'900'+t.request.input.propertyId} : {})}},association:assoc(t.association),
      ...(t.workBefore ? {workBefore:structuredClone(t.workBefore)} : {}),
      ...(t.committedAfterLoss ? {committedAfterLoss:{...t.committedAfterLoss,requestKey:key(t.committedAfterLoss.requestKey),expiresAt:stamp(t.committedAfterLoss.expiresAt),association:assoc(t.committedAfterLoss.association)}} : {})
    }))};
    let previous=-Infinity;
    for (const t of o.context.steps) { previous=Math.max(previous,Date.parse(t.now)); t.now=new Date(previous).toISOString(); }
    for (const t of o.steps) if (t.collection) t.collection={...t.collection,requestKey:key(t.collection.requestKey),expiresAt:stamp(t.collection.expiresAt),association:assoc(t.collection.association)};
  }
  // Real retry/read measurements need not use the fixture's one-day spacing.
  const t=r.observations.find(o=>o.id==='google.retry.reconcile').context.steps;
  t[1].now=new Date(Date.parse(t[0].now)+15000).toISOString();
  t[2].now=new Date(Date.parse(t[0].now)+17000).toISOString();
  return r;
}
function cli(value, cwd=root) {
  const dir=mkdtempSync(join(tmpdir(),'codex-provider-results-'));
  try {
    const path=join(dir,'results.json');writeFileSync(path,JSON.stringify(value));
    return spawnSync(process.execPath,[join(cwd,'scripts/check-provider-request-readiness.mjs'),'--provider-results',path],{cwd,encoding:'utf8',timeout:10000});
  } finally {rmSync(dir,{recursive:true,force:true});}
}
test('public CLI accepts measured keys, timestamps, property, FQDN and loss seed',()=>{
  const result=cli(measuredResults());assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/semantic trace assertions passed/);
});
for (const [name,id,mutate,pattern] of [
  ['owner denial result erased','website.key_scope',o=>o.steps[2].error=null,/bounded error shape/],
  ['cap result erased','caps.new_rejected_existing_available',o=>o.steps[1].error=null,/bounded error shape/],
  ['loss reconciliation changed','uncertain.committed',o=>o.steps[1].collection.status='withdrawn',/cannot revive/],
  ['changed conflict erased','google.conflict',o=>o.context.steps[1].request.input={...o.context.steps[0].request.input},/signature distinction erased/],
  ['owner predicate overridden','website.key_scope',o=>o.context.steps[2].owned=true,/measured step shape/],
  ['cap predicate overridden','caps.new_rejected_existing_available',o=>o.context.steps[1].activeCount=0,/measured step shape/],
  ['retry deadline extended','google.retry.reconcile',o=>o.steps[1].collection.expiresAt='2027-01-01T00:00:00.000Z',/cannot revive/],
  ['loss association altered','uncertain.committed',o=>o.context.steps[0].committedAfterLoss.association.fqdn='wrong.test',/loss seed association/],
  ['success seed injected','uncertain.not_committed',o=>o.context.steps[0].committedAfterLoss={},/measured step shape/],
  ['retry key substituted','google.retry.reconcile',o=>o.context.steps[1].request.requestKey='another-key',/request key equality/],
  ['website denial collapsed','website.key_scope',o=>o.context.steps[1].request.websiteId=o.context.steps[0].request.websiteId,/website distinction/],
  ['shared association changed','google.new_intent.renewal',o=>o.context.steps[1].association.fqdn='changed.test',/association equality/],
  ['expiry boundary moved','google.expiry.boundary',o=>o.context.steps[1].now=new Date(Date.parse(o.context.steps[1].now)+1).toISOString(),/exact expiry boundary/],
  ['invalid calendar timestamp','google.retry.reconcile',o=>o.context.steps[0].now='2026-02-30T00:00:00.000Z',/invalid timestamp/],
  ['unbounded evidence ref','google.retry.reconcile',o=>o.context.evidenceRefs=['x'.repeat(513)],/bounded evidence/],
  ['missing context step','google.retry.reconcile',o=>o.context.steps.pop(),/context step coverage/],
  ['canonical action overridden','google.withdraw.shared.scheduled.leased',o=>o.context.steps[2].action='lookup',/measured step shape/],
]) test('public CLI rejects measured '+name,()=>{
  const r=measuredResults();mutate(r.observations.find(o=>o.id===id));
  const result=cli(r);assert.notEqual(result.status,0);assert.match(result.stderr,pattern);
});

test('public CLI rejects mixing measured and synthetic context',()=>{
  const r=measuredResults();delete r.observations[1].context;
  const result=cli(r);assert.notEqual(result.status,0);assert.match(result.stderr,/context required for every trace/);
});

test('public CLI bounds entire measured envelope before parsing',()=>{
  const r=measuredResults();r.observations[0].context.evidenceRefs=['x'.repeat(1024*1024)];
  const result=cli(r);assert.notEqual(result.status,0);assert.match(result.stderr,/exceeds 1 MiB/);
});


test('synthetic CLI label stays explicit',()=>{
  const r=cli(results());assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/Synthetic fixture context selected/);
  assert.doesNotMatch(r.stdout,/Measured context supplied/);
});
test('measured CLI label and independent provenance boundary',()=>{
  const r=cli(measuredResults());assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/Measured context supplied for all/);assert.match(r.stdout,/provenance and live support are not verified/);
});
for (const [name, mutate, pattern] of [
  ['wrong host', r=>r.host='pi', /Codex results required/],
  ['missing scenario', r=>r.observations.pop(), /missing\/extra scenarios/],
  ['wrong input-job association', r=>r.observations[0].steps[0].collection.association.propertyId='wrong', /input\/job association mismatch/],
]) test('local CLI rejects '+name,()=>{
  const r=measuredResults();mutate(r);const out=cli(r);assert.notEqual(out.status,0);assert.match(out.stderr,pattern);
});
for (const [name, mutate, pattern] of [
  ['canonical validator drift', dir=>appendFileSync(join(dir,'contract/provider-request-1.1/scripts/provider-request-contract.mjs'),'\n'), /contract drift/],
  ['skill drift', dir=>appendFileSync(join(dir,'contract/provider-request-1.1/plugins/htp/skills/website-management/SKILL.md'),' '), /contract drift/],
  ['fixture case erasure', dir=>{const p=join(dir,'contract/provider-request-1.1/docs/plugin-contract/v1.1/conformance.json');const v=JSON.parse(readFileSync(p));v.scenarios.pop();writeFileSync(p,JSON.stringify(v));}, /contract drift/],
  ['missing artifact', dir=>unlinkSync(join(dir,'contract/provider-request-1.1/scripts/provider-request-contract.mjs')), /file inventory drift/],
  ['unlisted artifact', dir=>writeFileSync(join(dir,'contract/provider-request-1.1/extra.json'),'{}'), /file inventory drift/],
  ['canonical pin drift', dir=>{const p=join(dir,'contract/provider-request-1.1.lock.json');const v=JSON.parse(readFileSync(p));v.canonicalCommit='0'.repeat(40);writeFileSync(p,JSON.stringify(v));}, /AssertionError/],
]) test('local readiness rejects '+name,()=>{
  const dir=mkdtempSync(join(tmpdir(),'codex-provider-drift-'));
  try {
    for(const p of ['scripts','contract','package.json']) cpSync(join(root,p),join(dir,p),{recursive:true});
    mutate(dir);const out=cli(results(),dir);assert.notEqual(out.status,0);assert.match(out.stderr,pattern);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
