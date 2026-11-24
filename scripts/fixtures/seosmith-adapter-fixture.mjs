#!/usr/bin/env node
// Synthetic local SEOsmith adapter for offline tests only.
//
// This is NOT the product binding and NOT the real SEOsmith crawler. It
// implements a constrained subset of the documented adapter-version-1 local
// CLI contract so tests can exercise the typed MCP server without network,
// credentials, or a real crawl. It fails closed on unexpected input and never
// contacts a service.
//
// Env:
//   FIXTURE_DISABLE_EXPORT=1  -> advertise capabilities without seosmith.export

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const OPERATIONS = [
  'seosmith.start',
  'seosmith.status',
  'seosmith.cancel',
  'seosmith.report',
  'seosmith.export',
];

const REPORT = Buffer.from(
  JSON.stringify({
    schema_version: 1,
    outcome: 'unknown',
    stop_reason: 'resource_limit',
    coverage_complete: false,
    synthetic: true,
    note: 'offline fixture report; not a live audit',
  }),
  'utf8',
);

function fail(code, message) {
  process.stderr.write(`${JSON.stringify({ error: code, message })}\n`);
  process.exit(1);
}

function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
  process.exit(0);
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

const argv = process.argv.slice(2);
let database = null;
if (argv[0] === '--database') {
  database = argv[1];
  argv.splice(0, 2);
}
if (argv[0] !== 'operations') fail('invalid_invocation');
const rest = argv.slice(1);
const operation = rest[0];
if (operation !== 'capabilities' && !database) fail('invalid_invocation');

const statePath = `${database}.fixture-state.json`;

function readState() {
  if (!existsSync(statePath)) return null;
  return JSON.parse(readFileSync(statePath, 'utf8'));
}

const DISABLE_EXPORT = existsSync(`${process.argv[1]}.no-export`);

function capabilities() {
  const operations = DISABLE_EXPORT
    ? OPERATIONS.filter((op) => op !== 'seosmith.export')
    : OPERATIONS.slice();
  return {
    adapter_version: 1,
    engine_version: 'fixture-0.0.0',
    report_schema_version: 1,
    ruleset_version: 'fixture',
    transport: 'local_cli',
    operations,
    limits: {
      request_bytes: 16384,
      report_bytes: 16777216,
      pages: [1, 20000],
      resources: [0, 20000],
      duration_seconds: [10, 7200],
      delay_ms: [1000, 60000],
    },
    advanced: { evidence_v2: false, authorized_staging: false, ci_baseline: false },
    delivery: 'disabled',
    authentication: 'local_os_account',
  };
}

if (operation === 'capabilities') emit(capabilities());

if (operation === 'start') {
  const requestIndex = rest.indexOf('--request');
  if (requestIndex === -1) fail('invalid_invocation');
  let request;
  try {
    request = JSON.parse(readFileSync(rest[requestIndex + 1], 'utf8'));
  } catch {
    fail('invalid_request_json');
  }
  const required = [
    'request_id',
    'website_id',
    'url',
    'max_pages',
    'max_resources',
    'max_duration_seconds',
    'delay_ms',
    'check_external_links',
  ];
  for (const field of required) {
    if (!(field in request)) fail('explicit_bounds_required');
  }
  const existing = readState();
  if (existing) {
    if (existing.request.request_id !== request.request_id) fail('database_scope_conflict');
    if (JSON.stringify(existing.request) !== JSON.stringify(request)) fail('request_id_conflict');
  } else {
    writeFileSync(
      statePath,
      JSON.stringify({ request, report: REPORT.toString('utf8') }),
      { mode: 0o600 },
    );
  }
  const state = readState();
  emit({
    adapter_version: 1,
    request_id: state.request.request_id,
    state: 'partial',
    execution_state: 'terminal',
    worker_active: null,
    report_available: true,
    delivery_state: 'disabled',
    error: null,
  });
}

const idIndex = rest.indexOf('--id');
const id = idIndex === -1 ? null : rest[idIndex + 1];
if (id === null) fail('invalid_invocation');

const state = readState();
if (!state || state.request.request_id !== id) fail('run_not_found');

if (operation === 'status') {
  emit({
    adapter_version: 1,
    request_id: id,
    state: 'partial',
    execution_state: 'terminal',
    worker_active: null,
    report_available: true,
    delivery_state: 'disabled',
    error: null,
  });
}

if (operation === 'cancel') {
  emit({
    adapter_version: 1,
    request_id: id,
    cancel_accepted: false,
    cancellation_terminal: false,
  });
}

if (operation === 'report') {
  process.stdout.write(REPORT);
  process.exit(0);
}

if (operation === 'export') {
  const outputIndex = rest.indexOf('--output');
  if (outputIndex === -1) fail('invalid_invocation');
  const output = rest[outputIndex + 1];
  if (existsSync(output)) fail('export_exists');
  if (!capabilities().operations.includes('seosmith.export')) fail('unsupported_capability');
  writeFileSync(output, REPORT, { mode: 0o600, flag: 'wx' });
  emit({ request_id: id, bytes: REPORT.length, sha256: sha256(REPORT) });
}

fail('unsupported_operation');
