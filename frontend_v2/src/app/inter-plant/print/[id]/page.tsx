'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

export default function InterPlantStandalonePrintPage() {
    const params = useParams();
    const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [popupBlocked, setPopupBlocked] = useState(false);

    const challanId = String(params?.id || '');
    const pdfUrl = `/api/inventory/inter-plant/${challanId}/print-pdf/`;

    useEffect(() => {
        let mounted = true;
        let objectUrl: string | null = null;

        const fetchPdf = async () => {
            setLoading(true);
            setLoadError(null);
            try {
                const { data } = await api.get(pdfUrl, { responseType: 'blob' });
                objectUrl = URL.createObjectURL(data);
                if (mounted) {
                    setPdfBlobUrl(objectUrl);
                }
            } catch (err: any) {
                let message = 'Unable to load PDF preview.';
                const raw = err?.response?.data;
                if (raw instanceof Blob) {
                    try {
                        const text = await raw.text();
                        const parsed = JSON.parse(text);
                        message = parsed?.error || parsed?.detail || message;
                    } catch {
                        // Keep default message
                    }
                } else if (typeof raw === 'object' && raw) {
                    message = raw?.error || raw?.detail || message;
                }
                if (mounted) {
                    setLoadError(message);
                }
            } finally {
                if (mounted) {
                    setLoading(false);
                }
            }
        };

        fetchPdf();

        return () => {
            mounted = false;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [pdfUrl]);

    const triggerPrint = () => {
        if (typeof window === 'undefined') return;
        setPopupBlocked(false);
        const popup = window.open(pdfBlobUrl || pdfUrl, '_blank', 'noopener,noreferrer');
        if (popup) {
            popup.focus();
            setTimeout(() => {
                try {
                    popup.print();
                } catch {
                    // Native PDF viewers can block script print; user can still print manually.
                }
            }, 300);
        } else {
            setPopupBlocked(true);
        }
    };

    return (
        <div className="h-screen w-full bg-white flex flex-col">
            <div className="p-3 border-b bg-white flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-slate-700">Inter-Plant DC Print Preview</div>
                <div className="flex items-center gap-2">
                    {pdfBlobUrl && (
                        <a
                            href={pdfBlobUrl}
                            download
                            className="text-xs border rounded-md px-3 py-1.5 text-slate-700 hover:bg-slate-50"
                        >
                            Download PDF
                        </a>
                    )}
                    <Button size="sm" onClick={triggerPrint} disabled={loading}>
                        {loading ? 'Loading PDF...' : 'Print DC'}
                    </Button>
                </div>
            </div>
            {popupBlocked && (
                <div className="px-3 py-2 text-xs text-amber-700 border-b bg-amber-50">
                    Popup blocked by browser. Use Download PDF and print from the opened file.
                </div>
            )}
            {loadError ? (
                <div className="p-4 text-sm text-red-600">{loadError}</div>
            ) : (
                <object data={pdfBlobUrl || undefined} type="application/pdf" className="w-full flex-1">
                    <div className="p-4 text-sm">
                        PDF preview unavailable. Use <span className="font-semibold">Download PDF</span>.
                    </div>
                </object>
            )}
        </div>
    );
}
