export class ProjectWheel {
	private lastTime = -Infinity;
	private total = 0;
	private direction = 0;
	private switched = false;
	private lastDelta = 0;

	step(deltaX: number, deltaY: number, deltaMode: number, time: number): number {
		const delta = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
		const direction = Math.sign(delta);
		if (!direction) {
			return 0;
		}
		const discrete = deltaMode !== 0 || (Math.abs(delta) >= 60 && delta === this.lastDelta && time - this.lastTime >= 50);
		if (time - this.lastTime > 180 || direction !== this.direction || discrete) {
			this.total = 0;
			this.switched = false;
		}
		this.lastTime = time;
		this.lastDelta = delta;
		this.direction = direction;
		this.total += Math.abs(delta) * (deltaMode === 1 ? 20 : deltaMode === 2 ? 120 : 1);
		if (this.switched || this.total < 40) {
			return 0;
		}
		this.switched = true;
		this.total = 0;
		return direction;
	}
}
