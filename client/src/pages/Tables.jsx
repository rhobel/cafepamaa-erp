import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { Badge, Button } from '../components/ui.jsx';
import { STATUS } from './admin/Tables.jsx';
import './admin/Tables.css';

/** Live table status grid (polls every 10s). With onPick, Available tables are tappable. */
export function LiveTables({ onPick }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['tables'],
    queryFn: () => api('/tables'),
    refetchInterval: 10000,
  });
  const tables = (data ?? []).filter((t) => t.isActive);

  if (isLoading) {
    return (
      <div className="tgrid" aria-busy="true">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="tcard">
            <span className="skeleton" />
          </div>
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <div className="panel pad tempty">
        <p>Couldn't load tables: {error.message}</p>
        <Button onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }
  if (!tables.length) {
    return <div className="panel pad tempty muted">No tables set up yet.</div>;
  }

  return (
    <div className="stack">
      <div className="row" aria-hidden="true">
        {Object.entries(STATUS).map(([k, [tone, label]]) => (
          <Badge key={k} tone={tone}>
            {label}
          </Badge>
        ))}
      </div>
      <div className="tgrid">
        {tables.map((t) => {
          const [tone, label] = STATUS[t.status] ?? STATUS.available;
          const free = t.status === 'available';
          const Tag = onPick ? 'button' : 'div';
          return (
            <Tag
              key={t._id}
              {...(onPick && {
                type: 'button',
                disabled: !free,
                onClick: () => onPick(t),
                'aria-label': `Table ${t.tableNumber}, ${label}`,
              })}
              className={`tcard ${free ? '' : tone}`}
              title={label}
            >
              <b>{t.tableNumber}</b>
              <Badge tone={tone}>{label}</Badge>
              <small>
                {t.capacity} {t.capacity === 1 ? 'seat' : 'seats'}
                {t.section && ` · ${t.section}`}
              </small>
            </Tag>
          );
        })}
      </div>
    </div>
  );
}

export function TablesStatusPage() {
  return <LiveTables />;
}
