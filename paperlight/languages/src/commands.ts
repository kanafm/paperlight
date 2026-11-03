import * as vscode from 'vscode';
import { LanguageClient, ExecuteCommandRequest, type DynamicFeature, type ExecuteCommandRegistrationOptions, type RegistrationData, type ClientCapabilities, type ServerCapabilities, type FeatureState } from 'vscode-languageclient/node';

let sequence = 0;

export function mapCommands(value: unknown, translate: (command: string) => string): void {
	if (!value || typeof value !== 'object') { return; }
	if (Array.isArray(value)) {
		for (const item of value) { mapCommands(item, translate); }
		return;
	}
	const object = value as Record<string, unknown>;
	if (typeof object.command === 'string' && typeof object.title === 'string') {
		object.command = translate(object.command);
	}
	for (const [key, child] of Object.entries(object)) {
		if (key !== 'data' && key !== 'arguments') { mapCommands(child, translate); }
	}
}

class ProjectCommands implements DynamicFeature<ExecuteCommandRegistrationOptions> {
	readonly registrationType = ExecuteCommandRequest.type;
	private readonly prefix = `paperlight.lsp.${++sequence}.`;
	private readonly registrations = new Map<string, string[]>();
	private readonly commands = new Map<string, { references: number; disposable: vscode.Disposable }>();

	constructor(private readonly client: LanguageClient) {}

	getState(): FeatureState {
		return { kind: 'workspace', id: this.registrationType.method, registrations: this.registrations.size > 0 };
	}

	fillClientCapabilities(capabilities: ClientCapabilities): void {
		capabilities.workspace ??= {};
		capabilities.workspace.executeCommand = { dynamicRegistration: true };
	}

	initialize(capabilities: ServerCapabilities): void {
		if (capabilities.executeCommandProvider) {
			this.register({ id: 'initial', registerOptions: capabilities.executeCommandProvider });
		}
	}

	register(data: RegistrationData<ExecuteCommandRegistrationOptions>): void {
		this.unregister(data.id);
		const names = [...new Set(data.registerOptions.commands)];
		for (const name of names) {
			const registered = this.commands.get(name);
			if (registered) {
				registered.references++;
			} else {
				const disposable = vscode.commands.registerCommand(this.prefix + name, (...args: unknown[]) => this.client.sendRequest(ExecuteCommandRequest.type, { command: name, arguments: args }));
				this.commands.set(name, { references: 1, disposable });
			}
		}
		this.registrations.set(data.id, names);
	}

	unregister(id: string): void {
		for (const name of this.registrations.get(id) ?? []) {
			const registered = this.commands.get(name);
			if (registered && --registered.references === 0) {
				registered.disposable.dispose();
				this.commands.delete(name);
			}
		}
		this.registrations.delete(id);
	}

	clear(): void {
		for (const id of this.registrations.keys()) { this.unregister(id); }
	}

	toEditor(value: unknown): void {
		mapCommands(value, name => this.commands.has(name) ? this.prefix + name : name);
	}

	toServer(value: unknown): void {
		mapCommands(value, name => name.startsWith(this.prefix) ? name.slice(this.prefix.length) : name);
	}
}

export class ScopedLanguageClient extends LanguageClient {
	declare projectCommands: ProjectCommands;

	override registerFeature(feature: Parameters<LanguageClient['registerFeature']>[0]): void {
		if ('registrationType' in feature && feature.registrationType.method === ExecuteCommandRequest.method) {
			this.projectCommands = new ProjectCommands(this);
			super.registerFeature(this.projectCommands);
		} else {
			super.registerFeature(feature);
		}
	}
}
