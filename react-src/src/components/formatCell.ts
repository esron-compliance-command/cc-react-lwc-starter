/**
 * Formatting lives in ONE place, not inline in the table body.
 *
 * Locale and time zone come from the running Salesforce user, handed over by the host as
 * @salesforce/i18n values. Do not reach for the browser's locale: a user in Chennai whose
 * Salesforce locale is en_US must see the dates their colleagues see.
 */
import type { ColumnDefinition, GridRow } from './types';

export function formatCell(
  row: GridRow,
  column: ColumnDefinition,
  locale: string,
  timeZone: string
): string {
  const value = row[column.apiName];
  if (value === null || value === undefined || value === '') return '';

  switch (column.type) {
    case 'boolean':
      return value ? 'Yes' : 'No';
    case 'number':
      return new Intl.NumberFormat(locale).format(Number(value));
    case 'date':
      // A Salesforce Date has no time zone. Appending T00:00:00Z and formatting in UTC stops it
      // shifting a day backwards for users west of GMT -- a bug class this team has shipped before.
      return new Intl.DateTimeFormat(locale, { timeZone: 'UTC' }).format(
        new Date(`${String(value)}T00:00:00Z`)
      );
    case 'datetime':
      return new Intl.DateTimeFormat(locale, {
        timeZone,
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(String(value)));
    default:
      return String(value);
  }
}
