import * as vscode from 'vscode';
import { CloseAction, ErrorAction, RevealOutputChannelOn, ResponseError, LSPErrorCodes } from 'vscode-languageclient/node';
import type { Adapter, Launch } from './adapters.ts';
import { configurationValue } from './adapters.ts';
import { documentUri } from './ownership.ts';
import { ScopedLanguageClient } from './commands.ts';
import { ProcessGroup } from './processes.ts';
import type { ServerDriver } from './session.ts';

export class ProjectClient implements ServerDriver {
	private group?: ProcessGroup;
	private readonly client: ScopedLanguageClient;
	private stopping = false;
	private stopped?: Promise<void>;

	constructor(folder: vscode.WorkspaceFolder, adapter: Adapter, launch: Launch, output: vscode.LogOutputChannel, exited: (message: string) => void) {
		const owns = (uri: vscode.Uri) => vscode.workspace.getWorkspaceFolder(uri)?.uri.toString() === folder.uri.toString();
		const accepts = (params: unknown) => {
			const uri = documentUri(params);
			return uri === undefined || owns(vscode.Uri.parse(uri));
		};
		this.client = new ScopedLanguageClient(`paperlight.${adapter.id}.${folder.index}`, adapter.name, async () => {
			if (this.stopping) {
				throw new Error('Language server startup was cancelled.');
			}
			const group = this.group = new ProcessGroup(launch.tool.path, launch.args, launch.cwd, launch.env);
			group.child.stderr.on('data', (chunk: Buffer) => output.append(chunk.toString()));
			group.child.once('exit', (code, signal) => {
				if (!this.stopping) {
					exited(vscode.l10n.t('Language server exited ({0}).', signal ?? String(code)));
				}
			});
			await group.ready;
			return { reader: group.child.stdout, writer: group.child.stdin, detached: true };
		}, {
			workspaceFolder: folder,
			documentSelector: adapter.languages.map(language => ({ language, scheme: 'file', pattern: { baseUri: folder.uri.toString(), pattern: '**/*' } })),
			outputChannel: output,
			revealOutputChannelOn: RevealOutputChannelOn.Never,
			diagnosticCollectionName: `paperlight.${adapter.id}.${folder.index}`,
			diagnosticPullOptions: { filter: document => !owns(document.uri) },
			initializationOptions: launch.initializationOptions,
			initializationFailedHandler: () => false,
			errorHandler: {
				error: () => ({ action: ErrorAction.Shutdown }),
				closed: () => {
					if (!this.stopping) {
						exited(vscode.l10n.t('Language server connection closed.'));
					}
					return { action: CloseAction.DoNotRestart };
				}
			},
			middleware: {
				sendRequest: async (type, params, token, next) => {
					if (!accepts(params)) { throw new ResponseError(LSPErrorCodes.RequestCancelled, 'Document belongs to another project.'); }
					this.client.projectCommands.toServer(params);
					const result = await next(type, params, token);
					this.client.projectCommands.toEditor(result);
					return result;
				},
				sendNotification: (type, next, params) => accepts(params) ? next(type, params) : Promise.resolve(),
				didOpen: (document, next) => owns(document.uri) ? next(document) : Promise.resolve(),
				didChange: (event, next) => owns(event.document.uri) ? next(event) : Promise.resolve(),
				didSave: (document, next) => owns(document.uri) ? next(document) : Promise.resolve(),
				didClose: (document, next) => owns(document.uri) ? next(document) : Promise.resolve(),
				handleDiagnostics: (uri, diagnostics, next) => { if (owns(uri)) { next(uri, diagnostics); } },
				provideDiagnostics: async (document, previous, token, next) => {
					if (!owns(document instanceof vscode.Uri ? document : document.uri)) { return undefined; }
					const report = await next(document, previous, token);
					if (report?.relatedDocuments) {
						report.relatedDocuments = Object.fromEntries(Object.entries(report.relatedDocuments).filter(([uri]) => owns(vscode.Uri.parse(uri))));
					}
					return report;
				},
				provideWorkspaceDiagnostics: async (previous, token, report, next) => {
					const result = await next(previous.filter(item => owns(item.uri)), token, chunk => report(chunk && { items: chunk.items.filter(item => owns(item.uri)) }));
					return result && { items: result.items.filter(item => owns(item.uri)) };
				},
				workspace: {
					didChangeWatchedFile: (event, next) => owns(vscode.Uri.parse(event.uri)) ? next(event) : Promise.resolve(),
					configuration: async params => params.items.map(item => item.scopeUri && !owns(vscode.Uri.parse(item.scopeUri)) ? null : configurationValue(launch.settings, item.section))
				}
			}
		});
	}

	get pid(): number | undefined {
		return this.group?.child.pid;
	}

	async start(): Promise<void> {
		let timer: NodeJS.Timeout | undefined;
		try {
			await Promise.race([
				this.client.start(),
				new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Language server initialization timed out.')), 30_000); })
			]);
		} finally {
			clearTimeout(timer);
		}
	}

	stop(): Promise<void> {
		this.stopping = true;
		return this.stopped ??= this.dispose();
	}

	private async dispose(): Promise<void> {
		try {
			await this.client.dispose(2000);
		} finally {
			await this.group?.stop();
		}
	}
}
