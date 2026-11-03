import { constants } from 'node:fs';
import { access, mkdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { capture } from './processes.ts';

export type ToolSource = 'venv' | 'flake' | 'profile';

export interface ResolvedTool {
	path: string;
	source: ToolSource;
}

export interface ProjectEnvironment {
	root: string;
	cache: string;
	variables: NodeJS.ProcessEnv;
	flakePaths: string[];
	profile: string;
	venv?: string;
	description: string;
}

export interface EnvironmentOptions {
	home?: string;
	base?: NodeJS.ProcessEnv;
	system?: string;
	nix?: string;
	run?: typeof capture;
}

export async function exists(file: string): Promise<boolean> {
	try {
		await access(file);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return false;
		}
		throw error;
	}
}

async function executable(file: string): Promise<boolean> {
	try {
		await access(file, constants.X_OK);
		return (await stat(file)).isFile();
	} catch (error) {
		if (['ENOENT', 'EACCES', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) {
			return false;
		}
		throw error;
	}
}

export function exportedEnvironment(json: string): Record<string, string> {
	const parsed: { variables?: Record<string, { type?: string; value?: unknown }> } = JSON.parse(json);
	if (!parsed.variables || typeof parsed.variables !== 'object') {
		throw new Error('Nix did not return an exported environment.');
	}
	return Object.fromEntries(Object.entries(parsed.variables)
		.filter(([, value]) => value?.type === 'exported' && typeof value.value === 'string')
		.map(([key, value]) => [key, value.value as string]));
}

export async function resolveEnvironment(root: string, storage: string, signal: AbortSignal, options: EnvironmentOptions = {}): Promise<ProjectEnvironment> {
	const home = options.home ?? homedir();
	const profile = path.join(home, '.nix-profile', 'bin');
	const cache = path.join(storage, createHash('sha256').update(root).digest('hex'));
	const variables: NodeJS.ProcessEnv = { ...(options.base ?? process.env), HOME: home };
	for (const name of ['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE', 'VIRTUAL_ENV', 'PYTHONHOME', 'PYTHONPATH']) {
		delete variables[name];
	}
	const flakePaths: string[] = [];
	let description = 'Nix profile';
	await mkdir(cache, { recursive: true });
	if (await exists(path.join(root, 'flake.nix'))) {
		const candidates = options.nix ? [options.nix] : [path.join(profile, 'nix'), '/nix/var/nix/profiles/default/bin/nix'];
		let nix: string | undefined;
		for (const candidate of candidates) {
			if (await executable(candidate)) {
				nix = candidate;
				break;
			}
		}
		if (!nix) {
			throw new Error('This project has a flake.nix, but Nix could not be found.');
		}
		const system = options.system ?? `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-darwin`;
		const run = options.run ?? capture;
		const common = ['--extra-experimental-features', 'nix-command flakes', '--option', 'accept-flake-config', 'false', '--no-write-lock-file', '--impure', '--json'];
		const nixEnvironment = { ...variables, XDG_CACHE_HOME: path.join(cache, 'nix'), PAPERLIGHT_PROJECT_ROOT: await realpath(root) };
		const flake = 'builtins.getFlake (builtins.getEnv "PAPERLIGHT_PROJECT_ROOT")';
		const available = await run(nix, ['eval', ...common, '--expr', `let flake = ${flake}; in flake ? devShells.${system}.default`], root, nixEnvironment, signal);
		if (JSON.parse(available) === true) {
			const output = await run(nix, ['print-dev-env', ...common, '--expr', `(${flake}).devShells.${system}.default`], root, nixEnvironment, signal);
			const exported = exportedEnvironment(output);
			flakePaths.push(...(exported.PATH ?? '').split(path.delimiter).filter(path.isAbsolute));
			for (const name of ['HOME', 'TMPDIR', 'TMP', 'TEMP', 'TEMPDIR', 'PWD', 'OLDPWD', 'SHLVL', '_', 'NIX_BUILD_TOP', 'PATH', 'shellHook', 'PAPERLIGHT_PROJECT_ROOT']) {
				delete exported[name];
			}
			Object.assign(variables, exported);
			description = 'Default Nix dev shell; shellHook is not run';
		} else {
			description = 'No default Nix dev shell; using Nix profile';
		}
	}
	variables.PATH = [...new Set([...flakePaths, profile, '/usr/bin', '/bin', '/usr/sbin', '/sbin'])].join(path.delimiter);
	variables.XDG_CACHE_HOME ??= path.join(cache, 'cache');
	variables.XDG_STATE_HOME ??= path.join(cache, 'state');
	variables.TMPDIR = path.join(cache, 'tmp');
	await mkdir(variables.TMPDIR, { recursive: true });
	const venv = await exists(path.join(root, '.venv', 'pyvenv.cfg')) ? path.join(root, '.venv') : undefined;
	signal.throwIfAborted();
	return { root, cache, variables, flakePaths, profile, venv, description };
}

export async function resolveTool(environment: ProjectEnvironment, name: string | readonly string[], python = false): Promise<ResolvedTool | undefined> {
	const names = typeof name === 'string' ? [name] : name;
	if (names.some(name => path.basename(name) !== name || !name)) {
		throw new Error('Tool names must not contain a path.');
	}
	const directories: { directory: string; source: ToolSource }[] = [
		...(python && environment.venv ? [{ directory: path.join(environment.venv, 'bin'), source: 'venv' as const }] : []),
		...environment.flakePaths.map(directory => ({ directory, source: 'flake' as const })),
		{ directory: environment.profile, source: 'profile' }
	];
	for (const { directory, source } of directories) {
		for (const name of names) {
			const candidate = path.join(directory, name);
			if (await executable(candidate)) {
				return { path: candidate, source };
			}
		}
	}
	return undefined;
}
