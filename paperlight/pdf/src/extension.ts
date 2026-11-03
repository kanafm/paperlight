import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { externalLink, readState, type ViewState } from './state.ts';

function escape(value: string): string {
	return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

export function activate(context: vscode.ExtensionContext): void {
	context.subscriptions.push(vscode.window.registerCustomEditorProvider('paperlight.pdf', {
		openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
			return { uri, dispose() {} };
		},
		resolveCustomEditor(document: vscode.CustomDocument, panel: vscode.WebviewPanel): void {
			const resources = vscode.Uri.joinPath(context.extensionUri, 'dist');
			panel.webview.options = { enableScripts: true, localResourceRoots: [resources, vscode.Uri.joinPath(document.uri, '..')] };
			const resource = (path: string) => panel.webview.asWebviewUri(vscode.Uri.joinPath(resources, path)).toString();
			let state: ViewState | undefined;
			let timer: ReturnType<typeof setTimeout> | undefined;
			let disposed = false;
			let passwordRequest = 0;
			const load = () => panel.webview.postMessage({ type: 'load', url: panel.webview.asWebviewUri(document.uri.with({ query: `version=${Date.now()}` })).toString(), state });
			const subscriptions: vscode.Disposable[] = [];
			const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.joinPath(document.uri, '..'), '*'));
			subscriptions.push(watcher);
			const reload = (uri: vscode.Uri) => {
				if (uri.toString() !== document.uri.toString()) { return; }
				clearTimeout(timer);
				timer = setTimeout(() => { if (!disposed && panel.visible) { void load(); } }, 150);
			};
			subscriptions.push(watcher.onDidChange(reload), watcher.onDidCreate(reload), watcher.onDidDelete(reload));
			subscriptions.push(panel.webview.onDidReceiveMessage(async message => {
				if (message?.type === 'ready') { await load(); }
				else if (message?.type === 'state') { state = readState(message.state) ?? state; }
				else if (message?.type === 'link') {
					const link = externalLink(message.url);
					if (link) { await vscode.env.openExternal(vscode.Uri.parse(link)); }
				} else if (message?.type === 'password') {
					const request = ++passwordRequest;
					const password = await vscode.window.showInputBox({ title: vscode.l10n.t('PDF Password'), prompt: vscode.l10n.t('Enter the password for this PDF.'), password: true, ignoreFocusOut: true });
					if (!disposed && request === passwordRequest) { await panel.webview.postMessage({ type: 'password', password }); }
				}
			}));
			subscriptions.push(panel.onDidDispose(() => {
				disposed = true;
				clearTimeout(timer);
				for (const subscription of subscriptions) { subscription.dispose(); }
			}));
			const nonce = randomBytes(18).toString('base64');
			const labels = {
				previous: vscode.l10n.t('Previous Page'), next: vscode.l10n.t('Next Page'), page: vscode.l10n.t('Page'),
				zoomOut: vscode.l10n.t('Zoom Out'), zoomIn: vscode.l10n.t('Zoom In'), zoom: vscode.l10n.t('Zoom'),
				fitWidth: vscode.l10n.t('Fit Width'), fitPage: vscode.l10n.t('Fit Page'), find: vscode.l10n.t('Find in PDF'),
				previousMatch: vscode.l10n.t('Previous Match'), nextMatch: vscode.l10n.t('Next Match'), closeFind: vscode.l10n.t('Close Find'),
				loading: vscode.l10n.t('Loading PDF…'), error: vscode.l10n.t('Unable to open this PDF.'),
				passwordCancelled: vscode.l10n.t('PDF password entry was cancelled.'), noMatches: vscode.l10n.t('No matches'),
				matchCount: vscode.l10n.t('{0} of {1}', '{0}', '{1}'), document: vscode.l10n.t('PDF Document')
			};
			const button = (id: string, label: string, content: string) => `<button id="${id}" type="button" title="${escape(label)}" aria-label="${escape(label)}">${content}</button>`;
			const config = escape(JSON.stringify({ assets: resource('pdf/'), labels }));
			panel.webview.html = `<!DOCTYPE html>
<html lang="${escape(vscode.env.language)}"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${panel.webview.cspSource} blob: data:; font-src ${panel.webview.cspSource} blob:; style-src ${panel.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${panel.webview.cspSource} 'wasm-unsafe-eval'; worker-src ${panel.webview.cspSource} blob:; connect-src ${panel.webview.cspSource};">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${resource('pdf/web/pdf_viewer.css')}"><link rel="stylesheet" href="${resource('viewer.css')}"></head>
<body data-config="${config}">
<div id="toolbar" role="toolbar" aria-label="PDF">
<div class="controls">${button('previous', labels.previous, '‹')}<input id="page" type="number" min="1" value="1" aria-label="${escape(labels.page)}"><span id="total">/ —</span>${button('next', labels.next, '›')}</div>
<div class="controls">${button('zoomOut', labels.zoomOut, '−')}<select id="zoom" aria-label="${escape(labels.zoom)}"><option value="page-width">${escape(labels.fitWidth)}</option><option value="page-fit">${escape(labels.fitPage)}</option>${[50, 75, 100, 125, 150, 200, 300, 400].map(value => `<option value="${value / 100}">${value}%</option>`).join('')}<option id="customZoom" hidden></option></select>${button('zoomIn', labels.zoomIn, '+')}</div>
${button('find', labels.find, escape(vscode.l10n.t('Find')))}
</div>
<div id="findbar" hidden><input id="query" type="search" aria-label="${escape(labels.find)}" placeholder="${escape(labels.find)}"><span id="matches" role="status"></span>${button('previousMatch', labels.previousMatch, '‹')}${button('nextMatch', labels.nextMatch, '›')}${button('closeFind', labels.closeFind, '×')}</div>
<div id="document"><div id="viewerContainer" tabindex="0" aria-label="${escape(labels.document)}"><div id="viewer" class="pdfViewer"></div></div>
<div id="message" role="status">${escape(labels.loading)}</div></div>
<script nonce="${nonce}" type="module" src="${resource('viewer.js')}"></script></body></html>`;
		}
	}, { supportsMultipleEditorsPerDocument: true }));
}
