import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { adapters, prepareLaunch, configurationValue } from '../src/adapters.ts';
import { resolveEnvironment } from '../src/environment.ts';

const adapter = adapters.find(adapter => adapter.id === 'java')!;

test('Java uses project tools and keeps same-named project server state separate', async t => {
	const root = await mkdtemp(path.join(tmpdir(), 'paperlight-java-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const home = path.join(root, 'home');
	const jdk = path.join(root, 'jdk');
	const tools = path.join(root, 'tools');
	for (const directory of [path.join(jdk, 'bin'), tools, path.join(home, '.nix-profile/bin')]) { await mkdir(directory, { recursive: true }); }
	await writeFile(path.join(jdk, 'release'), 'JAVA_VERSION="17.0.12"');
	await writeFile(path.join(jdk, 'bin/java'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
	for (const directory of [tools, path.join(home, '.nix-profile/bin')]) { await writeFile(path.join(directory, 'jdtls'), '#!/bin/sh\nexit 0\n', { mode: 0o755 }); }
	const launches = [];
	for (const parent of ['one #', 'two']) {
		const project = path.join(root, parent, 'project');
		await mkdir(project, { recursive: true });
		const environment = await resolveEnvironment(project, path.join(root, 'state'), new AbortController().signal, { home, base: {} });
		environment.flakePaths.push(tools, path.join(jdk, 'bin'));
		const launch = (await prepareLaunch(adapter, environment))!;
		assert.equal(launch.tool.path, path.join(tools, 'jdtls'));
		assert.deepEqual(configurationValue(launch.settings, 'java.configuration.runtimes'), [{ name: 'JavaSE-17', path: jdk, default: true }]);
		assert.deepEqual(launch.initializationOptions.workspaceFolders, [pathToFileURL(project).toString()]);
		assert.ok(launch.args.includes('--jvm-arg=-Djava.import.generatesMetadataFilesAtProjectRoot=false'));
		const properties = await readFile(path.join(launch.env.GRADLE_USER_HOME!, 'gradle.properties'), 'utf8');
		assert.ok(properties.includes('org.gradle.projectcachedir='));
		assert.ok(properties.includes('org.gradle.java.installations.auto-download=false'));
		assert.deepEqual(await readdir(project), []);
		launches.push(launch);
	}
	assert.notEqual(launches[0].args[1], launches[1].args[1]);
	assert.notEqual(launches[0].env.GRADLE_USER_HOME, launches[1].env.GRADLE_USER_HOME);
});

test('Java can use a server with a bundled runtime and reports an absent server', async t => {
	const root = await mkdtemp(path.join(tmpdir(), 'paperlight-java-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const environment = await resolveEnvironment(root, path.join(root, 'state'), new AbortController().signal, { home: root, base: { GRADLE_USER_HOME: path.join(root, 'custom-gradle') } });
	assert.equal(await prepareLaunch(adapter, environment), undefined);
	await mkdir(environment.profile, { recursive: true });
	await writeFile(path.join(environment.profile, 'jdtls'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
	const launch = (await prepareLaunch(adapter, environment))!;
	assert.deepEqual(configurationValue(launch.settings, 'java.configuration.runtimes'), []);
	assert.equal(launch.env.GRADLE_USER_HOME, path.join(root, 'custom-gradle'));
});
