export const isPDFReader = (
  r: _ZoteroTypes.ReaderInstance,
): r is _ZoteroTypes.ReaderInstance<'pdf'> => r.type === 'pdf';

export const isEpubReader = (
  r: _ZoteroTypes.ReaderInstance,
): r is _ZoteroTypes.ReaderInstance<'epub'> => r.type === 'epub';

export const isSnapshotReader = (
  r: _ZoteroTypes.ReaderInstance,
): r is _ZoteroTypes.ReaderInstance<'snapshot'> => r.type === 'snapshot';

export const isIFrame = (e: Element): e is HTMLIFrameElement =>
  e.tagName.toUpperCase() === 'IFRAME';

export async function waitForReader(
  reader: _ZoteroTypes.ReaderInstance,
): Promise<void> {
  await Promise.all([reader._waitForReader(), reader._initPromise]);
}

export async function waitForInternalReader(
  reader: _ZoteroTypes.ReaderInstance,
): Promise<void> {
  if (reader._internalReader) {
    await Promise.all([
      reader._internalReader._primaryView.initializedPromise,
      reader._internalReader._secondaryView?.initializedPromise,
    ]);
  }
}

export function getCurrentReader(
  window: _ZoteroTypes.MainWindow,
): _ZoteroTypes.ReaderInstance | undefined {
  return Zotero.Reader.getByTabID(window.Zotero_Tabs.selectedID);
}
