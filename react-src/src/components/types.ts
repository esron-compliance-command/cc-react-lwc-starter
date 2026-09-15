/**
 * The contract between Apex and React, written once, in TypeScript.
 *
 * Every one of these shapes is produced by StarterListController and consumed here. When you change
 * the Apex, change this file in the same commit -- a drifted type is a runtime blank column that no
 * test catches.
 */

export interface GridConfig {
  /** API name of the object to list, e.g. "Account". Unprefixed by convention. */
  objectApiName: string;
  caption: string;
}

export interface ColumnDefinition {
  apiName: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'datetime' | 'boolean' | 'reference';
  sortable: boolean;
}

/** A row is a bag of primitives keyed by column apiName. Never an SObject -- see NamespaceNote in README. */
export type GridRow = Record<string, string | number | boolean | null>;

export interface ListEnvelope {
  columns: ColumnDefinition[];
  rows: GridRow[];
  totalCount: number;
  pageNumber: number;
  pageSize: number;
}

export interface SortState {
  apiName: string;
  direction: 'asc' | 'desc';
}

export interface ListRequest {
  objectApiName: string;
  search: string;
  sort?: SortState;
  pageNumber: number;
  pageSize: number;
}

export function emptyEnvelope(): ListEnvelope {
  return { columns: [], rows: [], totalCount: 0, pageNumber: 1, pageSize: 10 };
}
