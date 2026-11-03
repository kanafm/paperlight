import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LanguageSession, type ServerDriver } from '../src/session.ts';
import type { Launch } from '../src/adapters.ts';

const launch: Launch = { tool: { path: '/test/server', source: 'profile' }, args: [], env: {}, cwd: '/test', settings: {}, initializationOptions: {} };
const deferred = () => Promise.withResolvers<void>();

test('disabling during environment resolution prevents a late spawn', async () => {
	const pending = deferred();
	let spawned = 0;
	const session = new LanguageSession(async () => { await pending.promise; return launch; }, () => {
		spawned++;
		return { start: async () => {}, stop: async () => {} };
	}, () => {});
	const start = session.start();
	await session.stop(true);
	pending.resolve();
	await start;
	assert.equal(spawned, 0);
	assert.equal(session.state, 'disabled');
	await session.start();
	assert.equal(spawned, 0);
});

test('stopping during initialization disposes the driver and cannot return to running', async () => {
	const pending = deferred();
	const created = deferred();
	let stopped = 0;
	const session = new LanguageSession(async () => launch, () => {
		created.resolve();
		return { start: () => pending.promise, stop: async () => { stopped++; } };
	}, () => {});
	const starting = session.start();
	await created.promise;
	await session.stop(true);
	pending.resolve();
	await starting;
	assert.equal(stopped, 1);
	assert.equal(session.state, 'disabled');
});

test('unexpected exit cleans up once and requires an explicit restart', async () => {
	let exited: ((message: string) => void) | undefined;
	let starts = 0;
	let stops = 0;
	const session = new LanguageSession(async () => launch, (_launch, callback): ServerDriver => {
		exited = callback;
		return { start: async () => { starts++; }, stop: async () => { stops++; } };
	}, () => {});
	await session.start();
	exited!('crashed');
	await session.start();
	assert.equal(starts, 1);
	assert.equal(stops, 1);
	assert.equal(session.state, 'failed');
	await session.restart();
	assert.equal(starts, 2);
	assert.equal(session.state, 'running');
	await session.stop();
});

test('disable wins over a restart that is still stopping the previous process', async () => {
	const stopping = deferred();
	let starts = 0;
	const session = new LanguageSession(async () => launch, () => ({ start: async () => { starts++; }, stop: () => stopping.promise }), () => {});
	await session.start();
	const restarting = session.restart();
	const disabling = session.stop(true);
	stopping.resolve();
	await Promise.all([restarting, disabling]);
	assert.equal(starts, 1);
	assert.equal(session.state, 'disabled');
});
