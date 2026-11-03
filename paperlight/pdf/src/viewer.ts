import { AnnotationMode, getDocument, GlobalWorkerOptions, type PDFDocumentLoadingTask } from 'pdfjs-dist';
import { EventBus, PDFFindController, PDFLinkService, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
import { readState, type ViewState } from './state.ts';

declare function acquireVsCodeApi(): { postMessage(message: object): void };
const host = acquireVsCodeApi();
const config: { assets: string; labels: Record<string, string> } = JSON.parse(document.body.dataset.config!);
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const container = element<HTMLDivElement>('viewerContainer');
const page = element<HTMLInputElement>('page');
const zoom = element<HTMLSelectElement>('zoom');
const query = element<HTMLInputElement>('query');
const message = element<HTMLDivElement>('message');
const findbar = element<HTMLDivElement>('findbar');
const eventBus = new EventBus();
const links = new PDFLinkService({ eventBus });
links.addLinkAttributes = (anchor, url) => {
	anchor.href = url;
	anchor.rel = 'noopener noreferrer';
	anchor.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); host.postMessage({ type: 'link', url }); });
};
const find = new PDFFindController({ eventBus, linkService: links });
const viewer = new PDFViewer({ container, eventBus, linkService: links, findController: find, annotationMode: AnnotationMode.ENABLE, imageResourcesPath: `${config.assets}web/images/`, maxCanvasPixels: 8_388_608 });
links.setViewer(viewer);
let worker: Worker | undefined;
let workerUrl: string | undefined;
let task: PDFDocumentLoadingTask | undefined;
let generation = 0;
let restoring = false;
let saved: ViewState | undefined;
let password: ((value: string) => void) | undefined;
let active = false;

function showMessage(text: string): void {
	message.textContent = text;
	message.hidden = !text;
}

function save(): void {
	if (!active || restoring) { return; }
	saved = { page: viewer.currentPageNumber, scale: viewer.currentScaleValue, left: container.scrollLeft, top: container.scrollTop };
	host.postMessage({ type: 'state', state: saved });
}

function search(again = false, backwards = false): void {
	if (!active) { return; }
	eventBus.dispatch('find', { source: window, type: again ? 'again' : '', query: query.value, caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: backwards, matchDiacritics: false });
}

function openFind(): void {
	findbar.hidden = false;
	query.focus();
	query.select();
}

function closeFind(): void {
	findbar.hidden = true;
	eventBus.dispatch('findbarclose', { source: window });
	container.focus();
}

async function load(url: string, state?: ViewState): Promise<void> {
	const current = ++generation;
	save();
	const restore = state ?? saved;
	active = false;
	restoring = true;
	password = undefined;
	showMessage(config.labels.loading);
	viewer.setDocument(null);
	links.setDocument(null);
	const previous = task;
	task = undefined;
	await previous?.destroy();
	if (current !== generation) { return; }
	try {
		const loading = task = getDocument({ url, cMapUrl: `${config.assets}cmaps/`, cMapPacked: true, standardFontDataUrl: `${config.assets}standard_fonts/`, wasmUrl: `${config.assets}wasm/`, enableXfa: false, disableAutoFetch: true, disableStream: true });
		loading.onPassword = (update: (value: string) => void) => { password = update; host.postMessage({ type: 'password' }); };
		const pdf = await loading.promise;
		if (current !== generation) { await loading.destroy(); return; }
		const initialized = new Promise<void>(resolve => {
			const listener = () => { eventBus.off('pagesinit', listener); resolve(); };
			eventBus.on('pagesinit', listener);
		});
		links.setDocument(pdf);
		viewer.setDocument(pdf);
		await initialized;
		if (current !== generation) { return; }
		viewer.currentScaleValue = restore?.scale ?? 'page-width';
		viewer.currentPageNumber = Math.min(restore?.page ?? 1, pdf.numPages);
		await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
		if (current !== generation) { return; }
		if (restore) { container.scrollTo(restore.left, restore.top); }
		page.max = String(pdf.numPages);
		element('total').textContent = `/ ${pdf.numPages}`;
		active = true;
		restoring = false;
		showMessage('');
		updatePage();
		save();
		if (query.value) { search(); }
	} catch (error) {
		if (current !== generation) { return; }
		restoring = false;
		showMessage(config.labels.error);
		console.error('PDF load failed', error);
	}
}

function updatePage(): void {
	page.value = String(viewer.currentPageNumber);
	element<HTMLButtonElement>('previous').disabled = viewer.currentPageNumber <= 1;
	element<HTMLButtonElement>('next').disabled = viewer.currentPageNumber >= viewer.pagesCount;
}

eventBus.on('pagechanging', updatePage);
eventBus.on('scalechanging', () => {
	const scale = viewer.currentScaleValue;
	const option = Array.from(zoom.options).find(option => option.id !== 'customZoom' && option.value === scale);
	const custom = element<HTMLOptionElement>('customZoom');
	custom.hidden = !!option;
	if (!option) { custom.value = scale; custom.textContent = `${Math.round(viewer.currentScale * 100)}%`; }
	zoom.value = scale;
});
eventBus.on('updateviewarea', save);
const showMatches = (event: { matchesCount: { current: number; total: number } }) => {
	const { current, total } = event.matchesCount;
	element('matches').textContent = !query.value ? '' : total ? config.labels.matchCount.replace('{0}', String(current)).replace('{1}', String(total)) : config.labels.noMatches;
};
eventBus.on('updatefindmatchescount', showMatches);
eventBus.on('updatefindcontrolstate', showMatches);

element('previous').addEventListener('click', () => { if (active) { viewer.previousPage(); } });
element('next').addEventListener('click', () => { if (active) { viewer.nextPage(); } });
page.addEventListener('change', () => {
	if (active) { viewer.currentPageNumber = Math.max(1, Math.min(viewer.pagesCount, Number(page.value) || 1)); updatePage(); container.focus(); }
});
zoom.addEventListener('change', () => { if (active) { viewer.currentScaleValue = zoom.value; save(); } });
element('zoomIn').addEventListener('click', () => { if (active) { viewer.currentScale = Math.min(10, viewer.currentScale * 1.2); } });
element('zoomOut').addEventListener('click', () => { if (active) { viewer.currentScale = Math.max(0.1, viewer.currentScale / 1.2); } });
element('find').addEventListener('click', openFind);
element('closeFind').addEventListener('click', closeFind);
element('nextMatch').addEventListener('click', () => search(true));
element('previousMatch').addEventListener('click', () => search(true, true));
query.addEventListener('input', () => search());
query.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); search(true, event.shiftKey); } });
document.addEventListener('keydown', event => {
	if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); event.stopPropagation(); openFind(); }
	else if (event.key === 'Escape' && !findbar.hidden) { event.preventDefault(); event.stopPropagation(); closeFind(); }
});
const observer = new ResizeObserver(() => {
	if (active && ['page-width', 'page-fit', 'auto'].includes(viewer.currentScaleValue)) { viewer.currentScaleValue = viewer.currentScaleValue; }
});
observer.observe(container);
window.addEventListener('message', event => {
	if (event.data?.type === 'load') { void load(event.data.url, readState(event.data.state)); }
	else if (event.data?.type === 'password' && password) {
		if (typeof event.data.password === 'string') { password(event.data.password); password = undefined; }
		else { generation++; void task?.destroy(); task = undefined; password = undefined; restoring = false; showMessage(config.labels.passwordCancelled); }
	}
});
window.addEventListener('pagehide', () => { save(); observer.disconnect(); void task?.destroy(); worker?.terminate(); if (workerUrl) { URL.revokeObjectURL(workerUrl); } });
try {
	const response = await fetch(`${config.assets}pdf.worker.mjs`);
	if (!response.ok) { throw new Error('PDF worker unavailable'); }
	workerUrl = URL.createObjectURL(new Blob([await response.text()], { type: 'text/javascript' }));
	worker = new Worker(workerUrl, { type: 'module' });
	GlobalWorkerOptions.workerPort = worker;
	host.postMessage({ type: 'ready' });
} catch (error) {
	showMessage(config.labels.error);
	console.error('PDF worker failed', error);
}
