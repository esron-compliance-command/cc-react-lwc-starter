import { formatCell } from '../components/formatCell';
import type { ColumnDefinition } from '../components/types';

const dateColumn: ColumnDefinition = {
  apiName: 'CloseDate',
  label: 'Close Date',
  type: 'date',
  sortable: true,
};

test('a Salesforce Date does not slip a day for a user west of GMT', () => {
  // The bug this guards: new Date('2026-01-01') is midnight UTC, which is 31 December in New York.
  const formatted = formatCell({ CloseDate: '2026-01-01' }, dateColumn, 'en-US', 'America/New_York');
  expect(formatted).toBe('1/1/2026');
});

test('a blank value formats as empty, never as "null" or "Invalid Date"', () => {
  expect(formatCell({ CloseDate: null }, dateColumn, 'en-US', 'UTC')).toBe('');
  expect(formatCell({ CloseDate: '' }, dateColumn, 'en-US', 'UTC')).toBe('');
});

test('booleans read as words, because a raw true in a cell helps nobody', () => {
  const column: ColumnDefinition = { apiName: 'IsActive', label: 'Active', type: 'boolean', sortable: false };
  expect(formatCell({ IsActive: true }, column, 'en-US', 'UTC')).toBe('Yes');
  // false is a real value, not a blank -- the guard above must not swallow it.
  expect(formatCell({ IsActive: false }, column, 'en-US', 'UTC')).toBe('No');
});
