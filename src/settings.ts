import { config } from '../package.json';
import type { Area, Mode } from './geometry';

export interface Settings {
  mode: Mode;
  columns: number;
  marginPx: number;
  overlapPct: number;
  /** Content area as page fractions; `null` means the whole page. */
  area: Area | null;
}

export type DocSettings = Partial<Settings>;

export const DEFAULTS: Settings = {
  mode: 'page',
  columns: 1,
  marginPx: 16,
  overlapPct: 10,
  area: null,
};

const MODES: Mode[] = ['off', 'page', 'continuous'];
const DOC_FILE = '.zotero-center-pdf.json';

const prefKey = (name: string) => `${config.prefsPrefix}.${name}`;

/** Drop invalid values so bad files or prefs fall back to the defaults. */
export function sanitize(input: unknown): DocSettings {
  if (!input || typeof input !== 'object') return {};
  const raw = input as Record<string, unknown>;
  const out: DocSettings = {};
  if (MODES.includes(raw.mode as Mode)) out.mode = raw.mode as Mode;
  const num = (v: unknown, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v)
      ? Math.min(max, Math.max(min, v))
      : undefined;
  const columns = num(raw.columns, 1, 4);
  if (columns !== undefined) out.columns = Math.round(columns);
  const margin = num(raw.marginPx, 0, 200);
  if (margin !== undefined) out.marginPx = margin;
  const overlap = num(raw.overlapPct, 0, 90);
  if (overlap !== undefined) out.overlapPct = overlap;
  if (raw.area === null) {
    out.area = null;
  } else if (raw.area && typeof raw.area === 'object') {
    const a = raw.area as Record<string, unknown>;
    const [x0, y0, x1, y1] = [a.x0, a.y0, a.x1, a.y1].map((v) => num(v, 0, 1));
    if (
      x0 !== undefined &&
      y0 !== undefined &&
      x1 !== undefined &&
      y1 !== undefined &&
      x1 > x0 &&
      y1 > y0
    ) {
      out.area = { x0, y0, x1, y1 };
    }
  }
  return out;
}

/** Global defaults: hardcoded values overridden by prefs. */
export function loadGlobalDefaults(): Settings {
  const prefs: Record<string, unknown> = {
    mode: Zotero.Prefs.get(prefKey('mode'), true),
    columns: Zotero.Prefs.get(prefKey('columns'), true),
    marginPx: Zotero.Prefs.get(prefKey('marginPx'), true),
    overlapPct: Zotero.Prefs.get(prefKey('overlapPct'), true),
  };
  return { ...DEFAULTS, ...sanitize(prefs) };
}

/** Save everything except the area (which is document-specific). */
export function saveGlobalDefaults(settings: Settings): void {
  Zotero.Prefs.set(prefKey('mode'), settings.mode, true);
  Zotero.Prefs.set(prefKey('columns'), settings.columns, true);
  Zotero.Prefs.set(prefKey('marginPx'), settings.marginPx, true);
  Zotero.Prefs.set(prefKey('overlapPct'), settings.overlapPct, true);
}

function docFilePath(itemID: number): string | null {
  const item = Zotero.Items.get(itemID);
  if (!item) return null;
  const dir = Zotero.Attachments.getStorageDirectory(item);
  return PathUtils.join(dir.path, DOC_FILE);
}

export async function loadDocSettings(itemID: number): Promise<DocSettings> {
  const path = docFilePath(itemID);
  if (!path || !(await IOUtils.exists(path))) return {};
  try {
    return sanitize(await IOUtils.readJSON(path));
  } catch (e) {
    Zotero.debug(`[${config.addonName}] couldn't read ${path}: ${e}`);
    return {};
  }
}

export async function saveDocSettings(
  itemID: number,
  settings: DocSettings,
): Promise<void> {
  const path = docFilePath(itemID);
  if (!path) return;
  try {
    await IOUtils.writeJSON(path, settings);
  } catch (e) {
    Zotero.debug(`[${config.addonName}] couldn't write ${path}: ${e}`);
  }
}
