# Zotero Plugin: PDF Content Flow

Makes PDF page navigation in Zotero's reader zoom to and step through the
page's content. This is useful on e-ink readers and other devices where
scrolling is annoying. Inspired by KOReader's zoom and paging modes.

## Usage

Click the toolbar button next to the zoom buttons to open the settings popup:

- **Paging**:
  - **Page** zooms each column so all of it is visible, and centers it.
  - **Continuous** zooms each column to fit its width, then scrolls down it one
    screen at a time. With a single column it scrolls straight across page
    boundaries instead of stopping at the bottom of each page.
  - **Off** restores Zotero's normal navigation.
- **Columns** (1–4): the content area is divided into this many equal columns,
  which are read left to right before moving on to the next page. This also
  works for scans with two book pages per PDF page.
- **Content area**: click **Draw** to drag a rectangle around the text on the
  current page. **Reset** uses the whole page again. You can also do this from
  the page's right-click menu.
- **Margin**: whitespace (in screen pixels) kept around the content.
- **Overlap** (Continuous only): the minimum percentage of the screen repeated
  between scroll steps.
- **Save as default**: use these settings for documents that don't have their
  own. The content area is always per-document.

The plugin handles the toolbar's previous/next/first/last buttons, Alt+↑/↓,
PageUp/PageDown, Space/Shift+Space, and Home/End. While paging is on, the
reader is kept in vertical scroll mode with no spreads, and those options are
hidden from the Appearance popup.

Per-document settings are stored locally in `.zotero-pdf-content-flow.json` in the
attachment's storage folder. They are not synced.

## Development

```sh
npm run dev    # launch Zotero with the plugin (see .env.example)
npm test       # unit tests for the layout math
npm run build
```
