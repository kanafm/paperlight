import assert from 'assert';
import { ProjectWheel } from '../../common/projectWheel.js';

suite('ProjectWheel', () => {
	test('continues advancing throughout a trackpad gesture', () => {
		const wheel = new ProjectWheel();
		assert.deepStrictEqual([
			wheel.step(12, 0, 0, 0),
			wheel.step(16, 0, 0, 16),
			wheel.step(20, 0, 0, 32),
			wheel.step(60, 0, 0, 48),
			wheel.step(40, 0, 0, 64),
			wheel.step(12, 0, 0, 80),
			wheel.step(50, 0, 0, 300)
		], [1, 1, 1, 1, 2, 1, 3]);
	});

	test('accumulates small movements, advances multiple tabs, and resets on reversal', () => {
		const wheel = new ProjectWheel();
		assert.deepStrictEqual([
			wheel.step(18, 0, 0, 0),
			wheel.step(18, 0, 0, 16),
			wheel.step(90, 0, 0, 32),
			wheel.step(-20, 0, 0, 48),
			wheel.step(-20, 0, 0, 64),
			wheel.step(10, 0, 0, 300)
		], [1, 1, 1, -1, -1, 1]);
	});

	test('successive mouse wheel notches advance without waiting for a gesture timeout', () => {
		const wheel = new ProjectWheel();
		assert.deepStrictEqual([
			wheel.step(0, 100, 0, 0),
			wheel.step(0, 100, 0, 75),
			wheel.step(0, 100, 0, 150)
		], [1, 1, 1]);
	});

	test('small mouse wheel notches switch immediately', () => {
		const wheel = new ProjectWheel();
		assert.deepStrictEqual([
			wheel.step(0, 2, 0, 0),
			wheel.step(0, 2, 0, 75),
			wheel.step(0, 2, 0, 150),
			wheel.step(0, -2, 0, 225)
		], [1, 1, 1, -1]);
	});

	test('preserves the distance of large wheel and page events', () => {
		const wheel = new ProjectWheel();
		assert.deepStrictEqual([
			wheel.step(0, 300, 0, 0),
			wheel.step(0, -200, 0, 300),
			wheel.step(0, 9, 1, 600),
			wheel.step(0, -3, 2, 900)
		], [3, -2, 3, -3]);
	});

	test('supports vertical wheels, line units, and direction changes', () => {
		const wheel = new ProjectWheel();
		assert.deepStrictEqual([
			wheel.step(0, 3, 1, 0),
			wheel.step(0, -3, 1, 20),
			wheel.step(0, -1, 1, 40),
			wheel.step(0, -1, 2, 300)
		], [1, -1, -1, -1]);
	});
});
