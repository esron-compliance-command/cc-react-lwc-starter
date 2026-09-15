/**
 * Notice what is NOT mocked here: there is no fetch mock, no network, no Salesforce, no jsdom
 * gymnastics. The component talks to a bridge, so a test hands it a FAKE bridge. That is the whole
 * payoff of routing every server call through one module.
 *
 * Notice also what is asserted: behaviour the user can see (roles, labels, text), not
 * implementation. `getByRole('button', { name: /industry/i })` keeps passing when the markup is
 * restyled and fails when the header stops being reachable by keyboard -- which is exactly the
 * failure worth catching.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecordTable } from '../components/RecordTable';
import type { GridBridge } from '../services/bridge';
import type { ListEnvelope, ListRequest } from '../components/types';

const COLUMNS: ListEnvelope['columns'] = [
  { apiName: 'Name', label: 'Account Name', type: 'text', sortable: true },
  { apiName: 'Industry', label: 'Industry', type: 'text', sortable: true },
  { apiName: 'AnnualRevenue', label: 'Annual Revenue', type: 'number', sortable: false },
];

function envelope(rows: ListEnvelope['rows'], totalCount = rows.length): ListEnvelope {
  return { columns: COLUMNS, rows, totalCount, pageNumber: 1, pageSize: 10 };
}

/** Installs a fake bridge and hands back the recorded requests for assertion. */
function installBridge(
  fetchList: (request: ListRequest) => Promise<ListEnvelope>
): { requests: ListRequest[] } {
  const requests: ListRequest[] = [];
  const bridge: GridBridge = {
    fetchList: (request) => {
      requests.push(request);
      return fetchList(request);
    },
    namespace: '',
    locale: 'en-US',
    timeZone: 'UTC',
  };
  window.__reactGridBridge = bridge;
  return { requests };
}

const config = { objectApiName: 'Account', caption: 'Accounts' };

afterEach(() => {
  delete window.__reactGridBridge;
});

test('renders the rows the server returned', async () => {
  installBridge(async () =>
    envelope([
      { Id: '001000000000001', Name: 'Northwind Traders', Industry: 'Manufacturing', AnnualRevenue: 4500000 },
    ])
  );

  render(<RecordTable config={config} />);

  expect(await screen.findByText('Northwind Traders')).toBeInTheDocument();
  expect(screen.getByText('Manufacturing')).toBeInTheDocument();
  // Formatted through the user's locale, not printed raw.
  expect(screen.getByText('4,500,000')).toBeInTheDocument();
});

test('sorting asks the SERVER for a new page rather than reordering what is on screen', async () => {
  const { requests } = installBridge(async () =>
    envelope([{ Id: '001000000000001', Name: 'Acme', Industry: 'Retail', AnnualRevenue: null }])
  );

  render(<RecordTable config={config} />);
  await screen.findByText('Acme');

  await userEvent.click(screen.getByRole('button', { name: /industry/i }));

  await waitFor(() => {
    expect(requests.at(-1)?.sort).toEqual({ apiName: 'Industry', direction: 'asc' });
  });
  // And a second click flips the direction rather than re-sorting ascending again.
  await userEvent.click(screen.getByRole('button', { name: /industry/i }));
  await waitFor(() => {
    expect(requests.at(-1)?.sort).toEqual({ apiName: 'Industry', direction: 'desc' });
  });
});

test('a column that is not sortable renders as plain text, not a dead button', async () => {
  installBridge(async () => envelope([{ Id: '001000000000001', Name: 'Acme', Industry: 'Retail', AnnualRevenue: 1 }]));

  render(<RecordTable config={config} />);
  await screen.findByText('Acme');

  const header = screen.getByRole('columnheader', { name: /annual revenue/i });
  expect(within(header).queryByRole('button')).toBeNull();
});

test('search is debounced: typing does not fire a request per keystroke', async () => {
  const { requests } = installBridge(async () => envelope([]));
  const user = userEvent.setup();

  render(<RecordTable config={config} />);
  await waitFor(() => expect(requests.length).toBeGreaterThan(0));
  const before = requests.length;

  await user.type(screen.getByRole('searchbox'), 'north');

  // Five keystrokes must not become five queries.
  await waitFor(() => expect(requests.at(-1)?.search).toBe('north'), { timeout: 2000 });
  expect(requests.length - before).toBeLessThan(5);
});

test('an empty result says so, and says it differently when a search is active', async () => {
  installBridge(async () => envelope([]));
  const user = userEvent.setup();

  render(<RecordTable config={config} />);
  expect(await screen.findByText(/there are no records yet/i)).toBeInTheDocument();

  await user.type(screen.getByRole('searchbox'), 'zzz');
  expect(await screen.findByText(/no records match "zzz"/i)).toBeInTheDocument();
});

test('an Apex failure surfaces its real message, not a generic apology', async () => {
  installBridge(async () => {
    // This is the shape Apex errors actually arrive in from an @AuraEnabled call.
    throw { body: { message: 'Insufficient access on field Industry.' } };
  });

  render(<RecordTable config={config} />);

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Insufficient access on field Industry.');
});
