/**
 * The bridge -- the single most important file in this starter.
 *
 * React CANNOT import from '@salesforce/apex'. Those imports are resolved by the LWC compiler at
 * build time, and this bundle is compiled by esbuild, outside any LWC module graph. So the LWC host
 * (reactGridHost) does the importing, wraps each Apex method in a plain promise-returning function,
 * and hands the set of them to window.ReactGrid.configure() BEFORE it mounts anything.
 *
 * This module is the ONLY place in the React app that touches that global. Everything else imports
 * fetchList() from here -- which is what lets a test inject a fake bridge without mocking network,
 * without a DOM, and without Salesforce.
 */
import type { ListEnvelope, ListRequest } from '../components/types';

export interface GridBridge {
  fetchList: (request: ListRequest) => Promise<ListEnvelope>;
  /** The running org's namespace prefix, or '' when there is none. See README > Namespace. */
  namespace: string;
  locale: string;
  timeZone: string;
}

declare global {
  interface Window {
    __reactGridBridge?: GridBridge;
  }
}

export class BridgeNotReadyError extends Error {
  constructor() {
    super(
      'The grid rendered before its Salesforce bridge was attached. That means the host called ' +
        'mount() without first calling configure() -- a host bug, not a network failure. Fail ' +
        'loudly rather than retrying, or you will spend an afternoon looking at the wrong layer.'
    );
    this.name = 'BridgeNotReadyError';
  }
}

export function getBridge(): GridBridge {
  const bridge = window.__reactGridBridge;
  if (!bridge) throw new BridgeNotReadyError();
  return bridge;
}

export function fetchList(request: ListRequest): Promise<ListEnvelope> {
  return getBridge().fetchList(request);
}
