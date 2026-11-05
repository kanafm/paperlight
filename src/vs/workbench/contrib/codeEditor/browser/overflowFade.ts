import './overflowFade.css';
import { $ } from '../../../../base/browser/dom.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { ICodeEditor, IOverlayWidget, IOverlayWidgetPosition } from '../../../../editor/browser/editorBrowser.js';
import { EditorContributionInstantiation, registerEditorContribution } from '../../../../editor/browser/editorExtensions.js';
import { EditorOption } from '../../../../editor/common/config/editorOptions.js';
import { IEditorContribution } from '../../../../editor/common/editorCommon.js';
import { projectNavigationEnabled } from '../../../services/projects/common/projectNavigation.js';

class OverflowFade extends Disposable implements IEditorContribution, IOverlayWidget {
	static readonly ID = 'paperlight.editor.overflowFade';
	private readonly node = $('.paperlight-overflow-fade');

	constructor(private readonly editor: ICodeEditor) {
		super();
		this.node.setAttribute('aria-hidden', 'true');
		editor.addOverlayWidget(this);
		this._register(toDisposable(() => editor.removeOverlayWidget(this)));
		this._register(editor.onDidChangeConfiguration(() => this.update()));
		this._register(editor.onDidLayoutChange(() => this.update()));
		this._register(editor.onDidScrollChange(() => this.update()));
		this._register(editor.onDidChangeModel(() => this.update()));
		this._register(editor.onDidChangeModelContent(() => this.update()));
		this.update();
	}

	getId(): string { return OverflowFade.ID; }
	getDomNode(): HTMLElement { return this.node; }
	getPosition(): IOverlayWidgetPosition | null { return null; }

	private update(): void {
		const layout = this.editor.getLayoutInfo();
		const right = layout.minimap.minimapWidth > 0 && layout.minimap.minimapLeft > layout.contentLeft ? layout.minimap.minimapLeft : layout.contentLeft + layout.contentWidth;
		const width = Math.min(64, Math.max(0, right - layout.contentLeft));
		const padding = layout.isViewportWrapping ? 0 : this.editor.getOption(EditorOption.scrollBeyondLastColumn) * this.editor.getOption(EditorOption.fontInfo).typicalHalfwidthCharacterWidth;
		this.node.style.display = this.editor.hasModel() && this.editor.getScrollWidth() - this.editor.getScrollLeft() - padding > layout.contentWidth + 1 ? 'block' : 'none';
		this.node.style.left = (right - width) + 'px';
		this.node.style.width = width + 'px';
		this.node.style.height = layout.height + 'px';
	}
}

if (projectNavigationEnabled) { registerEditorContribution(OverflowFade.ID, OverflowFade, EditorContributionInstantiation.AfterFirstRender); }
