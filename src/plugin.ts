import { config } from '../package.json';
import { ReaderController } from './reader-controller';
import { isPDFReader, waitForReader, waitForInternalReader } from './utils';

export interface PluginOptions {
  id: string;
  version: string;
  rootURI: string;
}

export class Plugin {
  readonly id: string;
  readonly version: string;
  readonly rootURI: string;

  #controllers = new Map<string, ReaderController>();

  constructor({ id = config.addonID, version, rootURI }: PluginOptions) {
    this.id = id;
    this.version = version;
    this.rootURI = rootURI;
  }

  startup(): void {
    this.registerObserver();
    Zotero.Reader.registerEventListener(
      'createViewContextMenu',
      this.onViewContextMenu,
      this.id,
    );
    // readers that were already open when the plugin started
    for (const reader of Zotero.Reader._readers) {
      if (isPDFReader(reader)) this.attach(reader);
    }
  }

  shutdown(): void {
    this.unregisterObserver();
    Zotero.Reader.unregisterEventListener(
      'createViewContextMenu',
      this.onViewContextMenu,
    );
    this.#controllers.forEach((c) => c.destroy());
    this.#controllers.clear();
  }

  observerID?: string;
  registerObserver() {
    this.log('registering tab observer');
    if (this.observerID) {
      throw new Error(`${this.id}: observer is already registered`);
    }
    type Trigger = _ZoteroTypes.Notifier.Event | 'load'; // zotero-types doesn't include 'load' in the event definition, but tabs have a load event
    const triggers = new Set<Trigger>(['add', 'load', 'select']);
    this.observerID = Zotero.Notifier.registerObserver(
      {
        notify: async (event, type, ids, extraData) => {
          if (type !== 'tab') return;
          if (event === 'close') {
            ids.forEach((id) => this.detach(id.toString()));
            return;
          }
          if (!triggers.has(event)) return;
          await Promise.all(
            ids
              .filter((id) => extraData[id]?.type === 'reader')
              .map(async (id) => {
                const reader = Zotero.Reader.getByTabID(id.toString());
                if (reader && isPDFReader(reader)) await this.attach(reader);
              }),
          );
        },
      },
      ['tab'],
    );
    this.log('registered observer: ' + this.observerID);
  }

  unregisterObserver() {
    if (this.observerID) {
      this.log('unregistering observer: ' + this.observerID);
      Zotero.Notifier.unregisterObserver(this.observerID);
      this.observerID = undefined;
    }
  }

  async attach(reader: _ZoteroTypes.ReaderInstance<'pdf'>) {
    const tabID = reader.tabID;
    const existing = this.#controllers.get(tabID);
    if (existing?.reader === reader) return;
    existing?.destroy();

    const controller = new ReaderController(reader, (msg) => this.log(msg));
    this.#controllers.set(tabID, controller);
    await waitForReader(reader);
    await waitForInternalReader(reader);
    if (this.#controllers.get(tabID) !== controller) return;
    this.log(`attaching to tab ${tabID}`);
    await controller.init();
  }

  detach(tabID: string) {
    this.#controllers.get(tabID)?.destroy();
    this.#controllers.delete(tabID);
  }

  onViewContextMenu = ({
    reader,
    append,
  }: _ZoteroTypes.Reader.EventParams<'createViewContextMenu'>) => {
    const controller = this.#controllers.get(reader.tabID);
    if (!controller) return;
    append(
      {
        label: 'Draw Content Area…',
        onCommand: () => controller.drawArea(),
      },
      // @ts-expect-error append takes any number of items (one menu group)
      {
        label: 'Reset Content Area',
        disabled: !controller.settings.area,
        onCommand: () => controller.update({ area: null }),
      },
    );
  };

  log(msg: string) {
    Zotero.debug(`[${config.addonName}] ${msg}`);
  }
}
