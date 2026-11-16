import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,appendFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
test('modified pinned inventory fails closed',()=>{
 const dir=mkdtempSync(join(tmpdir(),'codex-drift-'));
 try {for(const p of ['scripts','docs','contract.lock.json','package.json'])cpSync(p,join(dir,p),{recursive:true});appendFileSync(join(dir,'docs/plugin-contract/v1/capabilities.json'),' ');const r=spawnSync(process.execPath,['scripts/check.mjs'],{cwd:dir,encoding:'utf8'});assert.notEqual(r.status,0);assert.match(r.stderr,/contract drift/);}finally{rmSync(dir,{recursive:true,force:true});}
});
