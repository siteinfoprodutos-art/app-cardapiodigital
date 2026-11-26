import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, Download, ExternalLink, QrCode } from 'lucide-react';

interface QrCodeGeneratorProps {
  nomeEstabelecimento: string;
  slug: string;
  onOpenMenu: (slug: string) => void;
}

export function QrCodeGenerator({
  nomeEstabelecimento,
  slug,
  onOpenMenu,
}: QrCodeGeneratorProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);

  const menuUrl = `${window.location.origin}/${slug}`;

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(menuUrl, {
      width: 640,
      margin: 2,
      color: {
        dark: '#0F172A',
        light: '#FFFFFF',
      },
      errorCorrectionLevel: 'M',
    })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {
        if (active) setQrDataUrl('');
      });
    return () => {
      active = false;
    };
  }, [menuUrl]);

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(menuUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback silencioso se clipboard API não estiver disponível
    }
  };

  const handleDownload = () => {
    if (!qrDataUrl) return;
    const link = document.createElement('a');
    link.href = qrDataUrl;
    link.download = `qrcode-${slug}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 md:p-8 max-w-2xl">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">QR Code do cardápio</h2>
          <p className="text-sm text-slate-600 mt-1">
            Imprima para mesas, embalagens ou balcão. O cliente aponta a câmera e abre o cardápio direto no celular.
          </p>
        </div>
        <QrCode className="w-6 h-6 text-slate-400 shrink-0" />
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-8">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shrink-0 flex flex-col items-center">
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt={`QR Code do cardápio ${nomeEstabelecimento}`}
              className="w-48 h-48 object-contain"
            />
          ) : (
            <div className="w-48 h-48 bg-slate-100 rounded-xl flex items-center justify-center text-xs text-slate-500">
              Gerando QR Code...
            </div>
          )}
          <span className="mt-2 text-xs font-medium text-slate-700 text-center max-w-[180px] truncate">
            {nomeEstabelecimento}
          </span>
        </div>

        <div className="flex-1 w-full space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">
              Link direto do seu cardápio
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={menuUrl}
                aria-label="Link direto do cardápio"
                className="w-full px-3.5 py-2.5 text-sm font-mono-code bg-slate-50 border border-slate-200 rounded-xl text-slate-700 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleCopyUrl}
                className="min-h-[44px] px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 text-sm font-medium inline-flex items-center gap-2 shrink-0 whitespace-nowrap transition-colors"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-700" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Copiado' : 'Copiar'}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <button
              type="button"
              onClick={handleDownload}
              disabled={!qrDataUrl}
              className="min-h-[44px] px-5 py-2.5 rounded-xl bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 text-sm font-medium inline-flex items-center gap-2 whitespace-nowrap transition-colors"
            >
              <Download className="w-4 h-4" />
              Baixar PNG
            </button>

            <button
              type="button"
              onClick={() => onOpenMenu(slug)}
              className="min-h-[44px] px-5 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 text-sm font-medium inline-flex items-center gap-2 whitespace-nowrap transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              Abrir cardápio
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
