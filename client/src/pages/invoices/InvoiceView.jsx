import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { Button, useToast } from '../../components/ui.jsx';
import { InvoiceDocument } from './Invoice.jsx';

const PAGE = {
  '80mm': '@page { size: 80mm auto; margin: 4mm; }',
  A4: '@page { size: A4; margin: 12mm; }',
};

export function InvoiceViewPage() {
  const { id } = useParams();
  const location = useLocation();
  const qc = useQueryClient();
  const toast = useToast();
  const [format, setFormat] = useState(null); // null → settings default
  const [printedFresh, setPrintedFresh] = useState(false);
  const [printReq, setPrintReq] = useState(0);

  const query = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => api(`/invoices/${id}`),
    retry: (n, e) => e.status !== 404 && n < 2,
  });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api('/settings') });
  const fmt = format ?? (settings.data?.printFormat === 'A4' ? 'A4' : '80mm');
  // Only the first print straight after generation is the original; everything else is a duplicate.
  const fresh = !!location.state?.fresh && !printedFresh;

  // Paper size for this print (also covers Ctrl+P). Removed when leaving the page.
  useEffect(() => {
    let el = document.getElementById('print-page');
    if (!el) {
      el = document.createElement('style');
      el.id = 'print-page';
      document.head.appendChild(el);
    }
    el.textContent = PAGE[fmt];
  }, [fmt]);
  useEffect(() => () => document.getElementById('print-page')?.remove(), []);

  // Print after React has committed the reprinted invoice (with the DUPLICATE banner).
  useEffect(() => {
    if (!printReq) return;
    const raf = requestAnimationFrame(() => window.print());
    return () => cancelAnimationFrame(raf);
  }, [printReq]);

  const reprint = useMutation({
    mutationFn: () => api(`/invoices/${id}/reprint`, { method: 'POST' }),
    onSuccess: (inv) => {
      qc.setQueryData(['invoice', id], inv);
      qc.invalidateQueries({ queryKey: ['invoices'] });
      setPrintReq((n) => n + 1);
    },
    onError: (e) => toast(e.message, 'error'),
  });

  const onPrint = () => {
    if (!fresh) return reprint.mutate();
    window.print(); // original: banner not shown yet; blocks until the dialog closes
    setPrintedFresh(true);
  };

  if (query.isPending) return <div className="panel pad muted">Loading invoice…</div>;
  if (query.isError)
    return query.error.status === 404 ? (
      <div className="center-msg">
        <h1>Invoice not found</h1>
        <p>The link may be wrong.</p>
        <Link className="btn" to="/bills">
          Back to Running Bills
        </Link>
      </div>
    ) : (
      <div className="panel pad">
        <p>Could not load invoice: {query.error.message}</p>
        <Button onClick={() => query.refetch()}>Retry</Button>
      </div>
    );

  return (
    <div className="inv-page">
      <div className="inv-toolbar no-print">
        <Link className="btn" to="/bills">
          ← Back to Running Bills
        </Link>
        <span className="inv-grow" />
        <div className="seg" role="group" aria-label="Print format">
          {['80mm', 'A4'].map((f) => (
            <button key={f} type="button" aria-pressed={fmt === f} onClick={() => setFormat(f)}>
              {f}
            </button>
          ))}
        </div>
        <Button variant="primary" loading={reprint.isPending} onClick={onPrint}>
          {fresh ? 'Print' : 'Reprint (duplicate)'}
        </Button>
      </div>
      <div className="inv-preview">
        <InvoiceDocument invoice={query.data} format={fmt} duplicate={!fresh} />
      </div>
    </div>
  );
}
