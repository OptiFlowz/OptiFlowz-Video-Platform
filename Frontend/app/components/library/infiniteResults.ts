type PageMetadata = {
  pagination?: {
    total?: number;
    totalPages?: number;
    total_pages?: number;
    hasNextPage?: boolean;
    limit?: number;
  };
  total?: number;
  total_pages?: number;
};

export function uniqueResults<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function nextResultsPage<T extends PageMetadata>(
  lastPage: T,
  pages: T[],
  page: number,
  limit: number,
  getItems: (response: T) => { id: string }[],
): number | undefined {
  const items = getItems(lastPage);
  if (!items.length) return undefined;

  // Rankings can shift between requests; don't keep loading a repeated page.
  const previousIds = new Set(pages.slice(0, -1).flatMap(getItems).map(item => item.id));
  if (items.every(item => previousIds.has(item.id))) return undefined;

  const metadata = lastPage.pagination;
  const totalPages = metadata?.totalPages ?? metadata?.total_pages ?? lastPage.total_pages;
  const total = metadata?.total ?? lastPage.total;
  const pageSize = metadata?.limit && metadata.limit > 0 ? metadata.limit : limit;
  if (totalPages !== undefined && page >= totalPages) return undefined;
  if (total !== undefined && page * pageSize >= total) return undefined;
  if (metadata?.hasNextPage === false) return undefined;
  if (totalPages === undefined && total === undefined && metadata?.hasNextPage !== true && items.length < pageSize) return undefined;
  return page + 1;
}
