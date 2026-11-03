import assert from 'node:assert/strict';
import * as vscode from 'vscode';

async function until<T>(read: () => T | PromiseLike<T>, ready: (value: T) => boolean, label: string): Promise<T> {
	const deadline = Date.now() + 90_000;
	while (Date.now() < deadline) {
		const value = await read();
		if (ready(value)) { return value; }
		await new Promise(resolve => setTimeout(resolve, 500));
	}
	throw new Error(`Timed out waiting for ${label}`);
}

export async function run(): Promise<void> {
	const extension = vscode.extensions.getExtension('paperlight.paperlight-languages');
	assert.ok(extension, 'Paperlight language extension must be installed');
	await extension.activate();
	const folders = vscode.workspace.workspaceFolders;
	assert.ok(folders && folders.length === 2, 'Open the parent and nested test projects');
	for (const folder of folders) {
		for (const file of ['main.c', 'main.go', 'src/main.rs', 'main.py']) {
			const uri = vscode.Uri.joinPath(folder.uri, file);
			const document = await vscode.workspace.openTextDocument(uri);
			await vscode.window.showTextDocument(document);
			await until(() => vscode.languages.getDiagnostics(uri), diagnostics => diagnostics.some(diagnostic => diagnostic.severity === vscode.DiagnosticSeverity.Error), `${folder.name}/${file} diagnostics`);
			const offset = document.getText().lastIndexOf('greet') + 2;
			assert.ok(offset > 1);
			const definitions = await until(() => vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>('vscode.executeDefinitionProvider', uri, document.positionAt(offset)), value => !!value?.length, `${folder.name}/${file} definition`);
			assert.ok(definitions.some(value => ('uri' in value ? value.uri : value.targetUri).toString() === uri.toString()));
			const completions = await until(() => vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', uri, document.positionAt(offset)), value => !!value?.items.some(item => (typeof item.label === 'string' ? item.label : item.label.label).includes('greet')), `${folder.name}/${file} completion`);
			assert.ok(completions.items.length);
			console.log(`PASS ${folder.name}/${file}: diagnostics, definition, completion`);
		}
	}
	const commands = await vscode.commands.getCommands(true);
	assert.equal(commands.filter(command => command.startsWith('paperlight.lsp.') && command.endsWith('.clangd.applyFix')).length, 2);
	console.log('PASS project-scoped server commands');
}
