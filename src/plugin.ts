import { config } from '../package.json';

export interface PluginOptions {
  id: string;
  version: string;
  rootURI: string;
  stylesId?: string;
}

export class Plugin {
  readonly id: string;
  readonly stylesId: string;
  readonly version: string;
  readonly rootURI: string;

  #isActive: boolean = true;
  get isActive(): boolean {
    return this.#isActive;
  }

  constructor({
    id = 'center-pdf@dylan.ac',
    stylesId = 'pluginStyles',
    version,
    rootURI,
  }: PluginOptions) {
    this.id = id;
    this.stylesId = stylesId;
    this.version = version;
    this.rootURI = rootURI;
  }

  startup(): void {
    this.log('registering renderToolbar listener');
    Zotero.Reader.registerEventListener(
      'renderToolbar',
      this.onRenderToolbar,
      this.id,
    );
  }

  shutdown(): void {
    this.log('unregistering renderToolbar listener');
    Zotero.Reader.unregisterEventListener(
      'renderToolbar',
      this.onRenderToolbar,
    );
  }

  onRenderToolbar = (e: _ZoteroTypes.Reader.EventParams<'renderToolbar'>) => {
    const { reader } = e;
    if (isPDFReader(reader)) {
      this.addListeners(reader);
    }
  };

  async addListeners(reader: _ZoteroTypes.ReaderInstance<'pdf'>) {
    this.log('adding page listeners');
    await reader._waitForReader();
    await reader._initPromise;
    const doc = reader?._iframeWindow?.document;
    const iframe = doc?.querySelector<HTMLIFrameElement>(
      'iframe[src="pdf/web/viewer.html"]',
    );
    if (!doc || !iframe || !isIframe(iframe)) {
      this.log(`couldn't attach styles; tab ${reader.tabID} not ready`);
      return;
    }

    const viewer = await Plugin.getViewerContainer(iframe);
    const lastView = reader._internalReader._lastView;
    const pdfViewer = lastView._iframeWindow?.PDFViewerApplication.pdfViewer;
    const eventBus = lastView._iframeWindow?.PDFViewerApplication.eventBus;
    if (!viewer || !pdfViewer || !eventBus) {
      return;
    }

    // Modifying functions defined at reader/src/pdf/pdf-view.js
    lastView.navigateBack = () => {
      // @ts-expect-error _history not included in types
      lastView._history.navigateBack();
      this.centerCurrentPage(viewer);
    };
    lastView.navigateToPreviousPage = () => {
      pdfViewer.previousPage();
      this.centerCurrentPage(viewer);
    };
    lastView.navigateToNextPage = () => {
      pdfViewer.nextPage();
      this.centerCurrentPage(viewer);
    };
    lastView.navigateToFirstPage = () => {
      // @ts-expect-error not sure why it thinks dispatch needs two arguments
      eventBus.dispatch('firstpage');
      this.centerCurrentPage(viewer);
    };
    lastView.navigateToLastPage = () => {
      // @ts-expect-error not sure why it thinks dispatch needs two arguments
      eventBus.dispatch('lastpage');
      this.centerCurrentPage(viewer);
    };

    this.log('added page listeners');
  }

  centerCurrentPage(viewer: HTMLElement) {
    const page = Plugin.getCurrentPage(viewer);
    if (!page) {
      this.log("couldn't identify current page");
      return;
    }
    const target = Plugin.getScrollTarget(viewer, page);
    this.log(`scrolling to ${JSON.stringify(target)}`);
    viewer.scrollTo(target);
  }

  static getViewerContainer(
    iframe: HTMLIFrameElement,
  ): Promise<HTMLElement | null> {
    return new Promise((resolve) => {
      const viewer =
        iframe.contentDocument?.querySelector<HTMLElement>('#viewerContainer');
      if (viewer) {
        resolve(viewer);
      } else {
        iframe.addEventListener('load', () => {
          const viewer =
            iframe.contentDocument?.querySelector<HTMLElement>(
              '#viewerContainer',
            );
          resolve(viewer || null);
        });
      }
    });
  }

  log(msg: string) {
    Zotero.debug(`[${config.addonName}] ${msg}`);
  }

  static getScrollTarget(viewer: HTMLElement, page: HTMLElement) {
    const xOffset = (page.clientWidth - viewer.clientWidth) * 0.5;
    const yOffset = (page.clientHeight - viewer.clientHeight) * 0.5;
    return {
      top: page.offsetTop + yOffset,
      left: page.offsetLeft + xOffset,
    };
  }

  // // unused, can uncomment if needed
  // static getCurrentPageIndex(): number | null {
  //   const viewState =
  //     Zotero.Reader._readers[0]._internalReader._state.primaryViewState;
  //   return 'pageIndex' in viewState ? viewState.pageIndex : null;
  // }

  static getCurrentPage(viewer: HTMLElement): HTMLElement | null {
    const pages = viewer.querySelectorAll<HTMLElement>('.pdfViewer .page');
    for (const p of pages) {
      if (Math.abs(p.offsetTop - viewer.scrollTop) < 5) {
        return p;
      }
    }
    return null;
  }
}

const isIframe = (e: Element): e is HTMLIFrameElement =>
  e.tagName.toUpperCase() === 'IFRAME';

const isPDFReader = (
  r: _ZoteroTypes.ReaderInstance,
): r is _ZoteroTypes.ReaderInstance<'pdf'> => r.type === 'pdf';
