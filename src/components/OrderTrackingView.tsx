import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  AlertCircle,
  Ban,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  Loader2,
  MapPin,
  MessageCircle,
  QrCode,
  RefreshCw,
  ShoppingBag,
  Store,
  Truck,
  Upload,
} from 'lucide-react';
import {
  isSupabaseConfigured,
  supabase,
  translateSupabaseError,
  uploadPixReceipt,
} from '../lib/supabase';
import {
  formatBRL,
  formatSaoPauloTime,
  normalizeWhatsAppDigits,
  type OrderTrackingData,
  type OrderTrackingLoja,
  type PedidoEvento,
  type PedidoItem,
  resolveStoreTheme,
} from '../types/menu';

interface OrderTrackingViewProps {
  token: string;
}

interface TimelineStep {
  key: string;
  label: string;
  kind: 'status' | 'pago';
  rank?: number;
}

function normalizeTrackingPayload(
  rawInput: unknown,
  fallbackToken: string
): OrderTrackingData | null {
  const candidate = Array.isArray(rawInput) ? rawInput[0] : rawInput;
  if (!candidate || typeof candidate !== 'object') return null;

  const root = candidate as Record<string, unknown>;
  const pedidoObj =
    root.pedido && typeof root.pedido === 'object'
      ? (root.pedido as Record<string, unknown>)
      : root;
  const lojaObj =
    (root.loja && typeof root.loja === 'object'
      ? (root.loja as Record<string, unknown>)
      : root.estabelecimento && typeof root.estabelecimento === 'object'
      ? (root.estabelecimento as Record<string, unknown>)
      : {}) || {};

  const numeroRaw = pedidoObj.numero ?? root.numero;
  if (numeroRaw === undefined || numeroRaw === null) return null;

  const rawEventos = Array.isArray(root.eventos)
    ? root.eventos
    : Array.isArray(pedidoObj.eventos)
    ? pedidoObj.eventos
    : [];

  const eventos: PedidoEvento[] = rawEventos
    .filter((ev) => ev && typeof ev === 'object')
    .map((ev) => {
      const e = ev as Record<string, unknown>;
      return {
        tipo: String(e.tipo ?? e.status ?? e.evento ?? '').trim(),
        created_at:
          (e.created_at as string | null | undefined) ??
          (e.horario as string | null | undefined) ??
          (e.data as string | null | undefined) ??
          null,
      };
    })
    .filter((e) => Boolean(e.tipo));

  const loja: OrderTrackingLoja = {
    nome: String(lojaObj.nome || root.estabelecimento_nome || 'Estabelecimento'),
    slug: (lojaObj.slug as string | null | undefined) ?? null,
    whatsapp: (lojaObj.whatsapp as string | null | undefined) ?? null,
    chave_pix: (lojaObj.chave_pix as string | null | undefined) ?? null,
    logo_url: (lojaObj.logo_url as string | null | undefined) ?? null,
    tema: (lojaObj.tema as string | null | undefined) ?? null,
    cor_primaria: (lojaObj.cor_primaria as string | null | undefined) ?? null,
    cor_secundaria: (lojaObj.cor_secundaria as string | null | undefined) ?? null,
  };

  const rawTipo = String(pedidoObj.tipo || 'entrega').toLowerCase();
  const tipo = rawTipo === 'retirada' ? 'retirada' : 'entrega';

  const rawPagamento = String(
    pedidoObj.forma_pagamento ?? pedidoObj.pagamento ?? 'na_entrega'
  );

  const rawItens = Array.isArray(pedidoObj.itens) ? (pedidoObj.itens as PedidoItem[]) : [];

  return {
    numero: Number(numeroRaw),
    token: String(pedidoObj.token || fallbackToken),
    cliente: (pedidoObj.cliente as string | null | undefined) ?? null,
    tipo,
    endereco: (pedidoObj.endereco as string | null | undefined) ?? null,
    bairro: (pedidoObj.bairro as string | null | undefined) ?? null,
    forma_pagamento: rawPagamento,
    obs: (pedidoObj.obs as string | null | undefined) ?? null,
    itens: rawItens,
    subtotal: Number(pedidoObj.subtotal) || 0,
    taxa_entrega: Number(pedidoObj.taxa_entrega) || 0,
    total: Number(pedidoObj.total) || 0,
    status: String(pedidoObj.status || 'novo'),
    pago: Boolean(pedidoObj.pago),
    comprovante_enviado: Boolean(
      pedidoObj.comprovante_enviado ?? pedidoObj.comprovante_path
    ),
    created_at: String(pedidoObj.created_at || new Date().toISOString()),
    loja,
    eventos,
  };
}

function normalizeItems(rawItens: PedidoItem[]): Array<{
  nome: string;
  qtd: number;
  subtotal: number | null;
  obs: string;
}> {
  if (!Array.isArray(rawItens)) return [];
  return rawItens.map((it) => {
    const qtd = Number(it.qtd ?? it.quantidade ?? 1) || 1;
    const nome = String(it.nome || it.produto_nome || 'Item');
    const obs = String(it.obs ?? it.observacao ?? '').trim();
    const unitPrice =
      it.preco !== undefined && it.preco !== null
        ? Number(it.preco)
        : it.preco_unitario !== undefined && it.preco_unitario !== null
        ? Number(it.preco_unitario)
        : null;
    const subtotal =
      it.subtotal !== undefined && it.subtotal !== null
        ? Number(it.subtotal)
        : unitPrice !== null && Number.isFinite(unitPrice)
        ? unitPrice * qtd
        : null;
    return { nome, qtd, subtotal, obs };
  });
}

function getStatusRank(status: string, tipo: 'entrega' | 'retirada'): number {
  if (tipo === 'retirada') {
    switch (status) {
      case 'novo':
        return 0;
      case 'em_preparo':
        return 1;
      case 'pronto':
      case 'pronto_retirada':
        return 2;
      case 'entregue':
        return 3;
      default:
        return -1;
    }
  }

  switch (status) {
    case 'novo':
      return 0;
    case 'em_preparo':
      return 1;
    case 'pronto':
      return 2;
    case 'saiu_entrega':
      return 3;
    case 'entregue':
      return 4;
    default:
      return -1;
  }
}

export function OrderTrackingView({ token }: OrderTrackingViewProps) {
  const [order, setOrder] = useState<OrderTrackingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date>(new Date());
  const [logoImgError, setLogoImgError] = useState(false);

  const [pixCopied, setPixCopied] = useState(false);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [showReuploadForm, setShowReuploadForm] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastFetchTimeRef = useRef<number>(0);

  const fetchOrder = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!isSupabaseConfigured || !supabase) {
        setErrorMsg('Conexão com o servidor indisponível.');
        setLoading(false);
        return;
      }

      if (!options.silent) {
        setRefreshing(true);
      }

      try {
        lastFetchTimeRef.current = Date.now();
        const { data, error } = await supabase.rpc('acompanhar_pedido', {
          p_token: token,
        });

        if (error) {
          console.error('Erro RPC acompanhar_pedido:', error);
          if (!options.silent) {
            setErrorMsg(
              translateSupabaseError(error, 'Não foi possível carregar os dados do pedido.')
            );
          }
          return;
        }

        const normalized = normalizeTrackingPayload(data, token);
        if (!normalized) {
          setOrder(null);
          setNotFound(true);
          setErrorMsg(null);
          return;
        }

        setNotFound(false);
        setErrorMsg(null);
        setOrder(normalized);
        setLastUpdatedAt(new Date());
      } catch (err) {
        console.error('Erro inesperado ao acompanhar pedido:', err);
        if (!options.silent) {
          setErrorMsg(
            translateSupabaseError(err, 'Não foi possível carregar o acompanhamento do pedido.')
          );
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token]
  );

  useEffect(() => {
    setLoading(true);
    setNotFound(false);
    setErrorMsg(null);
    setLogoImgError(false);
    setShowReuploadForm(false);
    setReceiptError(null);
    fetchOrder();
  }, [fetchOrder]);

  const isTerminalStatus =
    order?.status === 'entregue' || order?.status === 'cancelado';

  // Atualização automática a cada 15s enquanto visível e não entregue/cancelado
  useEffect(() => {
    if (!order || isTerminalStatus) return;

    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchOrder({ silent: true });
      }
    }, 15_000);

    const handleResume = () => {
      if (document.visibilityState === 'visible') {
        const elapsed = Date.now() - lastFetchTimeRef.current;
        if (elapsed >= 1500) {
          fetchOrder({ silent: true });
        }
      }
    };

    document.addEventListener('visibilitychange', handleResume);
    window.addEventListener('focus', handleResume);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', handleResume);
      window.removeEventListener('focus', handleResume);
    };
  }, [order, isTerminalStatus, fetchOrder]);

  const theme = useMemo(
    () => resolveStoreTheme(order?.loja || null),
    [order?.loja]
  );

  const themeCssVars = useMemo(
    () =>
      ({
        '--menu-bg': theme.bg,
        '--menu-card': theme.cardBg,
        '--menu-text': theme.text,
        '--menu-muted': theme.mutedText,
        '--menu-accent': theme.accent,
        '--menu-accent-text': theme.accentText,
        '--menu-secondary': theme.secondary,
        '--menu-secondary-text': theme.secondaryText,
        '--menu-border': theme.border,
        '--menu-pill-bg': theme.pillBg,
        '--menu-pill-text': theme.pillText,
        '--menu-input-bg': theme.inputBg,
        backgroundColor: 'var(--menu-bg)',
        color: 'var(--menu-text)',
      }) as CSSProperties,
    [theme]
  );

  const eventTimeMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!order?.eventos) return map;
    for (const ev of order.eventos) {
      if (ev.tipo && ev.created_at && !map.has(ev.tipo)) {
        map.set(ev.tipo, formatSaoPauloTime(ev.created_at));
      }
    }
    return map;
  }, [order?.eventos]);

  const timelineSteps = useMemo<TimelineStep[]>(() => {
    if (!order) return [];
    const includePaymentStep =
      order.forma_pagamento === 'pix' || order.forma_pagamento === 'link';

    const steps: TimelineStep[] = [
      { key: 'novo', label: 'Pedido recebido', kind: 'status', rank: 0 },
    ];

    if (includePaymentStep) {
      steps.push({
        key: 'pago',
        label: 'Pagamento confirmado',
        kind: 'pago',
      });
    }

    steps.push({
      key: 'em_preparo',
      label: 'Em preparação',
      kind: 'status',
      rank: 1,
    });

    if (order.tipo === 'retirada') {
      steps.push(
        {
          key: 'pronto_retirada',
          label: 'Pronto para retirada',
          kind: 'status',
          rank: 2,
        },
        { key: 'entregue', label: 'Retirado', kind: 'status', rank: 3 }
      );
    } else {
      steps.push(
        { key: 'pronto', label: 'Pedido pronto', kind: 'status', rank: 2 },
        {
          key: 'saiu_entrega',
          label: 'Saiu para entrega',
          kind: 'status',
          rank: 3,
        },
        { key: 'entregue', label: 'Entregue', kind: 'status', rank: 4 }
      );
    }

    return steps;
  }, [order]);

  const handleCopyPix = async () => {
    const pixKey = order?.loja.chave_pix;
    if (!pixKey) return;
    try {
      await navigator.clipboard.writeText(pixKey);
      setPixCopied(true);
      setTimeout(() => setPixCopied(false), 2000);
    } catch {
      // Ignorar falha de clipboard
    }
  };

  const handleReceiptFileSelected = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !order || !supabase) return;

    setReceiptError(null);
    setUploadingReceipt(true);

    try {
      const { path } = await uploadPixReceipt(file, order.token || token);

      const { error: rpcError } = await supabase.rpc('registrar_comprovante', {
        p_token: order.token || token,
        p_path: path,
      });

      if (rpcError) {
        console.error('Erro RPC registrar_comprovante:', rpcError);
        setReceiptError(
          translateSupabaseError(
            rpcError,
            'Não foi possível registrar o comprovante. Tente novamente.'
          )
        );
        return;
      }

      setShowReuploadForm(false);
      setOrder((prev) => (prev ? { ...prev, comprovante_enviado: true } : prev));
      await fetchOrder({ silent: true });
    } catch (err) {
      console.error('Erro ao enviar comprovante Pix:', err);
      setReceiptError(
        err instanceof Error
          ? err.message
          : 'Erro ao enviar comprovante. Verifique sua conexão e tente novamente.'
      );
    } finally {
      setUploadingReceipt(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <Loader2 className="w-8 h-8 animate-spin text-slate-700 mx-auto" />
          <p className="text-sm font-medium text-slate-600">
            Carregando acompanhamento do pedido...
          </p>
        </div>
      </div>
    );
  }

  if (notFound || (!order && !errorMsg)) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-3 shadow-sm">
          <ShoppingBag className="w-10 h-10 text-slate-400 mx-auto" />
          <h1 className="text-lg font-bold text-slate-900">Pedido não encontrado</h1>
          <p className="text-sm text-slate-600">
            Confira o link de acompanhamento enviado pelo estabelecimento.
          </p>
        </div>
      </div>
    );
  }

  if (errorMsg && !order) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-4 shadow-sm">
          <AlertCircle className="w-10 h-10 text-rose-500 mx-auto" />
          <div className="space-y-1">
            <h1 className="text-lg font-bold text-slate-900">
              Não foi possível carregar o pedido
            </h1>
            <p className="text-sm text-slate-600">{errorMsg}</p>
          </div>
          <button
            type="button"
            onClick={() => fetchOrder()}
            className="min-h-[44px] px-5 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-bold inline-flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Tentar novamente</span>
          </button>
        </div>
      </div>
    );
  }

  if (!order) return null;

  const hasLogo = Boolean((order.loja.logo_url || '').trim()) && !logoImgError;
  const storeInitial = (order.loja.nome || 'L').trim().charAt(0).toUpperCase();
  const storeWaDigits = normalizeWhatsAppDigits(order.loja.whatsapp || '');
  const storeWhatsappUrl = storeWaDigits
    ? `https://wa.me/${storeWaDigits}?text=${encodeURIComponent(
        `Olá! Sobre o Pedido #${order.numero} em ${order.loja.nome}.`
      )}`
    : null;

  const isCancelled = order.status === 'cancelado';
  const currentRank = getStatusRank(order.status, order.tipo);
  const items = normalizeItems(order.itens);

  return (
    <div style={themeCssVars} className="min-h-screen pb-12 transition-colors duration-200">
      {/* Cabeçalho com identidade da loja */}
      <header
        className="px-4 py-5"
        style={{
          background: theme.coverGradient,
          color: '#FFFFFF',
        }}
      >
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <div
              className="w-14 h-14 rounded-full overflow-hidden shrink-0 flex items-center justify-center shadow-md"
              style={{
                border: '2px solid rgba(255,255,255,0.85)',
                backgroundColor: hasLogo ? '#FFFFFF' : theme.accent,
                color: theme.accentText,
              }}
            >
              {hasLogo ? (
                <img
                  src={order.loja.logo_url!}
                  alt={order.loja.nome}
                  referrerPolicy="no-referrer"
                  onError={() => setLogoImgError(true)}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-xl font-bold">{storeInitial}</span>
              )}
            </div>

            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-white/85 truncate">
                {order.loja.nome}
              </p>
              <h1 className="font-display text-2xl font-bold tracking-tight">
                Pedido #{order.numero}
              </h1>
            </div>
          </div>

          <button
            type="button"
            onClick={() => fetchOrder()}
            disabled={refreshing}
            aria-label="Atualizar status do pedido"
            className="min-h-[40px] px-3.5 py-2 rounded-xl bg-black/30 hover:bg-black/45 backdrop-blur-sm text-white text-xs font-semibold inline-flex items-center gap-1.5 shrink-0 disabled:opacity-60 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>Atualizar</span>
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-5 space-y-5">
        {/* Status de atualização */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs" style={{ color: 'var(--menu-muted)' }}>
          <span className="inline-flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            <span>Atualizado às {formatSaoPauloTime(lastUpdatedAt)}</span>
          </span>
          {!isTerminalStatus && (
            <span>Atualização automática a cada 15s</span>
          )}
        </div>

        {/* Destaque se cancelado */}
        {isCancelled && (
          <div
            role="alert"
            className="p-4 rounded-2xl bg-rose-500/15 border border-rose-500/40 text-rose-700 flex items-start gap-3"
          >
            <Ban className="w-5 h-5 shrink-0 mt-0.5 text-rose-600" />
            <div>
              <p className="text-sm font-bold">Pedido cancelado</p>
              <p className="text-xs mt-0.5">
                {eventTimeMap.get('cancelado')
                  ? `Cancelado às ${eventTimeMap.get('cancelado')}. Em caso de dúvida, fale com a loja.`
                  : 'Este pedido foi cancelado. Em caso de dúvida, fale com a loja.'}
              </p>
            </div>
          </div>
        )}

        {/* Pagamento Pix ou Status de Pagamento */}
        {order.forma_pagamento === 'pix' && (
          <section
            style={{
              backgroundColor: 'var(--menu-card)',
              border: '1px solid var(--menu-border)',
            }}
            className="rounded-2xl p-5 shadow-xs space-y-4"
          >
            {order.pago ? (
              <div className="flex items-center gap-3 text-emerald-700">
                <div className="w-10 h-10 rounded-full bg-emerald-500/15 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <p className="text-sm font-bold">Pagamento confirmado ✓</p>
                  {eventTimeMap.get('pago') && (
                    <p className="text-xs opacity-80">
                      Confirmado às {eventTimeMap.get('pago')}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                      style={{
                        backgroundColor: 'var(--menu-pill-bg)',
                        color: 'var(--menu-accent)',
                      }}
                    >
                      <QrCode className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="text-base font-bold">Pague com Pix</h2>
                      <p className="text-xs" style={{ color: 'var(--menu-muted)' }}>
                        Valor a pagar:{' '}
                        <strong className="tabular-nums" style={{ color: 'var(--menu-text)' }}>
                          {formatBRL(order.total)}
                        </strong>
                      </p>
                    </div>
                  </div>
                </div>

                {(order.loja.chave_pix || '').trim() && (
                  <div className="space-y-1.5">
                    <span className="block text-xs font-semibold" style={{ color: 'var(--menu-muted)' }}>
                      Chave Pix da loja
                    </span>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={order.loja.chave_pix!}
                        aria-label="Chave Pix da loja"
                        style={{
                          backgroundColor: 'var(--menu-input-bg)',
                          color: 'var(--menu-text)',
                          border: '1px solid var(--menu-border)',
                        }}
                        className="w-full min-h-[42px] px-3 py-2 text-xs font-mono rounded-xl"
                      />
                      <button
                        type="button"
                        onClick={handleCopyPix}
                        className="min-h-[42px] px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 shrink-0"
                        style={{
                          backgroundColor: 'var(--menu-accent)',
                          color: 'var(--menu-accent-text)',
                        }}
                      >
                        {pixCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{pixCopied ? 'Copiado!' : 'Copiar'}</span>
                      </button>
                    </div>
                  </div>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleReceiptFileSelected}
                  className="sr-only"
                />

                {order.comprovante_enviado && !showReuploadForm ? (
                  <div className="p-4 rounded-xl bg-emerald-500/12 border border-emerald-500/30 space-y-2.5">
                    <div className="flex items-start gap-2.5 text-emerald-700">
                      <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5 text-emerald-600" />
                      <p className="text-xs sm:text-sm font-semibold">
                        Comprovante enviado! A loja vai conferir e confirmar seu pagamento.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setShowReuploadForm(true);
                        fileInputRef.current?.click();
                      }}
                      disabled={uploadingReceipt}
                      className="text-xs font-bold underline text-emerald-800"
                    >
                      Enviar outro comprovante
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    <button
                      type="button"
                      disabled={uploadingReceipt}
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full min-h-[46px] px-4 py-2.5 rounded-xl font-bold text-sm inline-flex items-center justify-center gap-2 shadow-xs disabled:opacity-60"
                      style={{
                        backgroundColor: 'var(--menu-accent)',
                        color: 'var(--menu-accent-text)',
                      }}
                    >
                      {uploadingReceipt ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Upload className="w-4 h-4" />
                      )}
                      <span>
                        {uploadingReceipt ? 'Enviando comprovante...' : 'Enviar comprovante'}
                      </span>
                    </button>
                    <p className="text-[11px] text-center" style={{ color: 'var(--menu-muted)' }}>
                      Envie a foto ou captura de tela do comprovante Pix.
                    </p>
                  </div>
                )}

                {receiptError && (
                  <div
                    role="alert"
                    className="p-3 rounded-xl bg-rose-500/12 border border-rose-500/30 text-xs font-semibold text-rose-600 flex items-start gap-2"
                  >
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{receiptError}</span>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {/* Aviso pagamento na entrega / retirada */}
        {order.forma_pagamento === 'na_entrega' && (
          <div
            style={{
              backgroundColor: 'var(--menu-card)',
              border: '1px solid var(--menu-border)',
            }}
            className="rounded-2xl px-4 py-3.5 flex items-center gap-3 shadow-xs"
          >
            <CreditCard className="w-5 h-5 shrink-0" style={{ color: 'var(--menu-accent)' }} />
            <span className="text-sm font-semibold">
              {order.tipo === 'entrega' ? 'Pagamento na entrega' : 'Pagamento na retirada'}
            </span>
          </div>
        )}

        {/* Linha do tempo vertical */}
        <section
          style={{
            backgroundColor: 'var(--menu-card)',
            border: '1px solid var(--menu-border)',
          }}
          className="rounded-2xl p-5 shadow-xs space-y-4"
        >
          <h2 className="text-base font-bold">Andamento do pedido</h2>

          <ol className="relative space-y-0">
            {timelineSteps.map((step, index) => {
              const isLast = index === timelineSteps.length - 1;
              const eventTime = eventTimeMap.get(step.key);

              let isDone = false;
              let isCurrent = false;

              if (step.kind === 'pago') {
                isDone = order.pago || Boolean(eventTime);
                isCurrent =
                  !isCancelled &&
                  !isDone &&
                  order.status === 'novo' &&
                  order.forma_pagamento === 'pix';
              } else {
                const stepRank = step.rank ?? 0;
                if (isCancelled) {
                  isDone = stepRank === 0 || Boolean(eventTime);
                } else {
                  isDone =
                    currentRank > stepRank ||
                    (currentRank === stepRank && step.key === 'entregue') ||
                    (currentRank === stepRank && stepRank === 0) ||
                    Boolean(eventTime);
                  isCurrent =
                    currentRank === stepRank && step.key !== 'entregue';
                }
              }

              return (
                <li key={step.key} className="relative flex gap-3.5 pb-6 last:pb-0">
                  {!isLast && (
                    <span
                      aria-hidden="true"
                      className="absolute left-[15px] top-8 bottom-0 w-0.5"
                      style={{
                        backgroundColor: isDone
                          ? 'var(--menu-accent)'
                          : 'var(--menu-border)',
                      }}
                    />
                  )}

                  <div
                    className="relative z-10 w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors"
                    style={
                      isDone
                        ? {
                            backgroundColor: 'var(--menu-accent)',
                            color: 'var(--menu-accent-text)',
                          }
                        : isCurrent
                        ? {
                            backgroundColor: 'var(--menu-card)',
                            border: '2px solid var(--menu-accent)',
                            color: 'var(--menu-accent)',
                          }
                        : {
                            backgroundColor: 'var(--menu-pill-bg)',
                            color: 'var(--menu-muted)',
                          }
                    }
                  >
                    {isDone ? (
                      <Check className="w-4 h-4" strokeWidth={2.75} />
                    ) : (
                      <span
                        className={`w-2.5 h-2.5 rounded-full ${
                          isCurrent ? 'animate-pulse' : 'opacity-40'
                        }`}
                        style={{
                          backgroundColor: isCurrent
                            ? 'var(--menu-accent)'
                            : 'currentColor',
                        }}
                      />
                    )}
                  </div>

                  <div className="pt-1 flex-1 flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <p
                        className={`text-sm ${
                          isCurrent || isDone ? 'font-bold' : 'font-medium opacity-65'
                        }`}
                      >
                        {step.label}
                      </p>
                      {isCurrent && !isCancelled && (
                        <p
                          className="text-[11px] font-semibold mt-0.5"
                          style={{ color: 'var(--menu-accent)' }}
                        >
                          Etapa atual
                        </p>
                      )}
                    </div>
                    {eventTime && (
                      <span
                        className="text-xs tabular-nums font-medium"
                        style={{ color: 'var(--menu-muted)' }}
                      >
                        {eventTime}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        {/* Detalhes e Itens do Pedido */}
        <section
          style={{
            backgroundColor: 'var(--menu-card)',
            border: '1px solid var(--menu-border)',
          }}
          className="rounded-2xl p-5 shadow-xs space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-bold">Resumo do pedido</h2>
            <span
              className="px-2.5 py-1 rounded-full text-xs font-semibold inline-flex items-center gap-1.5"
              style={{
                backgroundColor: 'var(--menu-pill-bg)',
                color: 'var(--menu-pill-text)',
              }}
            >
              {order.tipo === 'entrega' ? (
                <>
                  <Truck className="w-3.5 h-3.5" />
                  <span>Entrega</span>
                </>
              ) : (
                <>
                  <Store className="w-3.5 h-3.5" />
                  <span>Retirada no local</span>
                </>
              )}
            </span>
          </div>

          {order.tipo === 'entrega' && (order.endereco || order.bairro) && (
            <div
              style={{
                backgroundColor: 'var(--menu-bg)',
                border: '1px solid var(--menu-border)',
              }}
              className="p-3 rounded-xl flex items-start gap-2 text-xs"
            >
              <MapPin className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--menu-muted)' }} />
              <div className="space-y-0.5">
                {order.endereco && <p className="font-medium">{order.endereco}</p>}
                {order.bairro && (
                  <p style={{ color: 'var(--menu-muted)' }}>Bairro: {order.bairro}</p>
                )}
              </div>
            </div>
          )}

          <div className="space-y-2 text-sm">
            {items.map((it, idx) => (
              <div key={idx} className="flex items-start justify-between gap-3">
                <div>
                  <span className="font-semibold">
                    {it.qtd}x {it.nome}
                  </span>
                  {it.obs && (
                    <p className="text-xs mt-0.5" style={{ color: 'var(--menu-muted)' }}>
                      Obs: {it.obs}
                    </p>
                  )}
                </div>
                {it.subtotal !== null && (
                  <span className="tabular-nums font-medium shrink-0">
                    {formatBRL(it.subtotal)}
                  </span>
                )}
              </div>
            ))}
          </div>

          {order.obs && order.obs.trim() && (
            <div
              className="pt-3 text-xs"
              style={{ borderTop: '1px solid var(--menu-border)', color: 'var(--menu-muted)' }}
            >
              <strong style={{ color: 'var(--menu-text)' }}>Observação:</strong> {order.obs}
            </div>
          )}

          <div
            className="pt-3 space-y-1.5 text-sm"
            style={{ borderTop: '1px solid var(--menu-border)' }}
          >
            <div className="flex justify-between" style={{ color: 'var(--menu-muted)' }}>
              <span>Subtotal</span>
              <span className="tabular-nums">{formatBRL(order.subtotal)}</span>
            </div>
            <div className="flex justify-between" style={{ color: 'var(--menu-muted)' }}>
              <span>Frete</span>
              <span className="tabular-nums">
                {order.taxa_entrega === 0
                  ? order.tipo === 'retirada'
                    ? 'R$ 0,00 (Retirada)'
                    : 'Frete grátis!'
                  : formatBRL(order.taxa_entrega)}
              </span>
            </div>
            <div
              className="flex justify-between text-base font-bold pt-2"
              style={{ borderTop: '1px solid var(--menu-border)' }}
            >
              <span>Total</span>
              <span className="tabular-nums" style={{ color: 'var(--menu-accent)' }}>
                {formatBRL(order.total)}
              </span>
            </div>
          </div>
        </section>

        {/* Botão Falar com a loja */}
        {storeWhatsappUrl && (
          <a
            href={storeWhatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full min-h-[48px] px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-sm transition-colors"
          >
            <MessageCircle className="w-5 h-5" />
            <span>Falar com a loja</span>
          </a>
        )}
      </main>
    </div>
  );
}
