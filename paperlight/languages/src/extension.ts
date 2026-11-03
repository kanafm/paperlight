import * as vscode from 'vscode';
import { adapters, prepareLaunch, type Adapter } from './adapters.ts';
import { resolveEnvironment, type ProjectEnvironment } from './environment.ts';
import { ProjectClient } from './client.ts';
import { LanguageSession } from './session.ts';
import { processSnapshot, processTreeMemory, type ProcessInfo } from './processes.ts';

class Server {
	readonly session: LanguageSession;
	readonly output: vscode.LogOutputChannel;

	constructor(readonly project: Project, readonly adapter: Adapter, changed: () => void) {
		this.output = vscode.window.createOutputChannel(`${project.folder.name}: ${adapter.name}`, { log: true });
		this.session = new LanguageSession(async () => prepareLaunch(adapter, await project.environment()),
			(launch, exited) => {
				this.output.info(vscode.l10n.t('Starting {0} from {1}', adapter.command, launch.tool.path));
				return new ProjectClient(project.folder, adapter, launch, this.output, exited);
			}, changed);
	}
}

class Project {
	readonly servers: Server[];
	description = vscode.l10n.t('Environment not yet resolved');
	private controller = new AbortController();
	private resolved?: Promise<ProjectEnvironment>;
	private operations = Promise.resolve();
	private closed = false;
	private refreshing = false;

	constructor(readonly folder: vscode.WorkspaceFolder, private readonly storage: string, private readonly changed: () => void) {
		this.servers = adapters.map(adapter => new Server(this, adapter, changed));
	}

	environment(): Promise<ProjectEnvironment> {
		if (!vscode.workspace.isTrusted || this.closed) {
			return Promise.reject(new Error(vscode.l10n.t('Workspace trust is required to start project tools.')));
		}
		return this.resolved ??= resolveEnvironment(this.folder.uri.fsPath, this.storage, this.controller.signal).then(environment => {
			this.description = environment.description;
			this.changed();
			return environment;
		});
	}

	run(operation: () => Promise<void>): Promise<void> {
		const result = this.operations.then(async () => { if (!this.closed) { await operation(); } });
		this.operations = result.catch(error => { void vscode.window.showErrorMessage(String(error)); });
		return this.operations;
	}

	async refresh(): Promise<void> {
		this.refreshing = true;
		this.controller.abort();
		await Promise.all(this.servers.map(server => server.session.stop()));
		this.controller = new AbortController();
		this.resolved = undefined;
		this.description = vscode.l10n.t('Environment not yet resolved');
		this.refreshing = false;
		if (this.closed) { return; }
		await Promise.all(this.servers.filter(server => server.session.requested && server.session.enabled).map(server => server.session.start()));
		this.changed();
	}

	open(server: Server): void {
		server.session.requested = true;
		if (!this.refreshing && !this.closed) { void server.session.start(); }
	}

	async enable(server: Server): Promise<void> {
		if (this.closed) { return; }
		server.session.enabled = true;
		server.session.requested = true;
		if (!this.refreshing) { await server.session.restart(); }
	}

	async dispose(): Promise<void> {
		this.closed = true;
		this.controller.abort();
		await Promise.all(this.servers.map(server => server.session.stop()));
		await this.operations;
		for (const server of this.servers) {
			server.output.dispose();
		}
	}
}

type Entry = Project | Server | { text: string };

class ProjectTools implements vscode.TreeDataProvider<Entry> {
	readonly changed = new vscode.EventEmitter<Entry | undefined>();
	readonly onDidChangeTreeData = this.changed.event;
	private readonly projects = new Map<string, Project>();
	private snapshot?: ProcessInfo[];
	private sampling = false;
	private disposed = false;
	private readonly timer: NodeJS.Timeout;
	private readonly disposables: vscode.Disposable[] = [];

	constructor(private readonly context: vscode.ExtensionContext) {
		this.disposables.push(vscode.window.createTreeView('paperlight.tools', { treeDataProvider: this }));
		this.disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(() => { void this.update(); }));
		this.disposables.push(vscode.workspace.onDidOpenTextDocument(document => this.open(document)));
		this.disposables.push(vscode.workspace.onDidGrantWorkspaceTrust(() => {
			for (const document of vscode.workspace.textDocuments) { this.open(document); }
			this.changed.fire(undefined);
		}));
		for (const action of ['enable', 'disable', 'restart', 'refresh', 'logs']) {
			this.disposables.push(vscode.commands.registerCommand(`paperlight.tools.${action}`, (entry?: Entry) => this.command(action, entry)));
		}
		this.timer = setInterval(() => { void this.sample(); }, 5000);
		void this.update();
	}

	private async update(): Promise<void> {
		if (this.disposed) { return; }
		const folders = (vscode.workspace.workspaceFolders ?? []).filter(folder => folder.uri.scheme === 'file');
		const previous = [...this.projects.values()].map(project => project.folder);
		const changed = [...previous.filter(folder => !folders.some(current => current.uri.toString() === folder.uri.toString())), ...folders.filter(folder => !previous.some(current => current.uri.toString() === folder.uri.toString()))];
		const removed: Promise<void>[] = [];
		for (const [key, project] of this.projects) {
			if (!folders.some(folder => folder.uri.toString() === key)) {
				this.projects.delete(key);
				removed.push(project.dispose());
			}
		}
		for (const folder of folders) {
			if (!this.projects.has(folder.uri.toString())) {
				this.projects.set(folder.uri.toString(), new Project(folder, this.context.globalStorageUri.fsPath, () => this.changed.fire(undefined)));
			}
		}
		for (const project of this.projects.values()) {
			if (previous.includes(project.folder) && changed.some(folder => folder.uri.toString().startsWith(`${project.folder.uri}/`))) {
				void project.run(() => project.refresh());
			}
		}
		for (const document of vscode.workspace.textDocuments) { this.open(document); }
		this.changed.fire(undefined);
		await Promise.all(removed);
	}

	private open(document: vscode.TextDocument): void {
		if (!vscode.workspace.isTrusted || document.uri.scheme !== 'file' || this.disposed) { return; }
		const folder = vscode.workspace.getWorkspaceFolder(document.uri);
		const project = folder && this.projects.get(folder.uri.toString());
		const server = project?.servers.find(server => (server.adapter.languages as readonly string[]).includes(document.languageId));
		if (server) { project?.open(server); }
	}

	private async command(action: string, entry?: Entry): Promise<void> {
		if (!entry) {
			const choices = [...this.projects.values()].flatMap(project => action === 'refresh'
				? [{ label: project.folder.name, entry: project as Entry }]
				: project.servers.map(server => ({ label: `${project.folder.name}: ${server.adapter.name}`, entry: server as Entry })));
			entry = (await vscode.window.showQuickPick(choices, { title: vscode.l10n.t('Project Tools') }))?.entry;
		}
		if (entry instanceof Project && action === 'refresh') {
			const project = entry;
			await project.run(() => project.refresh());
		} else if (entry instanceof Server) {
			const server = entry;
			if (action === 'logs') { server.output.show(); return; }
			if (action === 'disable') {
				await server.session.stop(true);
			} else if (action === 'enable' || action === 'restart') {
				await server.project.enable(server);
			}
		}
	}

	private async sample(): Promise<void> {
		if (this.sampling || this.disposed) { return; }
		this.sampling = true;
		try {
			this.snapshot = await processSnapshot();
		} catch {
			this.snapshot = undefined;
		} finally {
			this.sampling = false;
			if (!this.disposed) { this.changed.fire(undefined); }
		}
	}

	private memory(servers: Server[]): string {
		const pids = servers.flatMap(server => server.session.pid ? [server.session.pid] : []);
		return this.snapshot ? vscode.l10n.t('{0} MiB LSP', (processTreeMemory(pids, this.snapshot) / 1024 / 1024).toFixed(1)) : vscode.l10n.t('LSP memory pending');
	}

	getTreeItem(entry: Entry): vscode.TreeItem {
		if (entry instanceof Project) {
			const item = new vscode.TreeItem(entry.folder.name, vscode.TreeItemCollapsibleState.Expanded);
			item.id = entry.folder.uri.toString();
			item.contextValue = 'project';
			item.description = vscode.workspace.isTrusted ? this.memory(entry.servers) : vscode.l10n.t('Workspace trust required');
			item.tooltip = `${entry.folder.uri.fsPath}\n${entry.description}\n${vscode.l10n.t('LSP memory sums resident memory of language servers and their child processes; shared pages may be counted more than once.')}`;
			item.iconPath = new vscode.ThemeIcon('folder');
			return item;
		}
		if (entry instanceof Server) {
			const item = new vscode.TreeItem(entry.adapter.name, vscode.TreeItemCollapsibleState.Collapsed);
			item.id = `${entry.project.folder.uri}/${entry.adapter.id}`;
			item.contextValue = `server:${entry.session.state}`;
			item.description = `${entry.session.state}${entry.session.pid ? ` · ${this.memory([entry])}` : ''}`;
			item.iconPath = new vscode.ThemeIcon(entry.session.state === 'running' ? 'pass' : ['failed', 'missing'].includes(entry.session.state) ? 'warning' : 'circle-outline');
			item.tooltip = entry.session.error ?? entry.session.launch?.tool.path ?? entry.adapter.command;
			return item;
		}
		const item = new vscode.TreeItem(entry.text);
		item.tooltip = entry.text;
		return item;
	}

	getChildren(entry?: Entry): Entry[] {
		if (!entry) { return [...this.projects.values()]; }
		if (entry instanceof Project) { return entry.servers; }
		if (entry instanceof Server) {
			return [
				{ text: entry.project.description },
				{ text: entry.session.launch ? `${entry.session.launch.tool.source}: ${entry.session.launch.tool.path}` : vscode.l10n.t('Tool: {0}', entry.adapter.command) },
				...(entry.session.error ? [{ text: entry.session.error }] : []),
				...(entry.session.state === 'missing' ? [{ text: vscode.l10n.t('Not found in the project environment or Nix profile. Refresh the environment after installing it.') }] : [])
			];
		}
		return [];
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		clearInterval(this.timer);
		for (const disposable of this.disposables) { disposable.dispose(); }
		await Promise.all([...this.projects.values()].map(project => project.dispose()));
		this.projects.clear();
		this.changed.dispose();
	}
}

let tools: ProjectTools | undefined;

export function activate(context: vscode.ExtensionContext): void {
	tools = new ProjectTools(context);
}

export async function deactivate(): Promise<void> {
	await tools?.dispose();
	tools = undefined;
}
