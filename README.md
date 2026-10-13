# Zotero Plugin: Center PDF

A [Zotero 7+](https://www.zotero.org/) plugin that changes how the PDF reader
moves between pages, so that paging through a document behaves like turning
pages in a book instead of scrolling a long scroll.

By default, Zotero's reader scrolls the top of the next page to the top of the
viewport. If the page is zoomed in past the window size, you end up looking at
the top-left corner and have to scroll around to read the rest. This plugin
centers each page in the view after navigating instead.

It was written for e-ink readers and other devices where scrolling is slow,
awkward, or ugly, but it's useful anywhere you'd rather page than scroll.

## Features

- **Centered paging** — after a page navigation, the current page is centered
  in the viewport, both vertically and horizontally.
- **Continuous paging** — next/previous page scroll by one viewport instead of
  one document page, with a little overlap kept between screens (the same
  behavior as pressing Page Down in a browser).
- **Mode switching from the menu** — pick a mode under _View → Paging_. The
  choice is saved as a Zotero preference and applies immediately to every open
  reader tab.

## Paging modes

| Mode           | Next/previous page                                         | First/last page, back |
| -------------- | ---------------------------------------------------------- | --------------------- |
| **Regular**    | Zotero's default behavior; the plugin stays out of the way | Default               |
| **Centered**   | Jumps to the next page, then centers it in the view        | Jumps, then centers   |
| **Continuous** | Scrolls by one viewport height, minus a small overlap      | Default               |

`Centered` is the default on a fresh install.

Modes change the reader's page navigation actions — the toolbar's
previous/next page arrows and the keyboard shortcuts that go through them.
Ordinary scrolling, clicking in the scrollbar, and typing a page number into
the page field are untouched, as is the `Regular` mode.

Only PDF attachments are affected. EPUB and snapshot readers are left alone.

## Installing

1. Download the `.xpi` from the
   [latest release](https://github.com/dawaltconley/zotero-center-pdf/releases/latest).
   (In a browser that tries to install it as an extension, right-click the link
   and save it instead.)
2. In Zotero, go to _Tools → Plugins_.
3. Click the gear icon in the top right and choose _Install Plugin From File…_,
   then pick the downloaded `.xpi`.

Updates are delivered through Zotero's plugin updater; the plugin points at the
GitHub release feed, so you only need to install by hand once.

Requires Zotero 7.0 or later (declared compatible through the 10.x line).

## Usage

Open a PDF, then choose a mode under _View → Paging_. Navigate with the reader
toolbar's page arrows or the equivalent keyboard shortcuts and the selected
mode takes effect.

## Development

The plugin is built with
[zotero-plugin-scaffold](https://github.com/northword/zotero-plugin-scaffold).

```sh
nvm use          # Node 22; CI builds on 20
npm install
cp .env.example .env    # then fill in your Zotero binary and dev profile paths
```

`.env` needs at least `ZOTERO_PLUGIN_ZOTERO_BIN_PATH` and
`ZOTERO_PLUGIN_PROFILE_PATH`. Create a dedicated development profile first with
`/path/to/zotero -p`, so you aren't loading unreleased code against your real
library. See the comments in `.env.example` for the rest.

```sh
npm run dev          # launch Zotero with the plugin loaded, rebuild on change
npm run build        # build to .scaffold/build, then typecheck
npm run lint:check   # prettier + eslint
npm run lint:fix     # prettier --write + eslint --fix
npm run release      # bump, tag, and publish a release
```

### Layout

| Path                      | What's in it                                                      |
| ------------------------- | ----------------------------------------------------------------- |
| `src/plugin.ts`           | The whole plugin: observer, navigation patching, menu, scrolling  |
| `src/utils.ts`            | Paging-mode type, reader type guards, reader-readiness promises   |
| `addon/bootstrap.js`      | Zotero's bootstrap entry points; constructs and starts `Plugin`   |
| `addon/manifest.json`     | Plugin manifest; placeholders are filled in at build time         |
| `addon/locale/`           | Fluent strings for the menu                                       |
| `zotero-plugin.config.ts` | Scaffold config: build targets, asset copying, template variables |

Values like `__addonName__` and `__addonRef__` in `addon/` are substituted
during the build from the `config` block in `package.json`.

### How it works

This is a monkeypatch, and not a subtle one.

On startup the plugin registers a `Zotero.Notifier` observer for `tab` events.
When a reader tab is added, loaded, or selected, it waits for the reader and
its internal reader to finish initializing, digs out the PDF viewer's
`#viewerContainer` element from the nested viewer iframe, and replaces the
navigation methods (`navigateToNextPage`, `navigateToPreviousPage`,
`navigateBack`, `navigateToFirstPage`, `navigateToLastPage`) on the view
object.

The original implementations are saved the first time a view is patched and
kept in a `WeakMap`, so switching modes re-patches from the originals rather
than wrapping a wrapper, and `Regular` can restore them exactly. Changing the
mode re-patches every open reader.

Centering is geometry: find the page whose `offsetTop` matches the container's
current `scrollTop`, then scroll so the page's center sits at the viewport's
center. Continuous paging reimplements Gecko's page-scroll amount — viewport
height minus the smaller of 10% of the viewport or two lines of text — because
`window.scrollByPages()` doesn't help when the scrolling element is a div
inside an iframe rather than the window itself.

Because all of this reaches into Zotero's reader internals, it's inherently
sensitive to upstream changes. The type annotations come from
[zotero-types](https://github.com/windingwind/zotero-types), which helps, but
a reader refactor upstream can still break it.

### Debugging

The plugin logs to Zotero's debug output, prefixed with `[Center PDF]`. Enable
_Help → Debug Output Logging → View Output_, or run `npm run dev`, which starts
Zotero with `-ZoteroDebug`.

## License

ISC
