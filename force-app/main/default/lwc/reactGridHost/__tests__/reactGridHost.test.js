import { createElement } from 'lwc';
import ReactGridHost from 'c/reactGridHost';
import fetchList from '@salesforce/apex/StarterListController.fetchList';

/**
 * The host has almost no logic, so this suite tests the little it does have -- and that little is
 * exactly where the expensive bugs live: mounting twice, never unmounting, and serialization at the
 * boundary.
 */
jest.mock(
    'lightning/platformResourceLoader',
    () => ({
        loadScript: jest.fn(() => Promise.resolve()),
        loadStyle: jest.fn(() => Promise.resolve())
    }),
    { virtual: true }
);

function flushPromises() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('c-react-grid-host', () => {
    let grid;

    beforeEach(() => {
        grid = { configure: jest.fn(), mount: jest.fn(), unmount: jest.fn() };
        global.window.ReactGrid = grid;
        fetchList.mockResolvedValue(JSON.stringify({ columns: [], rows: [], totalCount: 0 }));
    });

    afterEach(() => {
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
        delete global.window.ReactGrid;
        jest.clearAllMocks();
    });

    it('configures the bridge before it mounts -- never the other way round', async () => {
        const element = createElement('c-react-grid-host', { is: ReactGridHost });
        document.body.appendChild(element);
        await flushPromises();

        expect(grid.configure).toHaveBeenCalledTimes(1);
        expect(grid.mount).toHaveBeenCalledTimes(1);
        expect(grid.configure.mock.invocationCallOrder[0]).toBeLessThan(
            grid.mount.mock.invocationCallOrder[0]
        );
    });

    it('sends the request as a JSON string and parses the response back', async () => {
        const element = createElement('c-react-grid-host', { is: ReactGridHost });
        element.objectApiName = 'Contact';
        document.body.appendChild(element);
        await flushPromises();

        const bridge = grid.configure.mock.calls[0][0];
        fetchList.mockResolvedValue(
            JSON.stringify({ columns: [], rows: [{ Id: '003' }], totalCount: 1 })
        );

        const result = await bridge.fetchList({ objectApiName: 'Contact', pageNumber: 1 });

        expect(fetchList).toHaveBeenCalledWith({
            requestJson: JSON.stringify({ objectApiName: 'Contact', pageNumber: 1 })
        });
        expect(result.rows).toHaveLength(1);
    });

    it('unmounts React when the component leaves the page', async () => {
        const element = createElement('c-react-grid-host', { is: ReactGridHost });
        document.body.appendChild(element);
        await flushPromises();

        document.body.removeChild(element);
        await flushPromises();

        expect(grid.unmount).toHaveBeenCalledTimes(1);
    });

    it('shows a readable message instead of a blank region when the bundle fails to attach', async () => {
        delete global.window.ReactGrid;

        const element = createElement('c-react-grid-host', { is: ReactGridHost });
        document.body.appendChild(element);
        await flushPromises();
        await flushPromises();

        const error = element.shadowRoot.querySelector('.host-error');
        expect(error).not.toBeNull();
        expect(error.textContent).toContain('could not be loaded');
    });
});
