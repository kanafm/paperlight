export class ProjectWheel {
	private lastTime = -Infinity;
	private total = 0;
	private direction = 0;
	private lastDelta = 0;

	step(deltaX: number, deltaY: number, deltaMode: number, time: number): number {
		const delta = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
		const direction = Math.sign(delta);
		if (!direction) { return 0; }
		const elapsed = time - this.lastTime;
		const discrete = deltaMode !== 0 || (Number.isInteger(delta) && (Math.abs(delta) >= 60 || (delta === this.lastDelta && elapsed >= 50)));
		const started = elapsed > 180 || direction !== this.direction;
		if (started || discrete) { this.total = 0; }
		this.lastTime = time;
		this.lastDelta = delta;
		this.direction = direction;
		if (discrete) {
			const unit = deltaMode === 1 ? 3 : deltaMode === 2 ? 1 : 100;
			return direction * Math.max(1, Math.round(Math.abs(delta) / unit));
		}
		if (started && Math.abs(delta) < 16) { return direction; }
		this.total += Math.abs(delta);
		const steps = Math.floor(this.total / 16);
		this.total %= 16;
		return steps ? steps * direction : 0;
	}
}
