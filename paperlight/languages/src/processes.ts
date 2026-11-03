import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const execute = promisify(execFile);

export interface ProcessInfo {
	pid: number;
	parent: number;
	group: number;
	rss: number;
}

export async function processSnapshot(): Promise<ProcessInfo[]> {
	const { stdout } = await execute('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,rss='], { timeout: 2000, maxBuffer: 4 * 1024 * 1024 });
	return stdout.trim().split('\n').map(line => {
		const [pid, parent, group, rss] = line.trim().split(/\s+/).map(Number);
		return { pid, parent, group, rss: rss * 1024 };
	}).filter(row => [row.pid, row.parent, row.group, row.rss].every(Number.isFinite));
}

export function processTreeMemory(roots: readonly number[], snapshot: readonly ProcessInfo[]): number {
	const included = new Set(roots);
	let changed = true;
	while (changed) {
		changed = false;
		for (const row of snapshot) {
			if (!included.has(row.pid) && (included.has(row.parent) || roots.includes(row.group))) {
				included.add(row.pid);
				changed = true;
			}
		}
	}
	return snapshot.reduce((total, row) => total + (included.has(row.pid) ? row.rss : 0), 0);
}

export class ProcessGroup {
	readonly child: ChildProcessWithoutNullStreams;
	readonly ready: Promise<void>;
	private stopping?: Promise<void>;

	constructor(command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv) {
		this.child = spawn(command, [...args], { cwd, env, detached: true, stdio: 'pipe' });
		this.ready = new Promise((resolve, reject) => {
			this.child.once('spawn', resolve);
			this.child.once('error', reject);
		});
	}

	stop(): Promise<void> {
		return this.stopping ??= this.terminate();
	}

	private async terminate(): Promise<void> {
		try {
			await this.ready;
		} catch {
			return;
		}
		const pid = this.child.pid;
		if (!pid) {
			return;
		}
		const signal = (value: NodeJS.Signals | 0): boolean => {
			try {
				process.kill(-pid, value);
				return true;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
					throw error;
				}
				return false;
			}
		};
		if (!signal('SIGTERM')) {
			return;
		}
		for (let attempt = 0; attempt < 20; attempt++) {
			await delay(50);
			if (!signal(0)) {
				return;
			}
		}
		signal('SIGKILL');
	}
}

export async function capture(command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv, signal: AbortSignal): Promise<string> {
	signal.throwIfAborted();
	const group = new ProcessGroup(command, args, cwd, env);
	let output = '';
	let errorOutput = '';
	let failure: Error | undefined;
	const abort = () => { void group.stop(); };
	signal.addEventListener('abort', abort, { once: true });
	const timeout = setTimeout(() => {
		failure = new Error('Project environment evaluation timed out.');
		abort();
	}, 120_000);
	try {
		await new Promise<void>((resolve, reject) => {
			group.child.stdout.on('data', (chunk: Buffer) => {
				output += chunk.toString();
				if (output.length > 16 * 1024 * 1024) {
					failure = new Error('Project environment output exceeds the size limit.');
					abort();
				}
			});
			group.child.stderr.on('data', (chunk: Buffer) => { errorOutput = (errorOutput + chunk.toString()).slice(-16_384); });
			group.child.once('error', reject);
			group.child.once('close', code => code === 0 ? resolve() : reject(new Error(errorOutput.trim() || `Environment command exited with status ${code}.`)));
			void group.ready.catch(reject);
		});
		signal.throwIfAborted();
		if (failure) {
			throw failure;
		}
		return output;
	} catch (error) {
		signal.throwIfAborted();
		throw failure ?? error;
	} finally {
		clearTimeout(timeout);
		signal.removeEventListener('abort', abort);
		await group.stop();
	}
}
