import { useMemo, useState } from 'react';
import {
  ArrowRight,
  Ban,
  Check,
  Clock,
  CreditCard,
  MapPin,
  MessageCircle,
  PackageCheck,
  Phone,
  Printer,
  RefreshCw,
  ShoppingBag,
  Store,
  Truck,
} from 'lucide-react';
import {
  formatBRL,
  formatSaoPauloDateTime,
  formatSaoPauloTime,
  getPagamentoLabel,
  getSaoPauloDateKey,
  normalizeWhatsAppDigits,
  type Pedido,
  type PedidoItem,
  type PedidoStatus,
  shiftDateKey,
} from '../types/menu';

export type OrderDateFilter = 'hoje' | 'ontem' | '7dias' | 'todos';

interface OwnerOrdersTabProps {
  estabelecimentoNome: string;
  pedidos: Pedido[];
  loading: boolean;
  newlyArrivedIds: Set<string>;
  updatingOrderId: string | null;
  onRefresh: () => void;
  onUpdateStatus: (pedidoId: string, nextStatus: PedidoStatus) => Promise<void>;
  onTogglePaid: (pedidoId: string, nextPaid: boolean) => Promise<void>;
  onPrintPedido: (pedido: Pedido) => void;
}

const STATUS_BADGE_MAP: Record<
  string,
  { label: string; className: string }
> = {
  novo: {
    label: 'Novo',
    className: 'bg-sky-100 text-sky-900 border-sky-200',
  },
  em_preparo: {
    label: 'Em preparo',
    className: 'bg-amber-100 text-amber-900 border-amber-200',
  },
  saiu_entrega: {
    label: 'Saiu para entrega',
    className: 'bg-indigo-100 text-indigo-900 border-indigo-200',
  },
  pronto_retirada: {
    label: 'Pronto para retirada',
    className: 'bg-teal-100 text-teal-900 border-teal-200',
  },
  entregue: {
    label: 'Entregue',
    className: 'bg-emerald-100 text-emerald-900 border-emerald-200',
  },
  cancelado: {
    label: 'Cancelado',
    className: 'bg-rose-100 text-rose-900 border-rose-200',
  },
};

function getNextStatusAction(pedido: Pedido): {
  nextStatus: PedidoStatus;
  label: string;
} | null {
  switch (pedido.status) {
    case 'novo':
      return { nextStatus: 'em_preparo', label: 'Em preparo' };
    case 'em_preparo':
      return pedido.tipo === 'retirada'
        ? { nextStatus: 'pronto_retirada', label: 'Pronto para retirada' }
        : { nextStatus: 'saiu_entrega', label: 'Saiu para entrega' };
    case 'saiu_entrega':
    case 'pronto_retirada':
      return { nextStatus: 'entregue', label: 'Entregue' };
    default:
      return null;
  }
}

export function normalizeOrderItems(rawItens: unknown): Array<{
  nome: string;
  qtd: number;
  subtotal: number | null;
  obs: string;
}> {
  if (!Array.isArray(rawItens)) return [];
  return rawItens.map((raw) => {
    const it = (raw || {}) as PedidoItem;
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

export function OwnerOrdersTab({
  estabelecimentoNome,
  pedidos,
  loading,
  newlyArrivedIds,
  updatingOrderId,
  onRefresh,
  onUpdateStatus,
  onTogglePaid,
  onPrintPedido,
}: OwnerOrdersTabProps) {
  const [dateFilter, setDateFilter] = useState<OrderDateFilter>('hoje');
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);

  const todayKey = getSaoPauloDateKey(new Date());
  const yesterdayKey = shiftDateKey(todayKey, -1);
  const sevenDaysStartKey = shiftDateKey(todayKey, -6);

  const filteredPedidos = useMemo(() => {
    const sorted = [...pedidos].sort((a, b) => {
      const timeDiff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (timeDiff !== 0) return timeDiff;
      return (b.numero || 0) - (a.numero || 0);
    });

    if (dateFilter === 'todos') return sorted;

    return sorted.filter((p) => {
      const key = getSaoPauloDateKey(p.created_at);
      if (!key) return false;
      if (dateFilter === 'hoje') return key === todayKey;
      if (dateFilter === 'ontem') return key === yesterdayKey;
      if (dateFilter === '7dias') return key >= sevenDaysStartKey && key <= todayKey;
      return true;
    });
  }, [pedidos, dateFilter, todayKey, yesterdayKey, sevenDaysStartKey]);

  const summary = useMemo(() => {
    const valid = filteredPedidos.filter((p) => p.status !== 'cancelado');
    let totalVendido = 0;
    let totalPago = 0;
    let totalAReceber = 0;

    for (const p of valid) {
      const val = Number(p.total) || 0;
      totalVendido += val;
      if (p.pago) {
        totalPago += val;
      } else {
        totalAReceber += val;
      }
    }

    return {
      count: valid.length,
      totalVendido,
      totalPago,
      totalAReceber,
    };
  }, [filteredPedidos]);

  const filterButtons: Array<{ id: OrderDateFilter; label: string }> = [
    { id: 'hoje', label: 'Hoje' },
    { id: 'ontem', label: 'Ontem' },
    { id: '7dias', label: 'Últimos 7 dias' },
    { id: 'todos', label: 'Todos' },
  ];

  const emptyMessageByFilter: Record<OrderDateFilter, string> = {
    hoje: 'Nenhum pedido recebido hoje ainda.',
    ontem: 'Nenhum pedido registrado ontem.',
    '7dias': 'Nenhum pedido nos últimos 7 dias.',
    todos: 'Nenhum pedido recebido até o momento.',
  };

  return (
    <div className="space-y-5">
      {/* Cabeçalho e Filtros */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Pedidos Recebidos</h1>
          <p className="text-sm text-slate-600">
            Acompanhe novos pedidos, atualize o andamento e controle os pagamentos.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex flex-wrap items-center gap-1 p-1 rounded-xl bg-white border border-slate-200 shadow-xs">
            {filterButtons.map((btn) => (
              <button
                key={btn.id}
                type="button"
                onClick={() => setDateFilter(btn.id)}
                className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  dateFilter === btn.id
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            aria-label="Atualizar pedidos"
            className="min-h-[40px] px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 shadow-xs disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Atualizar</span>
          </button>
        </div>
      </div>

      {/* Resumo no topo (ignora cancelados) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
          <span className="text-xs font-medium text-slate-500">Pedidos válidos</span>
          <p className="text-2xl font-bold text-slate-900 tabular-nums mt-1">
            {summary.count}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
          <span className="text-xs font-medium text-slate-500">Total vendido</span>
          <p className="text-2xl font-bold text-slate-900 tabular-nums mt-1">
            {formatBRL(summary.totalVendido)}
          </p>
        </div>

        <div className="bg-white border border-emerald-200 rounded-2xl p-4 shadow-xs">
          <span className="text-xs font-medium text-emerald-700">Total já pago</span>
          <p className="text-2xl font-bold text-emerald-800 tabular-nums mt-1">
            {formatBRL(summary.totalPago)}
          </p>
        </div>

        <div className="bg-white border border-amber-200 rounded-2xl p-4 shadow-xs">
          <span className="text-xs font-medium text-amber-700">Total a receber</span>
          <p className="text-2xl font-bold text-amber-800 tabular-nums mt-1">
            {formatBRL(summary.totalAReceber)}
          </p>
        </div>
      </div>

      {/* Lista de Pedidos */}
      {loading && pedidos.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center shadow-xs">
          <div className="w-7 h-7 border-2 border-slate-300 border-t-slate-900 rounded-full animate-spin mx-auto" />
          <p className="text-sm text-slate-500 mt-3">Carregando pedidos...</p>
        </div>
      ) : filteredPedidos.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center space-y-3 shadow-xs">
          <ShoppingBag className="w-9 h-9 text-slate-400 mx-auto" />
          <p className="text-base font-bold text-slate-900">
            {emptyMessageByFilter[dateFilter]}
          </p>
          <p className="text-sm text-slate-500 max-w-md mx-auto">
            Quando seus clientes finalizarem um pedido no cardápio digital, ele aparecerá aqui automaticamente.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredPedidos.map((pedido) => {
            const statusInfo = STATUS_BADGE_MAP[pedido.status] || {
              label: pedido.status || 'Novo',
              className: 'bg-slate-100 text-slate-800 border-slate-200',
            };
            const nextAction = getNextStatusAction(pedido);
            const isUpdating = updatingOrderId === pedido.id;
            const isCancelled = pedido.status === 'cancelado';
            const isNewHighlight =
              pedido.status === 'novo' || newlyArrivedIds.has(pedido.id);
            const phoneDigits = normalizeWhatsAppDigits(pedido.telefone || '');
            const clienteWhatsappUrl = phoneDigits
              ? `https://wa.me/${phoneDigits}?text=${encodeURIComponent(
                  `Olá ${pedido.cliente}, tudo bem? Sobre o Pedido #${pedido.numero} em ${estabelecimentoNome}: `
                )}`
              : null;
            const items = normalizeOrderItems(pedido.itens);

            return (
              <article
                key={pedido.id}
                className={`bg-white border rounded-2xl p-5 shadow-xs space-y-4 transition-colors ${
                  isCancelled
                    ? 'border-rose-200/80 opacity-75'
                    : isNewHighlight
                    ? 'border-sky-300 ring-1 ring-sky-200'
                    : 'border-slate-200'
                }`}
              >
                {/* Cabeçalho do Cartão */}
                <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-slate-100">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-lg font-bold text-slate-900 tabular-nums">
                        Pedido #{pedido.numero}
                      </span>

                      <span
                        className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${statusInfo.className}`}
                      >
                        {statusInfo.label}
                      </span>

                      {newlyArrivedIds.has(pedido.id) && pedido.status !== 'novo' && (
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-sky-600 text-white">
                          Novo
                        </span>
                      )}

                      <span
                        className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                          pedido.pago
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : 'bg-amber-50 text-amber-800 border-amber-200'
                        }`}
                      >
                        {pedido.pago ? 'Pago' : 'A receber'}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        <Clock className="w-3.5 h-3.5" />
                        <span>
                          {dateFilter === 'hoje' || dateFilter === 'ontem'
                            ? formatSaoPauloTime(pedido.created_at)
                            : formatSaoPauloDateTime(pedido.created_at)}
                        </span>
                      </span>

                      <span className="inline-flex items-center gap-1 font-semibold text-slate-700">
                        {pedido.tipo === 'entrega' ? (
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

                      <span className="inline-flex items-center gap-1">
                        <CreditCard className="w-3.5 h-3.5" />
                        <span>{getPagamentoLabel(pedido.pagamento, pedido.tipo)}</span>
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onPrintPedido(pedido)}
                      className="min-h-[38px] px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span>Imprimir</span>
                    </button>
                  </div>
                </div>

                {/* Cliente & Endereço */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <div className="space-y-1">
                    <p className="font-bold text-slate-900">{pedido.cliente}</p>
                    {pedido.telefone && pedido.telefone.trim() && (
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                        <span className="inline-flex items-center gap-1 font-mono">
                          <Phone className="w-3.5 h-3.5 text-slate-400" />
                          <span>{pedido.telefone}</span>
                        </span>
                        {clienteWhatsappUrl && (
                          <a
                            href={clienteWhatsappUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold inline-flex items-center gap-1 transition-colors"
                          >
                            <MessageCircle className="w-3 h-3" />
                            <span>Chamar no WhatsApp</span>
                          </a>
                        )}
                      </div>
                    )}
                  </div>

                  {pedido.tipo === 'entrega' && (pedido.endereco || pedido.bairro) && (
                    <div className="flex items-start gap-2 text-xs text-slate-700 bg-slate-50 border border-slate-200/80 rounded-xl p-3">
                      <MapPin className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                      <div className="space-y-0.5">
                        {pedido.endereco && <p className="font-medium">{pedido.endereco}</p>}
                        {pedido.bairro && (
                          <p className="text-slate-500">Bairro: {pedido.bairro}</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Itens do Pedido */}
                <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 space-y-2">
                  <div className="space-y-1.5">
                    {items.map((item, idx) => (
                      <div key={idx} className="flex items-start justify-between gap-3 text-xs sm:text-sm">
                        <div>
                          <span className="font-semibold text-slate-900">
                            {item.qtd}x {item.nome}
                          </span>
                          {item.obs && (
                            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200/70 rounded px-2 py-0.5 mt-0.5 inline-block">
                              Obs: {item.obs}
                            </p>
                          )}
                        </div>
                        {item.subtotal !== null && (
                          <span className="tabular-nums font-medium text-slate-700 shrink-0">
                            {formatBRL(item.subtotal)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>

                  {pedido.obs && pedido.obs.trim() && (
                    <div className="pt-2 border-t border-slate-200 text-xs text-slate-700">
                      <span className="font-semibold">Observação do pedido:</span> {pedido.obs}
                    </div>
                  )}

                  <div className="pt-2 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span>
                        Subtotal:{' '}
                        <strong className="text-slate-800 tabular-nums">
                          {formatBRL(Number(pedido.subtotal) || 0)}
                        </strong>
                      </span>
                      <span>
                        Taxa:{' '}
                        <strong className="text-slate-800 tabular-nums">
                          {formatBRL(Number(pedido.taxa_entrega) || 0)}
                        </strong>
                      </span>
                    </div>
                    <span className="text-sm font-bold text-slate-900 tabular-nums">
                      Total: {formatBRL(Number(pedido.total) || 0)}
                    </span>
                  </div>
                </div>

                {/* Ações: Avançar Status, Marcar como Pago, Cancelar */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {nextAction && !isCancelled && (
                      <button
                        type="button"
                        disabled={isUpdating}
                        onClick={() => onUpdateStatus(pedido.id, nextAction.nextStatus)}
                        className="min-h-[40px] px-4 py-2 rounded-xl bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 text-xs font-bold inline-flex items-center gap-1.5 shadow-xs"
                      >
                        <PackageCheck className="w-4 h-4" />
                        <span>Avançar para: {nextAction.label}</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {!isCancelled && (
                      confirmCancelId === pedido.id ? (
                        <div className="inline-flex items-center gap-1.5 bg-rose-50 border border-rose-200 rounded-xl px-2.5 py-1">
                          <span className="text-xs font-semibold text-rose-800">
                            Confirmar?
                          </span>
                          <button
                            type="button"
                            disabled={isUpdating}
                            onClick={async () => {
                              await onUpdateStatus(pedido.id, 'cancelado');
                              setConfirmCancelId(null);
                            }}
                            className="min-h-[30px] px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold disabled:opacity-50"
                          >
                            Sim, cancelar
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmCancelId(null)}
                            className="min-h-[30px] px-2 py-1 rounded-lg text-xs font-semibold text-slate-600 hover:bg-white"
                          >
                            Voltar
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={isUpdating}
                          onClick={() => setConfirmCancelId(pedido.id)}
                          className="min-h-[40px] px-3.5 py-2 rounded-xl border border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-50 text-xs font-semibold inline-flex items-center gap-1.5"
                        >
                          <Ban className="w-3.5 h-3.5" />
                          <span>Cancelar</span>
                        </button>
                      )
                    )}
                  </div>

                  {/* Interruptor Marcar como pago */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={pedido.pago}
                    disabled={isUpdating}
                    onClick={() => onTogglePaid(pedido.id, !pedido.pago)}
                    className="min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 disabled:opacity-50 inline-flex items-center gap-2.5 text-xs font-semibold text-slate-800"
                  >
                    <span
                      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                        pedido.pago ? 'bg-emerald-600' : 'bg-slate-300'
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                          pedido.pago ? 'translate-x-4.5' : 'translate-x-1'
                        }`}
                      />
                    </span>
                    <span className="inline-flex items-center gap-1">
                      {pedido.pago && <Check className="w-3.5 h-3.5 text-emerald-700" />}
                      <span>Marcar como pago</span>
                    </span>
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface PrintReceiptProps {
  estabelecimentoNome: string;
  pedido: Pedido | null;
}

export function OrderPrintReceipt({ estabelecimentoNome, pedido }: PrintReceiptProps) {
  if (!pedido) return null;
  const items = normalizeOrderItems(pedido.itens);

  return (
    <div className="hidden print:block p-2 max-w-[80mm] mx-auto text-black font-mono text-xs leading-snug">
      <div className="text-center border-b border-dashed border-black pb-2 mb-2">
        <p className="font-bold text-sm uppercase">{estabelecimentoNome}</p>
        <p className="font-bold text-base mt-1">PEDIDO #{pedido.numero}</p>
        <p className="text-[11px]">{formatSaoPauloDateTime(pedido.created_at)}</p>
      </div>

      <div className="border-b border-dashed border-black pb-2 mb-2 space-y-0.5">
        <p>
          <strong>Cliente:</strong> {pedido.cliente}
        </p>
        {pedido.telefone && (
          <p>
            <strong>Telefone:</strong> {pedido.telefone}
          </p>
        )}
        <p>
          <strong>Tipo:</strong> {pedido.tipo === 'entrega' ? 'ENTREGA' : 'RETIRADA NO LOCAL'}
        </p>
        {pedido.tipo === 'entrega' && pedido.endereco && (
          <p>
            <strong>End.:</strong> {pedido.endereco}
            {pedido.bairro ? ` - ${pedido.bairro}` : ''}
          </p>
        )}
      </div>

      <div className="border-b border-dashed border-black pb-2 mb-2 space-y-1">
        <p className="font-bold">ITENS:</p>
        {items.map((it, idx) => (
          <div key={idx}>
            <div className="flex justify-between gap-2">
              <span>
                {it.qtd}x {it.nome}
              </span>
              {it.subtotal !== null && <span>{formatBRL(it.subtotal)}</span>}
            </div>
            {it.obs && <p className="pl-3 text-[11px]">Obs: {it.obs}</p>}
          </div>
        ))}
        {pedido.obs && (
          <p className="pt-1 text-[11px]">
            <strong>Obs. pedido:</strong> {pedido.obs}
          </p>
        )}
      </div>

      <div className="space-y-0.5 border-b border-dashed border-black pb-2 mb-2">
        <div className="flex justify-between">
          <span>Subtotal:</span>
          <span>{formatBRL(Number(pedido.subtotal) || 0)}</span>
        </div>
        <div className="flex justify-between">
          <span>Taxa entrega:</span>
          <span>{formatBRL(Number(pedido.taxa_entrega) || 0)}</span>
        </div>
        <div className="flex justify-between font-bold text-sm pt-1">
          <span>TOTAL:</span>
          <span>{formatBRL(Number(pedido.total) || 0)}</span>
        </div>
      </div>

      <div className="space-y-0.5 text-[11px]">
        <p>
          <strong>Pagamento:</strong> {getPagamentoLabel(pedido.pagamento, pedido.tipo)}
        </p>
        <p>
          <strong>Situação:</strong> {pedido.pago ? 'PAGO' : 'A RECEBER'}
        </p>
      </div>
    </div>
  );
}
