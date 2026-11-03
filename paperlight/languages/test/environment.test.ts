import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveEnvironment, resolveTool, exportedEnvironment } from '../src/environment.ts';
import { adapters, prepareLaunch, configurationValue } from '../src/adapters.ts';

async function fixture(t: { after(fn: () => Promise<void>): void }) {
	const root = await mkdtemp(path.join(tmpdir(), 'paperlight-environment-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const home = path.join(root, 'home');
	const project = path.join(root, 'project');
	await mkdir(project);
	const executable = async (directory: string, name: string) => {
		await mkdir(directory, { recursive: true });
		await writeFile(path.join(directory, name), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
	};
	return { root, home, project, executable, storage: path.join(root, 'storage') };
}

test('Python prefers an existing venv; other tools prefer the flake, then profile', async t => {
	const f = await fixture(t);
	const profile = path.join(f.home, '.nix-profile', 'bin');
	const flake = path.join(f.root, 'flake-bin');
	const venv = path.join(f.project, '.venv', 'bin');
	for (const directory of [profile, flake, venv]) {
		for (const name of ['python', 'pyright-langserver', 'gopls']) { await f.executable(directory, name); }
	}
	await writeFile(path.join(f.project, '.venv', 'pyvenv.cfg'), 'home = python\n');
	await writeFile(path.join(f.project, 'flake.nix'), '{}');
	const calls: string[][] = [];
	const base = { HOME: f.home, PATH: '/unrelated', NODE_OPTIONS: '--inspect', VIRTUAL_ENV: '/unrelated', SHARED: 'base' };
	const before = { ...base };
	const environment = await resolveEnvironment(f.project, f.storage, new AbortController().signal, {
		home: f.home, base, nix: process.execPath,
		run: async (_command, args) => {
			calls.push([...args]);
			return args[0] === 'eval' ? 'true' : JSON.stringify({ variables: {
				PATH: { type: 'exported', value: flake },
				PROJECT: { type: 'exported', value: 'first' },
				shellHook: { type: 'exported', value: 'touch forbidden' },
				HOME: { type: 'exported', value: '/homeless-shelter' }
			} });
		}
	});
	assert.equal((await resolveTool(environment, 'python', true))?.source, 'venv');
	assert.equal((await resolveTool(environment, 'gopls'))?.source, 'flake');
	await rm(path.join(flake, 'gopls'));
	assert.equal((await resolveTool(environment, 'gopls'))?.source, 'profile');
	assert.equal(await resolveTool(environment, 'missing'), undefined);
	assert.equal(environment.variables.HOME, f.home);
	assert.equal(environment.variables.NODE_OPTIONS, undefined);
	assert.equal(environment.variables.shellHook, undefined);
	assert.equal(environment.variables.PATH?.includes('/unrelated'), false);
	assert.deepEqual(base, before);
	assert.ok(calls.every(args => args.includes('--no-write-lock-file')));
	assert.ok(calls.every(args => !args.includes('develop') && !args.includes('--command')));
	const python = await prepareLaunch(adapters[3], environment);
	assert.equal(configurationValue(python!.settings, 'python.pythonPath'), path.join(venv, 'python'));
	assert.equal(python!.env.VIRTUAL_ENV, path.dirname(venv));
	assert.equal(environment.variables.VIRTUAL_ENV, undefined);
	await rm(path.join(venv, 'python'));
	await f.executable(venv, 'python3');
	assert.equal((await resolveTool(environment, ['python', 'python3'], true))?.path, path.join(venv, 'python3'));
});

test('separate projects retain distinct environments and cache directories', async t => {
	const f = await fixture(t);
	const second = path.join(f.root, 'second');
	await mkdir(second);
	await Promise.all([f.project, second].map(root => writeFile(path.join(root, 'flake.nix'), '{}')));
	const original = { ...process.env };
	const environments = await Promise.all([f.project, second].map(root => resolveEnvironment(root, f.storage, new AbortController().signal, {
		home: f.home, nix: process.execPath, base: {},
		run: async (_command, args, cwd) => args[0] === 'eval' ? 'true' : JSON.stringify({ variables: { PROJECT: { type: 'exported', value: cwd } } })
	})));
	assert.notEqual(environments[0].cache, environments[1].cache);
	assert.equal(environments[0].variables.PROJECT, f.project);
	assert.equal(environments[1].variables.PROJECT, second);
	assert.ok(JSON.stringify({ ...process.env }) === JSON.stringify(original), 'Process environment must remain unchanged');
});

test('a broken flake fails visibly; an absent default shell permits profile fallback', async t => {
	const f = await fixture(t);
	await writeFile(path.join(f.project, 'flake.nix'), '{}');
	const options = { home: f.home, nix: process.execPath, base: {} };
	await assert.rejects(resolveEnvironment(f.project, f.storage, new AbortController().signal, {
		...options, run: async () => { throw new Error('Broken flake'); }
	}), /Broken flake/);
	const environment = await resolveEnvironment(f.project, f.storage, new AbortController().signal, { ...options, run: async () => 'false' });
	assert.match(environment.description, /No default/);
	assert.deepEqual(environment.flakePaths, []);
});

test('only exported scalar variables are imported', () => {
	assert.deepEqual(exportedEnvironment(JSON.stringify({ variables: {
		A: { type: 'exported', value: 'value' }, B: { type: 'var', value: 'hidden' }, C: { type: 'exported', value: ['array'] }
	} })), { A: 'value' });
	assert.throws(() => exportedEnvironment('{}'));
});
