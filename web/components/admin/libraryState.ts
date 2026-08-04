export interface LibraryRequestState {
  generation: number;
  page: number;
  pageSize: number;
}

export function clampLibraryPage(page: number, total: number, pageSize: number): number {
  const safePage = Math.max(0, Math.trunc(page) || 0);
  const safeTotal = Math.max(0, Math.trunc(total) || 0);
  const safePageSize = Math.max(1, Math.trunc(pageSize) || 1);
  const lastPage = safeTotal === 0 ? 0 : Math.ceil(safeTotal / safePageSize) - 1;
  return Math.min(safePage, lastPage);
}

export function beginLibraryRequest(
  state: LibraryRequestState,
): { generation: number; offset: number } {
  const generation = state.generation + 1;
  const page = Math.max(0, Math.trunc(state.page) || 0);
  const pageSize = Math.max(1, Math.trunc(state.pageSize) || 1);
  return { generation, offset: page * pageSize };
}

export function acceptLibraryResponse(
  activeGeneration: number,
  responseGeneration: number,
): boolean {
  return activeGeneration === responseGeneration;
}
