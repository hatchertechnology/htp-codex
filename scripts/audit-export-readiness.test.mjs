import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, cpSync, appendFileSync, unlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syntheticExportResults, syntheticExportTrace } from '../contract/audit-export-1.2/scripts/audit-export-fixtures.mjs';
import { exportFixtures, syntheticContext } from '../contract/audit-export-1.2/scripts/audit-export-contract.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
function run(results, mutate) {
 const dir=mkdtempSync(join(tmpdir(),'codex-export-'));
 try {
  let cwd=root;
  if(mutate) { cwd=join(dir,'repo');cpSync(join(root,'scripts'),join(cwd,'scripts'),{recursive:true});cpSync(join(root,'contract'),join(cwd,'contract'),{recursive:true});mutate(cwd); }
  const args=[join(cwd,'scripts/check-audit-export-readiness.mjs')];
  if(results) {const p=join(dir,'results.json');writeFileSync(p,JSON.stringify(results));args.push('--export-results',p);}
  return spawnSync(process.execPath,args,{encoding:'utf8',timeout:10000});
 } finally {rmSync(dir,{recursive:true,force:true});}
}
function measured() {
 return {contractVersion:'1.2.0',host:'codex',observations:exportFixtures.scenarios.map(s=>{
  const context=syntheticContext(s);context.originMs+=86400000;context.owner='test-owner';context.other='test-other';context.evidenceRefs=['test-only://fabricated-context'];
  return {id:s.id,context,steps:syntheticExportTrace(s,context)};
 })};
}
test('synthetic CLI checks all scenarios with explicit label',()=>{const r=run(syntheticExportResults('codex'));assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/Synthetic offline/);assert.match(r.stdout,/19 synthetic scenarios/);});
test('fabricated varied context exercises measured label without live claim',()=>{const r=run(measured());assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/Measured context semantic/);assert.match(r.stdout,/provenance.*independent verification/);});
for(const [name,mutate] of [
 ['wrong host',r=>r.host='pi'],
 ['missing scenario',r=>r.observations.pop()],
 ['duplicate scenario',r=>r.observations[1]=r.observations[0]],
 ['mixed contexts',r=>delete r.observations[0].context],
 ['collection side effect',r=>r.observations[0].steps[0].effects.collectionJobsAfter++],
 ['step omission',r=>r.observations[0].steps.pop()],
 ['source byte corruption',r=>r.observations[0].context.bytesBase64='e30='],
 ['chunk corruption',r=>{for(const o of r.observations) for(const s of o.steps) if(s.result?.structuredContent?.dataBase64) {s.result.structuredContent.dataBase64='e30=';return;}}],
 ['evidence envelope bound',r=>r.padding='x'.repeat(32*1024*1024)],
]) test('CLI rejects '+name,()=>{const r=measured();mutate(r);assert.notEqual(run(r).status,0);});
const tree='contract/audit-export-1.2/';
for(const [name,mutate] of [
 ['validator drift',d=>appendFileSync(join(d,tree+'scripts/audit-export-contract.mjs'),'\n')],
 ['skill drift',d=>appendFileSync(join(d,tree+'plugins/htp/skills/seo-review/SKILL.md'),'\n')],
 ['missing file',d=>unlinkSync(join(d,tree+'scripts/audit-export-fixtures.mjs'))],
 ['unlisted file',d=>writeFileSync(join(d,tree+'extra'),'x')],
 ['pin drift',d=>{const p=join(d,'contract/audit-export-1.2.lock.json');const l=JSON.parse(readFileSync(p));l.canonicalCommit='0'.repeat(40);writeFileSync(p,JSON.stringify(l));}],
 ['gate removal',d=>{const p=join(d,'contract/audit-export-1.2.lock.json');const l=JSON.parse(readFileSync(p));l.activationGates=[];writeFileSync(p,JSON.stringify(l));}],
]) test('readiness rejects '+name,()=>assert.notEqual(run(null,mutate).status,0));
