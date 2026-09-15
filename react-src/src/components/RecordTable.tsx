/**
 * The table. It renders; it does not decide. Every piece of state it shows comes from useRecordList.
 *
 * Accessibility is not decoration here: the Experience Cloud sites this pattern ships to are used by
 * customers, and a sortable header that is a <div> with an onClick cannot be reached by keyboard.
 * Sortable headers are <button>s inside <th scope="col">, and aria-sort tells a screen reader which
 * way the list is ordered.
 */
import { useMemo } from 'react';
import { useRecordList } from '../hooks/useRecordList';
import { formatCell } from './formatCell';
import { getBridge } from '../services/bridge';
import type { GridConfig } from './types';
import './RecordTable.css';

export function RecordTable({ config }: { config: GridConfig }) {
  const list = useRecordList(config);
  const { envelope, isLoading, error } = list;

  const { locale, timeZone } = useMemo(() => {
    const bridge = getBridge();
    return { locale: bridge.locale, timeZone: bridge.timeZone };
  }, []);

  return (
    <div className="rg-root">
      <div className="rg-toolbar">
        <h2 className="rg-caption">{config.caption}</h2>
        <input
          id="rg-search"
          className="rg-search"
          type="search"
          value={list.search}
          placeholder="Search"
          aria-label={`Search ${config.caption}`}
          onChange={(e) => list.setSearch(e.target.value)}
        />
        <span className="rg-count">
          {envelope.totalCount} {envelope.totalCount === 1 ? 'record' : 'records'}
        </span>
      </div>

      {error ? (
        <div className="rg-error" role="alert">
          <p>{error}</p>
          <button type="button" onClick={list.refresh}>
            Try again
          </button>
        </div>
      ) : null}

      <div className="rg-scroll">
        <table className="rg-table">
          <caption className="rg-visually-hidden">{config.caption}</caption>
          <thead>
            <tr>
              {envelope.columns.map((column) => {
                const active = list.sort?.apiName === column.apiName;
                const ariaSort = active
                  ? list.sort?.direction === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : 'none';
                return (
                  <th key={column.apiName} scope="col" aria-sort={ariaSort}>
                    {column.sortable ? (
                      <button
                        type="button"
                        className="rg-sortable"
                        onClick={() => list.toggleSort(column.apiName)}
                      >
                        {column.label}
                        {active ? (
                          <span className="rg-dir" aria-hidden="true">
                            {list.sort?.direction === 'asc' ? '↑' : '↓'}
                          </span>
                        ) : null}
                      </button>
                    ) : (
                      column.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {envelope.rows.map((row) => (
              <tr key={String(row.Id)}>
                {envelope.columns.map((column) => (
                  <td key={column.apiName}>{formatCell(row, column, locale, timeZone)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Loading and empty are distinct renders. Collapsing them into one is how a broken query ends
          up looking like a customer who simply has no data. */}
      {isLoading && envelope.rows.length === 0 ? (
        <p className="rg-state">Loading records...</p>
      ) : null}
      {!isLoading && !error && envelope.rows.length === 0 ? (
        <p className="rg-state">
          {list.search ? `No records match "${list.search}".` : 'There are no records yet.'}
        </p>
      ) : null}

      <div className="rg-pager">
        <button
          type="button"
          onClick={() => list.setPageNumber(list.pageNumber - 1)}
          disabled={list.pageNumber <= 1 || isLoading}
        >
          Previous
        </button>
        <span className="rg-page">
          Page {list.pageNumber} of {list.totalPages}
        </span>
        <button
          type="button"
          onClick={() => list.setPageNumber(list.pageNumber + 1)}
          disabled={list.pageNumber >= list.totalPages || isLoading}
        >
          Next
        </button>
      </div>
    </div>
  );
}
