interface BoundedPagerProps {
  activePage: number;
  pageCount: number;
  label: string;
  onPageChange: (page: number) => void;
}

export default function BoundedPager({
  activePage,
  pageCount,
  label,
  onPageChange,
}: BoundedPagerProps) {
  if (pageCount <= 1) return null;

  return (
    <div className="cockpit-blotter__pagination" role="group" aria-label={label}>
      <button
        type="button"
        disabled={activePage === 0}
        onClick={() => onPageChange(activePage - 1)}
      >
        ‹
      </button>
      <span className="num">{activePage + 1} / {pageCount}</span>
      <button
        type="button"
        disabled={activePage >= pageCount - 1}
        onClick={() => onPageChange(activePage + 1)}
      >
        ›
      </button>
    </div>
  );
}
