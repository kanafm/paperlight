import type { Launch } from './adapters.ts';

export type ServerState = 'idle' | 'starting' | 'running' | 'stopping' | 'disabled' | 'missing' | 'failed';

export interface ServerDriver {
	readonly pid?: number;
	start(): Promise<void>;
	stop(): Promise<void>;
}

export class LanguageSession {
	state: ServerState = 'idle';
	requested = false;
	enabled = true;
	launch?: Launch;
	error?: string;
	private generation = 0;
	private driver?: ServerDriver;
	private stopping: Promise<void> = Promise.resolve();
	private readonly prepare: () => Promise<Launch | undefined>;
	private readonly create: (launch: Launch, exited: (message: string) => void) => ServerDriver;
	private readonly changed: () => void;

	constructor(prepare: () => Promise<Launch | undefined>, create: (launch: Launch, exited: (message: string) => void) => ServerDriver, changed: () => void) {
		this.prepare = prepare;
		this.create = create;
		this.changed = changed;
	}

	get pid(): number | undefined {
		return this.driver?.pid;
	}

	async start(): Promise<void> {
		this.requested = true;
		if (!this.enabled || !['idle', 'disabled'].includes(this.state)) {
			return;
		}
		const generation = ++this.generation;
		this.state = 'starting';
		this.error = undefined;
		this.launch = undefined;
		this.changed();
		try {
			await this.stopping;
			const launch = await this.prepare();
			if (generation !== this.generation) {
				return;
			}
			this.launch = launch;
			if (!launch) {
				this.state = 'missing';
				return;
			}
			const driver = this.create(launch, message => {
				if (generation === this.generation) {
					++this.generation;
					this.state = 'failed';
					this.error = message;
					this.driver = undefined;
					this.stopping = this.cleanup(driver);
					this.changed();
				}
			});
			this.driver = driver;
			await driver.start();
			if (generation === this.generation) {
				this.state = 'running';
			}
		} catch (error) {
			if (generation === this.generation) {
				this.state = 'failed';
				this.error = error instanceof Error ? error.message : String(error);
				const driver = this.driver;
				this.driver = undefined;
				++this.generation;
				this.stopping = this.cleanup(driver);
			}
		} finally {
			this.changed();
		}
	}

	async stop(disable = false): Promise<void> {
		const generation = ++this.generation;
		if (disable) {
			this.enabled = false;
		}
		const driver = this.driver;
		this.driver = undefined;
		this.state = 'stopping';
		this.changed();
		this.stopping = Promise.all([this.stopping, this.cleanup(driver)]).then(() => {});
		await this.stopping;
		if (generation === this.generation) {
			this.state = this.enabled ? 'idle' : 'disabled';
		}
		this.changed();
	}

	async restart(): Promise<void> {
		this.enabled = true;
		await this.stop();
		await this.start();
	}

	private async cleanup(driver?: ServerDriver): Promise<void> {
		try {
			await driver?.stop();
		} catch (error) {
			this.error = error instanceof Error ? error.message : String(error);
			this.changed();
		}
	}
}
