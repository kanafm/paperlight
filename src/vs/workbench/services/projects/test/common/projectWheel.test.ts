import assert from 'assert';
import { ProjectWheel } from '../../common/projectWheel.js';

suite('ProjectWheel', () => {
	test('accumulates trackpad motion and ignores momentum until the gesture ends', () => {
		const wheel = new ProjectWheel();
		assert.deepStrictEqual([
			wheel.step(12, 0, 0, 0),
			wheel.step(16, 0, 0, 16),
			wheel.step(20, 0, 0, 32),
			wheel.step(60, 0, 0, 48),
			wheel.step(40, 0, 0, 64),
			wheel.step(12, 0, 0, 80),
			wheel.step(50, 0, 0, 300)
		], [0, 0, 1, 0, 0, 0, 1]);
	});

	test('successive mouse wheel notches advance without waiting for a gesture timeout', () => {
		const wheel = new ProjectWheel();
		assert.deepStrictEqual([
			wheel.step(0, 100, 0, 0),
			wheel.step(0, 100, 0, 75),
			wheel.step(0, 100, 0, 150)
		], [1, 1, 1]);
	});

	test('supports vertical wheels, line units, and direction changes', () => {
		const wheel = new ProjectWheel();
		assert.deepStrictEqual([
			wheel.step(0, 3, 1, 0),
			wheel.step(0, -3, 1, 20),
			wheel.step(0, -1, 1, 40),
			wheel.step(0, -1, 2, 300)
		], [1, -1, 0, -1]);
	});
});
