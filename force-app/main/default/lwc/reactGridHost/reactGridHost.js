import { LightningElement, api } from 'lwc';
import { loadScript, loadStyle } from 'lightning/platformResourceLoader';
import reactGridBundle from '@salesforce/resourceUrl/reactGridBundle';
import fetchList from '@salesforce/apex/StarterListController.fetchList';
import USER_LOCALE from '@salesforce/i18n/locale';
import USER_TIME_ZONE from '@salesforce/i18n/timeZone';

/**
 * reactGridHost -- the thin LWC host for the React grid.
 *
 * On purpose, this file contains NO grid behaviour. No sorting, no filtering, no paging, no
 * rendering. Its only three jobs are:
 *
 *   1. load the compiled React bundle once per component,
 *   2. hand React a bridge of Apex-backed, promise-returning functions,
 *   3. mount and unmount the React tree into a lwc:dom="manual" node.
 *
 * If you ever find yourself adding a feature to this file, it belongs in React instead. The moment
 * behaviour is split across both sides, every bug becomes a question of which side owns it.
 */
export default class ReactGridHost extends LightningElement {
    @api objectApiName = 'Account';
    @api caption = 'Records';

    errorMessage;
    bundleLoaded = false;

    get hasError() {
        return !!this.errorMessage;
    }

    /**
     * renderedCallback fires on EVERY render, not just the first. The guard is not optional -- drop
     * it and you load the bundle repeatedly and mount a second React root on top of the first.
     * Setting the flag before the await is deliberate: two renders can otherwise both get past an
     * async check before either sets it.
     */
    renderedCallback() {
        if (this.bundleLoaded) {
            return;
        }
        this.bundleLoaded = true;
        this.initialize();
    }

    async initialize() {
        try {
            await Promise.all([
                loadScript(this, reactGridBundle + '/reactGrid.js'),
                loadStyle(this, reactGridBundle + '/reactGrid.css')
            ]);

            // window.ReactGrid is attached by the bundle itself as it evaluates.
            // eslint-disable-next-line no-undef
            const ReactGrid = window.ReactGrid;
            if (!ReactGrid) {
                throw new Error('The React grid bundle did not attach window.ReactGrid.');
            }

            // THE BRIDGE. Each entry wraps an Apex method the React side could never import for
            // itself. Note that these are plain functions returning plain promises -- React has no
            // idea Salesforce exists on the other end, which is precisely why a test can replace
            // this object with a fake and exercise the whole grid in milliseconds.
            ReactGrid.configure({
                fetchList: (request) => this.bridgeFetchList(request),
                namespace: '',
                locale: USER_LOCALE,
                timeZone: USER_TIME_ZONE
            });

            ReactGrid.mount(this.mountElement, {
                objectApiName: this.objectApiName,
                caption: this.caption
            });
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error('reactGridHost failed to initialize', e);
            this.errorMessage = 'This list could not be loaded. Please refresh the page.';
        }
    }

    disconnectedCallback() {
        // Without this, navigating away in an Experience site leaves a live React root attached to
        // a detached node -- a leak that shows up as a slow page after ten navigations, long after
        // anyone remembers why.
        if (this.mountElement && window.ReactGrid) {
            window.ReactGrid.unmount(this.mountElement);
        }
    }

    get mountElement() {
        return this.template.querySelector('.host-mount');
    }

    /**
     * Payloads cross this boundary as JSON strings in both directions.
     *
     * Serializing here rather than passing an object keeps the Apex signature stable as the request
     * grows (add a filter, no new parameter), and -- more importantly -- stops SObjects being
     * returned directly, which would carry the running org's namespace prefix on every custom field
     * and break the client in any org whose prefix differs.
     */
    async bridgeFetchList(request) {
        const raw = await fetchList({ requestJson: JSON.stringify(request) });
        return JSON.parse(raw);
    }
}
