import type { Mode } from '../geometry';
import type { Settings } from '../settings';

export const POPUP_CLASS = 'center-pdf-popup';
export const BUTTON_ID = 'center-pdf-button';

export interface PopupCallbacks {
  onChange: (changes: Partial<Settings>) => void;
  onDraw: () => void;
  onSaveDefaults: () => void;
  onClose: () => void;
}

const MODES: [Mode, string][] = [
  ['off', 'Off'],
  ['page', 'Page'],
  ['continuous', 'Continuous'],
];

function h<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const el = doc.createElement(tag);
  Object.assign(el, props);
  el.append(...children);
  return el;
}

/**
 * A popup styled like the reader's Appearance popup. Plain DOM rather than
 * React, so we manage open/close ourselves.
 */
export class Popup {
  readonly overlay: HTMLDivElement;
  #callbacks: PopupCallbacks;
  #render: (settings: Settings) => void;

  constructor(
    doc: Document,
    parent: Element,
    settings: Settings,
    callbacks: PopupCallbacks,
  ) {
    this.#callbacks = callbacks;

    const toggle = <T>(
      options: [T, string][],
      onSelect: (value: T) => void,
    ) => {
      const buttons = options.map(([value, label]) =>
        h(doc, 'button', {
          tabIndex: -1,
          textContent: label,
          onclick: () => onSelect(value),
        }),
      );
      const el = h(doc, 'div', { className: 'split-toggle' }, buttons);
      const update = (current: T) =>
        buttons.forEach((b, i) =>
          b.classList.toggle('active', options[i][0] === current),
        );
      return { el, update };
    };

    const option = (label: string, control: Node) =>
      h(doc, 'div', { className: 'option' }, [
        h(doc, 'label', { textContent: label }),
        control,
      ]);

    const numberInput = (
      min: number,
      max: number,
      step: number,
      onSet: (value: number) => void,
    ) => {
      const input = h(doc, 'input', {
        type: 'number',
        min: String(min),
        max: String(max),
        step: String(step),
      });
      input.addEventListener('change', () => {
        const value = Number(input.value);
        if (Number.isFinite(value)) onSet(Math.min(max, Math.max(min, value)));
      });
      // Firefox doesn't allow styling the native spin buttons, so they're
      // hidden in reader.scss and replaced with these
      const spinButton = (dir: 1 | -1) => {
        const button = h(doc, 'button', {
          tabIndex: -1,
          className: dir === 1 ? 'up' : 'down',
          title: dir === 1 ? 'Increase' : 'Decrease',
          onclick: () => {
            if (dir === 1) input.stepUp();
            else input.stepDown();
            input.dispatchEvent(new doc.defaultView!.Event('change'));
          },
        });
        button.append(chevron(doc, dir));
        return button;
      };
      const el = h(doc, 'span', { className: 'number-input' }, [
        input,
        h(doc, 'span', { className: 'spin' }, [spinButton(1), spinButton(-1)]),
      ]);
      return { input, el };
    };

    const mode = toggle(MODES, (mode) => callbacks.onChange({ mode }));
    const columns = toggle(
      [1, 2, 3, 4].map((n): [number, string] => [n, String(n)]),
      (columns) => callbacks.onChange({ columns }),
    );

    const areaLabel = h(doc, 'span', { className: 'area-label' });
    const resetButton = h(doc, 'button', {
      className: 'toolbar-button',
      textContent: 'Reset',
      title: 'Use the whole page',
      onclick: () => callbacks.onChange({ area: null }),
    });
    const drawButton = h(doc, 'button', {
      className: 'toolbar-button',
      textContent: 'Draw',
      title: 'Draw the content area on the current page',
      onclick: () => callbacks.onDraw(),
    });

    const margin = numberInput(0, 200, 4, (marginPx) =>
      callbacks.onChange({ marginPx }),
    );
    const overlap = numberInput(0, 90, 5, (overlapPct) =>
      callbacks.onChange({ overlapPct }),
    );
    const overlapOption = option(
      'Overlap',
      h(doc, 'div', { className: 'value' }, [overlap.el, '%']),
    );

    const popup = h(
      doc,
      'div',
      { className: `modal-popup appearance-popup ${POPUP_CLASS}` },
      [
        h(doc, 'div', { className: 'group' }, [
          option('Paging', mode.el),
          option('Columns', columns.el),
        ]),
        h(doc, 'div', { className: 'group' }, [
          option(
            'Content area',
            h(doc, 'div', { className: 'value' }, [
              areaLabel,
              drawButton,
              resetButton,
            ]),
          ),
          option(
            'Margin',
            h(doc, 'div', { className: 'value' }, [margin.el, 'px']),
          ),
          overlapOption,
        ]),
        h(doc, 'div', { className: 'footer' }, [
          h(doc, 'button', {
            className: 'toolbar-button',
            textContent: 'Save as default',
            title: 'Use these settings for documents without their own',
            onclick: () => callbacks.onSaveDefaults(),
          }),
        ]),
      ],
    );

    this.overlay = h(
      doc,
      'div',
      { className: 'toolbar-popup-overlay overlay' },
      [popup],
    );
    this.overlay.addEventListener('pointerdown', (e) => {
      if (e.target === this.overlay) callbacks.onClose();
    });
    this.overlay.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        callbacks.onClose();
      }
    });

    this.#render = (s: Settings) => {
      mode.update(s.mode);
      columns.update(s.columns);
      areaLabel.textContent = s.area ? 'Custom' : 'Whole page';
      resetButton.disabled = !s.area;
      if (doc.activeElement !== margin.input)
        margin.input.value = String(s.marginPx);
      if (doc.activeElement !== overlap.input)
        overlap.input.value = String(s.overlapPct);
      overlapOption.hidden = s.mode !== 'continuous';
    };
    this.#render(settings);
    parent.append(this.overlay);
  }

  update(settings: Settings) {
    this.#render(settings);
  }

  remove() {
    this.overlay.remove();
  }
}

/** A small up or down chevron for the number input spin buttons. */
function chevron(doc: Document, dir: 1 | -1): Element {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = doc.createElementNS(svgNS, 'svg');
  svg.setAttribute('width', '8');
  svg.setAttribute('height', '5');
  svg.setAttribute('viewBox', '0 0 8 5');
  const path = doc.createElementNS(svgNS, 'path');
  path.setAttribute('d', dir === 1 ? 'M1 4l3-3 3 3' : 'M1 1l3 3 3-3');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.25');
  svg.append(path);
  return svg;
}

/** Toolbar button: a page with a dashed crop rectangle. */
export function createToolbarButton(doc: Document): HTMLButtonElement {
  const button = h(doc, 'button', {
    id: BUTTON_ID,
    className: 'toolbar-button',
    tabIndex: -1,
    title: 'Paging and content area',
  });
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = doc.createElementNS(svgNS, 'svg');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('fill', 'none');
  const page = doc.createElementNS(svgNS, 'rect');
  Object.entries({
    x: '3.5',
    y: '1.5',
    width: '13',
    height: '17',
    rx: '1',
    stroke: 'currentColor',
  }).forEach(([k, v]) => page.setAttribute(k, v));
  const crop = doc.createElementNS(svgNS, 'rect');
  Object.entries({
    x: '6.5',
    y: '4.5',
    width: '7',
    height: '11',
    stroke: 'currentColor',
    'stroke-dasharray': '2 1.5',
  }).forEach(([k, v]) => crop.setAttribute(k, v));
  svg.append(page, crop);
  button.append(svg);
  return button;
}
