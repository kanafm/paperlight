import path from 'node:path';
import { resolveTool, type ProjectEnvironment, type ResolvedTool } from './environment.ts';

export const adapters = [
	{ id: 'cpp', name: 'C/C++', languages: ['c', 'cpp'], command: 'clangd' },
	{ id: 'go', name: 'Go', languages: ['go', 'go.mod', 'go.sum'], command: 'gopls' },
	{ id: 'rust', name: 'Rust', languages: ['rust'], command: 'rust-analyzer' },
	{ id: 'python', name: 'Python', languages: ['python'], command: 'pyright-langserver' }
] as const;

export type Adapter = typeof adapters[number];

export interface Launch {
	tool: ResolvedTool;
	args: string[];
	env: NodeJS.ProcessEnv;
	cwd: string;
	settings: Record<string, unknown>;
	initializationOptions: Record<string, unknown>;
}

export async function prepareLaunch(adapter: Adapter, environment: ProjectEnvironment): Promise<Launch | undefined> {
	const tool = await resolveTool(environment, adapter.command, adapter.id === 'python');
	if (!tool) {
		return undefined;
	}
	const env = { ...environment.variables };
	const launch: Launch = { tool, args: [], env, cwd: environment.root, settings: {}, initializationOptions: {} };
	if (adapter.id === 'python') {
		const python = await resolveTool(environment, ['python', 'python3'], true);
		if (!python) {
			throw new Error('Python was not found in the project environment or Nix profile.');
		}
		if (environment.venv) {
			env.VIRTUAL_ENV = environment.venv;
			env.PATH = `${path.join(environment.venv, 'bin')}${path.delimiter}${env.PATH}`;
			delete env.PYTHONHOME;
		}
		launch.args = ['--stdio'];
		launch.settings = { python: { pythonPath: python.path, analysis: { autoSearchPaths: true, diagnosticMode: 'workspace' } } };
	} else if (adapter.id === 'go') {
		env.GOCACHE ??= path.join(environment.cache, 'go-build');
		env.GOMODCACHE ??= path.join(environment.cache, 'go-modules');
		env.GOPLSCACHE ??= path.join(environment.cache, 'gopls');
		env.GOTOOLCHAIN ??= 'local';
	} else if (adapter.id === 'rust') {
		env.CARGO_TARGET_DIR ??= path.join(environment.cache, 'rust-target');
	} else {
		const compilers = await Promise.all(['clang', 'clang++', 'gcc', 'g++'].map(name => resolveTool(environment, name)));
		const paths = compilers.flatMap(compiler => compiler ? [compiler.path] : []);
		if (paths.length) {
			launch.args.push(`--query-driver=${paths.join(',')}`);
		}
	}
	return launch;
}

export function configurationValue(settings: Record<string, unknown>, section?: string): unknown {
	let value: unknown = settings;
	for (const key of section?.split('.') ?? []) {
		value = value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
	}
	return value ?? null;
}
