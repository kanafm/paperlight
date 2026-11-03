export interface ViewState {
	page: number;
	scale: string;
	left: number;
	top: number;
}

export function readState(value: unknown): ViewState | undefined {
	if (!value || typeof value !== 'object') { return undefined; }
	const state = value as Partial<ViewState>;
	if (!Number.isInteger(state.page) || state.page! < 1 || !Number.isFinite(state.left) || !Number.isFinite(state.top)) { return undefined; }
	if (typeof state.scale !== 'string' || !(['page-width', 'page-fit', 'auto'].includes(state.scale) || Number(state.scale) >= 0.1 && Number(state.scale) <= 10)) { return undefined; }
	return { page: state.page!, scale: state.scale, left: Math.max(0, state.left!), top: Math.max(0, state.top!) };
}

export function externalLink(value: unknown): string | undefined {
	if (typeof value !== 'string') { return undefined; }
	try {
		const url = new URL(value);
		return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : undefined;
	} catch { return undefined; }
}
