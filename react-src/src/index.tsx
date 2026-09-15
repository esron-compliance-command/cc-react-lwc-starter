/**
 * Entry point. Compiled into the single static resource `reactGridBundle`.
 *
 * The LWC host loads this file, then calls exactly three things on window.ReactGrid:
 *   configure(bridge)   once, before any mount
 *   mount(el, config)   per component instance
 *   unmount(el)         from disconnectedCallback
 *
 * Those three functions are the ENTIRE surface the host is allowed to touch. Keeping it that small
 * is what lets the React side be rewritten without opening a single file under force-app.
 */
import { createRoot, type Root } from 'react-dom/client';
import { StrictMode } from 'react';
import { RecordTable } from './components/RecordTable';
import type { GridConfig } from './components/types';
import type { GridBridge } from './services/bridge';

// Keyed by host element, so a page carrying two grids unmounts the right one. A WeakMap lets the
// entry go when the element does; a plain Map here leaks a React root on every page navigation.
const roots = new WeakMap<Element, Root>();

function configure(bridge: GridBridge): void {
  window.__reactGridBridge = bridge;
}

function mount(el: Element, config: GridConfig): void {
  const root = createRoot(el);
  roots.set(el, root);
  root.render(
    <StrictMode>
      <RecordTable config={config} />
    </StrictMode>
  );
}

function unmount(el: Element): void {
  roots.get(el)?.unmount();
  roots.delete(el);
}

declare global {
  interface Window {
    ReactGrid?: { configure: typeof configure; mount: typeof mount; unmount: typeof unmount };
  }
}

window.ReactGrid = { configure, mount, unmount };
