import { addDisposableListener, AnimationFrameScheduler, isHTMLElement } from '../../../../base/browser/dom.js';
import { CodeWindow } from '../../../../base/browser/window.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { INativeHostService } from '../../../../platform/native/common/native.js';

export class EditorWindowDrag extends Disposable {
	constructor(targetWindow: CodeWindow, nativeHost: INativeHostService) {
		super();
		const document = targetWindow.document;
		const options = { targetWindowId: targetWindow.vscodeWindowId };
		const header = (event: Event) => {
			const target = event.target;
			if (!isHTMLElement(target) || target.closest('.tab, .tabs-bar-add-tab, .editor-toolbars, .scrollbar')) { return undefined; }
			return target.closest<HTMLElement>('.paperlight-bottom-workbench:not(.fullscreen) .part.editor .tabs-and-actions-container') ?? undefined;
		};
		let drag: { element: HTMLElement; pointer: number; x: number; y: number; screenX: number; screenY: number; width: number; height: number } | undefined;
		let position: { x: number; y: number; width: number; height: number } | undefined;
		const move = this._register(new AnimationFrameScheduler(document, () => {
			if (position) { void nativeHost.positionWindow(position, options); }
		}));
		this._register(addDisposableListener(document, 'pointerdown', (event: PointerEvent) => {
			const element = header(event);
			if (!element || event.button !== 0 || event.ctrlKey) { return; }
			event.preventDefault();
			event.stopPropagation();
			element.setPointerCapture(event.pointerId);
			drag = { element, pointer: event.pointerId, x: targetWindow.screenX, y: targetWindow.screenY, screenX: event.screenX, screenY: event.screenY, width: targetWindow.outerWidth, height: targetWindow.outerHeight };
		}, true));
		this._register(addDisposableListener(document, 'pointermove', (event: PointerEvent) => {
			if (!drag || event.pointerId !== drag.pointer) { return; }
			position = { x: Math.round(drag.x + event.screenX - drag.screenX), y: Math.round(drag.y + event.screenY - drag.screenY), width: drag.width, height: drag.height };
			move.schedule();
		}, true));
		const release = () => {
			if (drag?.element.hasPointerCapture(drag.pointer)) { drag.element.releasePointerCapture(drag.pointer); }
			drag = undefined;
		};
		for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
			this._register(addDisposableListener(document, type, release, true));
		}
		this._register(addDisposableListener(targetWindow, 'blur', release));
		this._register(addDisposableListener(document, 'dblclick', async event => {
			if (!header(event)) { return; }
			event.preventDefault();
			event.stopPropagation();
			if (await nativeHost.isMaximized(options)) { await nativeHost.unmaximizeWindow(options); }
			else { await nativeHost.maximizeWindow(options); }
		}, true));
	}
}
