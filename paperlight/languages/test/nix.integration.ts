import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveEnvironment, resolveTool } from '../src/environment.ts';

test('real Nix evaluation imports the shell without running shellHook or writing a lockfile', async t => {
	const nixpkgs = process.env.PAPERLIGHT_TEST_NIXPKGS;
	assert.ok(nixpkgs, 'Set PAPERLIGHT_TEST_NIXPKGS to a local Nixpkgs source');
	assert.match(nixpkgs, /^\/nix\/store\/[a-z0-9-]+$/);
	const root = await mkdtemp(path.join(tmpdir(), 'paperlight-nix-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const project = path.join(root, 'project');
	await mkdir(project);
	await writeFile(path.join(project, 'flake.nix'), `{
		outputs = { self }: let pkgs = import ${nixpkgs} { system = "aarch64-darwin"; }; in {
			devShells.aarch64-darwin.default = pkgs.mkShell {
				packages = [ pkgs.hello ];
				PAPERLIGHT_TEST_VALUE = "project-specific";
				shellHook = "touch hook-ran";
			};
		};
	}`);
	const environment = await resolveEnvironment(project, path.join(root, 'storage'), new AbortController().signal);
	assert.equal(environment.variables.PAPERLIGHT_TEST_VALUE, 'project-specific');
	assert.equal((await resolveTool(environment, 'hello'))?.source, 'flake');
	await assert.rejects(access(path.join(project, 'hook-ran')), { code: 'ENOENT' });
	await assert.rejects(access(path.join(project, 'flake.lock')), { code: 'ENOENT' });
});
