export function documentUri(params: unknown): string | undefined {
	if (!params || typeof params !== 'object') {
		return undefined;
	}
	const value = params as { textDocument?: { uri?: unknown }; item?: { uri?: unknown } };
	const uri = value.textDocument?.uri ?? value.item?.uri;
	return typeof uri === 'string' ? uri : undefined;
}
