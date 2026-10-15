import readerCss from './styles/reader.scss';
import { Navigator, type PDFView } from './navigator';
import {
  loadDocSettings,
  loadGlobalDefaults,
  saveDocSettings,
  saveGlobalDefaults,
  type Settings,
} from './settings';
import { drawArea, showAreaPreview } from './ui/draw-canvas';
import { BUTTON_ID, POPUP_CLASS, Popup, createToolbarButton } from './ui/popup';

const STYLE_ID = 'center-pdf-styles';
const CONFLICT_CLASS = 'center-pdf-conflict';
const ACTIVE_CLASS = 'center-pdf-active';

/** Owns everything the plugin adds to one reader tab. */
export class ReaderController {
  readonly reader: _ZoteroTypes.ReaderInstance<'pdf'>;
  settings: Settings;
  #log: (msg: string) => void;
  #navigators = new Map<PDFView, Navigator>();
  #pendingViews = new WeakSet<PDFView>();
  #observer?: MutationObserver;
  #popup?: Popup;
  #removePreview?: () => void;
  #destroyed = false;

  constructor(
    reader: _ZoteroTypes.ReaderInstance<'pdf'>,
    log: (msg: string) => void,
  ) {
    this.reader = reader;
    this.#log = log;
    this.settings = loadGlobalDefaults();
  }

  get #doc(): Document | undefined {
    return this.reader._iframeWindow?.document;
  }

  get #internalReader(): any {
    return this.reader._internalReader;
  }

  async init() {
    this.settings = {
      ...loadGlobalDefaults(),
      ...(await loadDocSettings(this.reader.itemID!)),
    };
    const doc = this.#doc;
    if (!doc || this.#destroyed) return;

    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = readerCss;
    doc.head!.append(style);

    this.#injectButton();
    this.#syncViews();
    this.#updateActiveClass();

    // Views are recreated on split view, reload and reading mode; the
    // Appearance popup is rendered on demand.
    const observer = new doc.defaultView!.MutationObserver(() => {
      this.#syncViews();
      this.#injectButton();
      this.#tagAppearanceConflicts();
    });
    observer.observe(doc.body!, { childList: true, subtree: true });
    this.#observer = observer;
  }

  destroy() {
    this.#destroyed = true;
    this.#observer?.disconnect();
    this.#closePopup();
    this.#navigators.forEach((nav) => nav.destroy());
    this.#navigators.clear();
    const doc = this.#doc;
    doc?.getElementById(STYLE_ID)?.remove();
    doc?.getElementById(BUTTON_ID)?.remove();
    doc?.documentElement?.classList.remove(ACTIVE_CLASS);
    doc
      ?.querySelectorAll(`.${CONFLICT_CLASS}`)
      .forEach((el: Element) => el.classList.remove(CONFLICT_CLASS));
  }

  /** The navigator for the view the user last interacted with. */
  get navigator(): Navigator | undefined {
    const ir = this.#internalReader;
    return (
      this.#navigators.get(ir?._lastView) ??
      this.#navigators.get(ir?._primaryView)
    );
  }

  // --- settings ---

  async update(changes: Partial<Settings>) {
    this.settings = { ...this.settings, ...changes };
    this.#popup?.update(this.settings);
    this.#updateActiveClass();
    const nav = this.navigator;
    if (nav?.active) nav.snap();
    this.#refreshPreview();
    await saveDocSettings(this.reader.itemID!, this.settings);
  }

  saveDefaults() {
    saveGlobalDefaults(this.settings);
    this.#log('saved settings as default');
  }

  async drawArea() {
    this.#closePopup();
    const nav = this.navigator;
    if (!nav) return;
    const result = await drawArea(nav, this.settings.columns);
    if (!result) return;
    const mode = this.settings.mode === 'off' ? 'page' : this.settings.mode;
    await this.update({ area: result.area, mode });
    nav.goToPage(result.pageIndex);
  }

  // --- views ---

  #syncViews() {
    const ir = this.#internalReader;
    if (!ir) return;
    const views = [ir._primaryView, ir._secondaryView].filter(Boolean);
    for (const [view, nav] of this.#navigators) {
      if (!views.includes(view)) {
        nav.destroy();
        this.#navigators.delete(view);
      }
    }
    for (const view of views) {
      if (this.#navigators.has(view) || this.#pendingViews.has(view)) continue;
      this.#pendingViews.add(view);
      Promise.resolve(view.initializedPromise).then(() => {
        const current = [ir._primaryView, ir._secondaryView];
        // reading mode views have no pdf.js viewer
        if (
          this.#destroyed ||
          !current.includes(view) ||
          !view._iframeWindow?.PDFViewerApplication?.pdfViewer
        ) {
          return;
        }
        this.#log(`patching view for tab ${this.reader.tabID}`);
        this.#navigators.set(
          view,
          new Navigator(view, () => this.settings, this.#log),
        );
      });
    }
  }

  // --- UI ---

  #injectButton() {
    const doc = this.#doc;
    if (!doc || doc.getElementById(BUTTON_ID)) return;
    const end = doc.querySelector('.toolbar .end');
    if (!end) return;
    const button = createToolbarButton(doc);
    button.addEventListener('click', () => this.togglePopup());
    const appearance = end.querySelector('#appearance');
    if (appearance) end.insertBefore(button, appearance);
    else end.append(button);
  }

  togglePopup() {
    if (this.#popup) {
      this.#closePopup();
      return;
    }
    const doc = this.#doc;
    const parent = doc?.querySelector('.split-view')?.parentElement;
    if (!doc || !parent) return;
    this.#internalReader?.toggleAppearancePopup?.(false);
    this.#popup = new Popup(doc, parent, this.settings, {
      onChange: (changes) => this.update(changes),
      onDraw: () => this.drawArea(),
      onSaveDefaults: () => this.saveDefaults(),
      onClose: () => this.#closePopup(),
    });
    doc.getElementById(BUTTON_ID)?.classList.add('active');
    this.#refreshPreview();
  }

  #closePopup() {
    this.#popup?.remove();
    this.#popup = undefined;
    this.#removePreview?.();
    this.#removePreview = undefined;
    this.#doc?.getElementById(BUTTON_ID)?.classList.remove('active');
  }

  /** Outline the content area while the popup is open. */
  #refreshPreview() {
    this.#removePreview?.();
    this.#removePreview = undefined;
    const nav = this.navigator;
    if (this.#popup && nav && this.settings.mode !== 'off') {
      this.#removePreview = showAreaPreview(nav, this.settings.columns);
    }
  }

  #updateActiveClass() {
    this.#doc?.documentElement?.classList.toggle(
      ACTIVE_CLASS,
      this.settings.mode !== 'off',
    );
  }

  /**
   * Tag the scroll mode / spread mode group in the Appearance popup so CSS can
   * hide it while paging is active: the group with two options that each have
   * a three-way toggle.
   */
  #tagAppearanceConflicts() {
    const doc = this.#doc;
    const popup = doc?.querySelector(`.appearance-popup:not(.${POPUP_CLASS})`);
    if (!popup) return;
    for (const group of popup.querySelectorAll(':scope > .group')) {
      const options = group.querySelectorAll(':scope > .option');
      const isScrollSpread =
        options.length === 2 &&
        !group.querySelector('#reading-mode-enabled') &&
        [...options].every(
          (o) =>
            o.querySelectorAll(':scope > .split-toggle > button').length === 3,
        );
      if (isScrollSpread && !group.classList.contains(CONFLICT_CLASS)) {
        group.classList.add(CONFLICT_CLASS);
      }
    }
  }
}
