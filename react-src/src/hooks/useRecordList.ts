/**
 * Owns every piece of list state: search, sort, paging, rows, and the three states that are not
 * rows (loading, empty, error).
 *
 * All of it is SERVER-DRIVEN. Sorting a column or typing in search issues a new fetchList call; this
 * hook never sorts or filters the rows it already holds, because those rows are one page out of
 * many and re-ordering them client-side silently lies about the other pages. That is the single
 * habit most worth carrying over from this file.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { emptyEnvelope, type GridConfig, type ListEnvelope, type SortState } from '../components/types';
import { fetchList } from '../services/bridge';

const SEARCH_DEBOUNCE_MS = 300;
const PAGE_SIZE = 10;

export interface UseRecordListResult {
  envelope: ListEnvelope;
  isLoading: boolean;
  error: string | null;
  search: string;
  setSearch: (value: string) => void;
  sort: SortState | undefined;
  toggleSort: (apiName: string) => void;
  pageNumber: number;
  setPageNumber: (page: number) => void;
  totalPages: number;
  refresh: () => void;
}

export function useRecordList(config: GridConfig): UseRecordListResult {
  const [envelope, setEnvelope] = useState<ListEnvelope>(emptyEnvelope);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearchRaw] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sort, setSort] = useState<SortState | undefined>(undefined);
  const [pageNumber, setPageNumber] = useState(1);
  const [reloadToken, setReloadToken] = useState(0);

  const debounceHandle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Every request gets a sequence number. A slow response that lands after a newer one has already
  // rendered is DISCARDED rather than allowed to overwrite the screen. Without this, typing fast
  // into search leaves you looking at results for a prefix you no longer have in the box.
  const requestSeq = useRef(0);

  const setSearch = useCallback((value: string) => {
    setSearchRaw(value);
    setPageNumber(1); // a new search always starts back at page one
    if (debounceHandle.current) clearTimeout(debounceHandle.current);
    debounceHandle.current = setTimeout(() => setDebouncedSearch(value), SEARCH_DEBOUNCE_MS);
  }, []);

  const toggleSort = useCallback((apiName: string) => {
    setPageNumber(1);
    setSort((current) =>
      current?.apiName === apiName
        ? { apiName, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { apiName, direction: 'asc' }
    );
  }, []);

  const refresh = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    const seq = ++requestSeq.current;
    let cancelled = false;
    setIsLoading(true);

    fetchList({
      objectApiName: config.objectApiName,
      search: debouncedSearch,
      sortState: sort,
      pageNumber,
      pageSize: PAGE_SIZE,
    })
      .then((next) => {
        if (cancelled || seq !== requestSeq.current) return;
        setEnvelope(next);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled || seq !== requestSeq.current) return;
        // Apex surfaces its message as `body.message`; anything else is a genuine JS error.
        const message =
          (e as { body?: { message?: string } })?.body?.message ??
          (e instanceof Error ? e.message : 'This list could not be loaded.');
        setError(message);
      })
      .finally(() => {
        if (!cancelled && seq === requestSeq.current) setIsLoading(false);
      });

    // StrictMode runs this effect twice in development on purpose. The cleanup below is what makes
    // that harmless -- if it is missing, you see a double fetch and blame the framework.
    return () => {
      cancelled = true;
    };
  }, [config.objectApiName, debouncedSearch, sort, pageNumber, reloadToken]);

  useEffect(() => () => clearTimeout(debounceHandle.current), []);

  const totalPages = Math.max(1, Math.ceil(envelope.totalCount / (envelope.pageSize || PAGE_SIZE)));

  return {
    envelope, isLoading, error,
    search, setSearch,
    sort, toggleSort,
    pageNumber, setPageNumber, totalPages,
    refresh,
  };
}
