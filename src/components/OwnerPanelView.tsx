import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  ImagePlus,
  LogOut,
  MessageCircle,
  Palette,
  Pencil,
  Plus,
  QrCode,
  Settings,
  ShoppingBag,
  Store,
  Tag,
  Trash2,
  Truck,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import {
  deleteStoragePhoto,
  isSupabaseConfigured,
  processAndUploadImage,
  supabase,
  translateSupabaseError,
} from '../lib/supabase';
import {
  ALL_THEME_OPTIONS,
  type BairroEntrega,
  type Categoria,
  centsToNumber,
  DEFAULT_COR_PRIMARIA,
  DEFAULT_COR_SECUNDARIA,
  type Estabelecimento,
  formatBRL,
  getContrastText,
  type ModoEntrega,
  numberToCents,
  PALETAS_CORES,
  type Pedido,
  type PedidoStatus,
  type Produto,
  resolveStoreTheme,
  sanitizeExternalUrl,
  slugify,
  THEME_PRESETS,
  type ThemeId,
  validateSlugFormat,
} from '../types/menu';
import { cleanCepDigits, formatCepMask } from '../lib/geo';
import { CurrencyInput } from './CurrencyInput';
import { ImageWithFallback } from './ImageWithFallback';
import { OwnerDeliveryTab } from './OwnerDeliveryTab';
import { OrderPrintReceipt, OwnerOrdersTab } from './OwnerOrdersTab';
import { QrCodeGenerator } from './QrCodeGenerator';
import { SlugField } from './SlugField';
import {
  EMPTY_STORE_ADDRESS,
  StoreAddressFields,
  type StoreAddressState,
} from './StoreAddressFields';

interface OwnerPanelViewProps {
  onNavigate: (path: string) => void;
}

type OwnerTab = 'pedidos' | 'produtos' | 'categorias' | 'entrega' | 'aparencia' | 'config' | 'qrcode';
const STORAGE_PENDING_REG = 'cardapio_pending_reg_v1';
const STORAGE_INITIAL_TAB = 'cardapio_initial_tab_v1';

function playNewOrderChime() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const playTone = (freq: number, startOffset: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + startOffset);
      gain.gain.setValueAtTime(0.001, now + startOffset);
      gain.gain.exponentialRampToValueAtTime(0.18, now + startOffset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + startOffset + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + startOffset);
      osc.stop(now + startOffset + duration + 0.02);
    };

    playTone(880, 0, 0.14);
    playTone(1174.66, 0.13, 0.22);

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 600);
  } catch {
    // Navegador pode bloquear áudio antes de interação
  }
}

function normalizePedidoRow(row: Record<string, unknown>): Pedido {
  return {
    ...(row as unknown as Pedido),
    subtotal: Number(row.subtotal) || 0,
    taxa_entrega: Number(row.taxa_entrega) || 0,
    total: Number(row.total) || 0,
    pago: Boolean(row.pago),
    itens: Array.isArray(row.itens) ? row.itens : [],
  };
}

function isNetworkFetchError(err: unknown): boolean {
  if (!err) return false;
  let msg = '';
  if (typeof err === 'string') {
    msg = err;
  } else if (typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    msg = `${String(obj.message || '')} ${String(obj.details || '')}`;
  }
  const lower = msg.toLowerCase();
  return (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('network request failed') ||
    lower.includes('load failed')
  );
}

function formatWhatsAppMask(raw?: string | null): string {
  let digits = (raw || '').replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length > 11) {
    digits = digits.slice(2);
  }
  digits = digits.slice(0, 11);
  if (digits.length === 0) return '';
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
}

function toWhatsAppStorageDigits(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length <= 11) {
    return `55${digits}`;
  }
  return digits;
}

export function OwnerPanelView({ onNavigate }: OwnerPanelViewProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authView, setAuthView] = useState<'login' | 'forgot'>('login');

  // Primeiro login sem estabelecimento (Onboarding pendente)
  const [needsEstablishmentSetup, setNeedsEstablishmentSetup] = useState(false);
  const [onbNome, setOnbNome] = useState('');
  const [onbSlug, setOnbSlug] = useState('');
  const [onbAddress, setOnbAddress] = useState<StoreAddressState>(EMPTY_STORE_ADDRESS);
  const [onbSubmitting, setOnbSubmitting] = useState(false);
  const [onbError, setOnbError] = useState<string | null>(null);

  const [estabelecimento, setEstabelecimento] = useState<Estabelecimento | null>(null);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [bairros, setBairros] = useState<BairroEntrega[]>([]);
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [pedidosLoading, setPedidosLoading] = useState(false);
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const [newlyArrivedIds, setNewlyArrivedIds] = useState<Set<string>>(() => new Set());
  const [printingPedido, setPrintingPedido] = useState<Pedido | null>(null);
  const knownOrderIdsRef = useRef<Set<string>>(new Set());
  const [dataLoading, setDataLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<OwnerTab>(() => {
    try {
      const requested = sessionStorage.getItem(STORAGE_INITIAL_TAB);
      if (
        requested === 'entrega' ||
        requested === 'config' ||
        requested === 'produtos' ||
        requested === 'categorias' ||
        requested === 'aparencia' ||
        requested === 'qrcode' ||
        requested === 'pedidos'
      ) {
        sessionStorage.removeItem(STORAGE_INITIAL_TAB);
        return requested;
      }
    } catch {
      // Ignorar erro de storage
    }
    return 'pedidos';
  });
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  // Configurações gerais da loja (Slug não editável)
  const [cfgNome, setCfgNome] = useState('');
  const [cfgSlug, setCfgSlug] = useState('');
  const [cfgWhatsapp, setCfgWhatsapp] = useState('');
  const [cfgPix, setCfgPix] = useState('');
  const [cfgLink, setCfgLink] = useState('');
  const [cfgHorario, setCfgHorario] = useState('');
  const [cfgAddress, setCfgAddress] = useState<StoreAddressState>(EMPTY_STORE_ADDRESS);
  const [cfgSaving, setCfgSaving] = useState(false);

  // Aparência (Logo, Capa e Tema)
  const [apTema, setApTema] = useState<ThemeId>('classico');
  const [apCorPrimaria, setApCorPrimaria] = useState(DEFAULT_COR_PRIMARIA);
  const [apCorSecundaria, setApCorSecundaria] = useState(DEFAULT_COR_SECUNDARIA);
  const [apLogoUrl, setApLogoUrl] = useState('');
  const [apCapaUrl, setApCapaUrl] = useState('');
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingCapa, setUploadingCapa] = useState(false);
  const [apSaving, setApSaving] = useState(false);

  // Entrega
  const [delAceitaEntrega, setDelAceitaEntrega] = useState(true);
  const [delAceitaRetirada, setDelAceitaRetirada] = useState(true);
  const [delModo, setDelModo] = useState<ModoEntrega>('fixa');
  const [delTaxaFixaCents, setDelTaxaFixaCents] = useState<number>(0);
  const [delFreteGratisCents, setDelFreteGratisCents] = useState<number | null>(null);
  const [delPedidoMinimoCents, setDelPedidoMinimoCents] = useState<number | null>(null);
  const [delTempoEstimado, setDelTempoEstimado] = useState('');
  const [delSaving, setDelSaving] = useState(false);

  // Categorias
  const [newCatNome, setNewCatNome] = useState('');
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editingCatNome, setEditingCatNome] = useState('');

  // Produtos (Criar / Editar)
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [editingProduto, setEditingProduto] = useState<Produto | null>(null);
  const [prodNome, setProdNome] = useState('');
  const [prodDesc, setProdDesc] = useState('');
  const [prodPrecoCents, setProdPrecoCents] = useState<number>(0);
  const [prodCategoriaId, setProdCategoriaId] = useState<string>('');
  const [prodFotoUrl, setProdFotoUrl] = useState('');
  const [prodAtivo, setProdAtivo] = useState(true);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [savingProduct, setSavingProduct] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setAuthLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  const translateRpcError = (err: unknown): string => {
    return translateSupabaseError(err, 'Erro ao processar solicitação.');
  };

  const syncFormStateFromEstablishment = (est: Estabelecimento) => {
    setCfgNome(est.nome || '');
    setCfgSlug(est.slug || '');
    setCfgWhatsapp(formatWhatsAppMask(est.whatsapp));
    setCfgPix(est.chave_pix || '');
    setCfgLink(est.link_pagamento || '');
    setCfgHorario(est.horario || '');
    setCfgAddress({
      cep: formatCepMask(est.cep),
      logradouro: est.logradouro || '',
      numero: est.numero || '',
      complemento: est.complemento || '',
      bairro_loja: est.bairro_loja || '',
      cidade: est.cidade || '',
      uf: est.uf || '',
      latitude:
        est.latitude !== null && est.latitude !== undefined ? Number(est.latitude) : null,
      longitude:
        est.longitude !== null && est.longitude !== undefined ? Number(est.longitude) : null,
      mostrar_endereco: Boolean(est.mostrar_endereco),
    });

    const resolvedTheme = resolveStoreTheme(est);
    setApTema(resolvedTheme.id);
    setApCorPrimaria(est.cor_primaria || DEFAULT_COR_PRIMARIA);
    setApCorSecundaria(est.cor_secundaria || DEFAULT_COR_SECUNDARIA);
    setApLogoUrl(est.logo_url || '');
    setApCapaUrl(est.capa_url || '');

    setDelAceitaEntrega(est.aceita_entrega !== false);
    setDelAceitaRetirada(est.aceita_retirada !== false);
    setDelModo(est.modo_entrega === 'bairro' ? 'bairro' : 'fixa');
    setDelTaxaFixaCents(numberToCents(est.taxa_entrega ?? 0) ?? 0);
    setDelFreteGratisCents(
      est.entrega_gratis_acima && Number(est.entrega_gratis_acima) > 0
        ? numberToCents(est.entrega_gratis_acima)
        : null
    );
    setDelPedidoMinimoCents(
      est.pedido_minimo && Number(est.pedido_minimo) > 0
        ? numberToCents(est.pedido_minimo)
        : null
    );
    setDelTempoEstimado(est.tempo_estimado || '');
  };

  const loadOwnerEstablishment = async (userId: string) => {
    if (!supabase) return;
    setDataLoading(true);
    setFeedback(null);
    setNeedsEstablishmentSetup(false);

    try {
      const { data: estabData, error: estabErr } = await supabase
        .from('estabelecimentos')
        .select('*')
        .eq('owner_id', userId)
        .maybeSingle();

      if (estabErr) throw estabErr;

      if (!estabData) {
        const pending = sessionStorage.getItem(STORAGE_PENDING_REG);
        if (pending) {
          try {
            const parsed = JSON.parse(pending);
            setOnbNome(parsed.nome || '');
            setOnbSlug(parsed.slug || '');
          } catch {
            // Ignorar
          }
        }
        setNeedsEstablishmentSetup(true);
        setDataLoading(false);
        return;
      }

      const est = estabData as Estabelecimento;
      setEstabelecimento(est);
      syncFormStateFromEstablishment(est);

      const [catRes, prodRes, bairrosRes, pedidosRes] = await Promise.all([
        supabase
          .from('categorias')
          .select('*')
          .eq('estabelecimento_id', est.id)
          .order('ordem', { ascending: true }),
        supabase
          .from('produtos')
          .select('*')
          .eq('estabelecimento_id', est.id)
          .order('ordem', { ascending: true }),
        supabase
          .from('bairros_entrega')
          .select('*')
          .eq('estabelecimento_id', est.id)
          .order('bairro', { ascending: true }),
        supabase
          .from('pedidos')
          .select('*')
          .eq('estabelecimento_id', est.id)
          .order('created_at', { ascending: false })
          .limit(1000),
      ]);

      if (catRes.error) throw catRes.error;
      if (prodRes.error) throw prodRes.error;
      if (bairrosRes.error && !isNetworkFetchError(bairrosRes.error)) {
        console.error('Erro ao carregar bairros:', bairrosRes.error);
      }
      if (pedidosRes.error && !isNetworkFetchError(pedidosRes.error)) {
        console.error('Erro ao carregar pedidos:', pedidosRes.error);
      }

      setCategorias(catRes.data || []);
      setProdutos(
        (prodRes.data || []).map((p) => ({
          ...p,
          preco: Number(p.preco) || 0,
        }))
      );
      setBairros(
        (bairrosRes.data || []).map((b) => ({
          ...b,
          taxa: Number(b.taxa) || 0,
        })) as BairroEntrega[]
      );

      const loadedOrders = (pedidosRes.data || []).map((r) =>
        normalizePedidoRow(r as Record<string, unknown>)
      );
      knownOrderIdsRef.current = new Set(loadedOrders.map((o) => o.id));
      setPedidos(loadedOrders);
    } catch (err) {
      if (!isNetworkFetchError(err)) {
        console.error('Erro ao carregar estabelecimento:', err);
      }
      setFeedback({
        type: 'err',
        text: translateSupabaseError(err, 'Erro ao carregar dados do painel.'),
      });
    } finally {
      setDataLoading(false);
    }
  };

  useEffect(() => {
    if (session?.user?.id) {
      loadOwnerEstablishment(session.user.id);
    } else {
      setEstabelecimento(null);
      setCategorias([]);
      setProdutos([]);
      setBairros([]);
      setPedidos([]);
      knownOrderIdsRef.current = new Set();
      setNewlyArrivedIds(new Set());
      setNeedsEstablishmentSetup(false);
    }
  }, [session?.user?.id]);

  const showNotice = (type: 'ok' | 'err', text: string) => {
    setFeedback({ type, text });
  };

  const fetchPedidos = useCallback(
    async (estId: string, options: { silent?: boolean; notifyNew?: boolean } = {}) => {
      if (!supabase) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        if (!options.silent) {
          showNotice('err', 'Sem conexão com a internet. Verifique sua rede e tente novamente.');
        }
        return;
      }
      if (
        options.silent &&
        typeof document !== 'undefined' &&
        document.visibilityState === 'hidden'
      ) {
        return;
      }

      if (!options.silent) setPedidosLoading(true);

      const queryPedidosOnce = () =>
        supabase!
          .from('pedidos')
          .select('*')
          .eq('estabelecimento_id', estId)
          .order('created_at', { ascending: false })
          .limit(1000);

      try {
        let result = await queryPedidosOnce();

        // Em atualização manual, tenta novamente uma vez em caso de falha transitória de rede
        if (!options.silent && result.error && isNetworkFetchError(result.error)) {
          await new Promise((resolve) => setTimeout(resolve, 600));
          result = await queryPedidosOnce();
        }

        if (result.error) {
          if (!options.silent && !isNetworkFetchError(result.error)) {
            console.error('Erro ao buscar pedidos:', result.error);
          }
          if (!options.silent) {
            showNotice(
              'err',
              translateSupabaseError(result.error, 'Não foi possível atualizar os pedidos.')
            );
          }
          return;
        }

        const nextOrders = (result.data || []).map((r) =>
          normalizePedidoRow(r as Record<string, unknown>)
        );

        if (options.notifyNew) {
          const unseenNew = nextOrders.filter(
            (o) => !knownOrderIdsRef.current.has(o.id) && o.status === 'novo'
          );
          if (unseenNew.length > 0) {
            playNewOrderChime();
            setNewlyArrivedIds((prev) => {
              const copy = new Set(prev);
              unseenNew.forEach((o) => copy.add(o.id));
              return copy;
            });
            showNotice(
              'ok',
              unseenNew.length === 1
                ? `Novo pedido #${unseenNew[0].numero} recebido!`
                : `${unseenNew.length} novos pedidos recebidos!`
            );
          }
        }

        knownOrderIdsRef.current = new Set(nextOrders.map((o) => o.id));
        setPedidos(nextOrders);
      } catch (err) {
        if (!options.silent && !isNetworkFetchError(err)) {
          console.error('Erro ao buscar pedidos:', err);
        }
        if (!options.silent) {
          showNotice(
            'err',
            translateSupabaseError(err, 'Não foi possível atualizar os pedidos.')
          );
        }
      } finally {
        if (!options.silent) setPedidosLoading(false);
      }
    },
    []
  );

  // Realtime + fallback de 30s caso o realtime falhe
  useEffect(() => {
    const estId = estabelecimento?.id;
    if (!supabase || !estId) return;

    let fallbackTimer: ReturnType<typeof setInterval> | null = null;

    const startFallbackPolling = () => {
      if (fallbackTimer) return;
      fallbackTimer = setInterval(() => {
        fetchPedidos(estId, { silent: true, notifyNew: true });
      }, 30_000);
    };

    const stopFallbackPolling = () => {
      if (fallbackTimer) {
        clearInterval(fallbackTimer);
        fallbackTimer = null;
      }
    };

    const handleResumeSync = () => {
      if (fallbackTimer && document.visibilityState === 'visible') {
        fetchPedidos(estId, { silent: true, notifyNew: true });
      }
    };

    window.addEventListener('online', handleResumeSync);
    document.addEventListener('visibilitychange', handleResumeSync);

    const channel = supabase
      .channel(`pedidos-${estId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'pedidos',
          filter: `estabelecimento_id=eq.${estId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT' && payload.new) {
            const incoming = normalizePedidoRow(payload.new as Record<string, unknown>);
            const alreadySeen = knownOrderIdsRef.current.has(incoming.id);
            knownOrderIdsRef.current.add(incoming.id);

            setPedidos((prev) => {
              if (prev.some((p) => p.id === incoming.id)) return prev;
              return [incoming, ...prev];
            });

            if (!alreadySeen) {
              setNewlyArrivedIds((prev) => {
                const next = new Set(prev);
                next.add(incoming.id);
                return next;
              });
              playNewOrderChime();
              showNotice('ok', `Novo pedido #${incoming.numero} recebido!`);
            }
          } else if (payload.eventType === 'UPDATE' && payload.new) {
            const updated = normalizePedidoRow(payload.new as Record<string, unknown>);
            knownOrderIdsRef.current.add(updated.id);
            setPedidos((prev) =>
              prev.map((p) => (p.id === updated.id ? updated : p))
            );
          } else if (payload.eventType === 'DELETE' && payload.old) {
            const deletedId = String((payload.old as Record<string, unknown>).id || '');
            if (deletedId) {
              knownOrderIdsRef.current.delete(deletedId);
              setPedidos((prev) => prev.filter((p) => p.id !== deletedId));
            }
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          stopFallbackPolling();
        } else if (
          status === 'CHANNEL_ERROR' ||
          status === 'TIMED_OUT' ||
          status === 'CLOSED'
        ) {
          startFallbackPolling();
        }
      });

    // Inicia polling preventivo se em 10s o canal não confirmar SUBSCRIBED
    const connectWatchdog = setTimeout(() => {
      // Se ainda não estiver inscrito, ativa fallback de 30s
      if (channel.state !== 'joined') {
        startFallbackPolling();
      }
    }, 10_000);

    return () => {
      clearTimeout(connectWatchdog);
      stopFallbackPolling();
      window.removeEventListener('online', handleResumeSync);
      document.removeEventListener('visibilitychange', handleResumeSync);
      supabase?.removeChannel(channel);
    };
  }, [estabelecimento?.id, fetchPedidos]);

  const handleUpdateOrderStatus = async (
    pedidoId: string,
    nextStatus: PedidoStatus
  ): Promise<boolean> => {
    if (!supabase) return false;
    setUpdatingOrderId(pedidoId);
    try {
      const { data, error } = await supabase
        .from('pedidos')
        .update({ status: nextStatus })
        .eq('id', pedidoId)
        .select('*')
        .single();

      if (error) throw error;

      const updated = normalizePedidoRow(data as Record<string, unknown>);
      setPedidos((prev) => prev.map((p) => (p.id === pedidoId ? updated : p)));

      if (nextStatus !== 'novo') {
        setNewlyArrivedIds((prev) => {
          if (!prev.has(pedidoId)) return prev;
          const next = new Set(prev);
          next.delete(pedidoId);
          return next;
        });
      }

      showNotice(
        'ok',
        nextStatus === 'cancelado'
          ? `Pedido #${updated.numero} cancelado.`
          : `Status do Pedido #${updated.numero} atualizado.`
      );
      return true;
    } catch (err) {
      console.error('Erro ao atualizar status do pedido:', err);
      showNotice(
        'err',
        translateSupabaseError(err, 'Erro ao atualizar status do pedido.')
      );
      return false;
    } finally {
      setUpdatingOrderId(null);
    }
  };

  const handleToggleOrderPaid = async (
    pedidoId: string,
    nextPaid: boolean
  ): Promise<boolean> => {
    if (!supabase) return false;
    setUpdatingOrderId(pedidoId);
    try {
      const { data, error } = await supabase
        .from('pedidos')
        .update({ pago: nextPaid })
        .eq('id', pedidoId)
        .select('*')
        .single();

      if (error) throw error;

      const updated = normalizePedidoRow(data as Record<string, unknown>);
      setPedidos((prev) => prev.map((p) => (p.id === pedidoId ? updated : p)));
      showNotice(
        'ok',
        nextPaid
          ? `Pedido #${updated.numero} marcado como pago.`
          : `Pedido #${updated.numero} marcado como a receber.`
      );
      return true;
    } catch (err) {
      console.error('Erro ao atualizar pagamento do pedido:', err);
      showNotice(
        'err',
        translateSupabaseError(err, 'Erro ao atualizar pagamento do pedido.')
      );
      return false;
    } finally {
      setUpdatingOrderId(null);
    }
  };

  const handlePrintPedido = (pedido: Pedido) => {
    setPrintingPedido(pedido);
    requestAnimationFrame(() => {
      setTimeout(() => {
        window.print();
      }, 60);
    });
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;

    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      setAuthError('Informe seu e-mail e senha para entrar.');
      return;
    }

    setAuthError(null);
    setAuthMessage(null);
    setAuthSubmitting(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });
      if (error) {
        setAuthError(
          translateSupabaseError(error, 'Falha no login. Verifique e-mail e senha.')
        );
        return;
      }
    } catch (err) {
      setAuthError(
        translateSupabaseError(err, 'Falha no login. Verifique e-mail e senha.')
      );
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !email.trim()) {
      setAuthError('Informe seu e-mail para recuperar a senha.');
      return;
    }
    setAuthError(null);
    setAuthMessage(null);
    setAuthSubmitting(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: window.location.origin + '/painel',
      });
      if (error) {
        setAuthError(
          translateSupabaseError(error, 'Falha ao enviar e-mail de recuperação.')
        );
        return;
      }
      setAuthMessage('Enviamos instruções de redefinição de senha para o seu e-mail.');
    } catch (err) {
      setAuthError(
        translateSupabaseError(err, 'Falha ao enviar e-mail de recuperação.')
      );
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleFinalizeSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !session?.user) return;

    const cleanNome = onbNome.trim();
    const cleanSlug = onbSlug.trim();

    if (!cleanNome) {
      setOnbError('Preencha o nome do estabelecimento.');
      return;
    }

    const slugError = validateSlugFormat(cleanSlug);
    if (slugError) {
      setOnbError(slugError);
      return;
    }

    setOnbSubmitting(true);
    setOnbError(null);

    try {
      const { error: rpcError } = await supabase.rpc('criar_estabelecimento', {
        p_nome: cleanNome,
        p_slug: cleanSlug,
      });

      if (rpcError) throw rpcError;

      const cepDigits = cleanCepDigits(onbAddress.cep);
      const hasAddressInput = Boolean(
        cepDigits ||
          onbAddress.logradouro.trim() ||
          onbAddress.cidade.trim() ||
          onbAddress.mostrar_endereco
      );

      if (hasAddressInput) {
        const { error: addrErr } = await supabase
          .from('estabelecimentos')
          .update({
            cep: cepDigits || null,
            logradouro: onbAddress.logradouro.trim() || null,
            numero: onbAddress.numero.trim() || null,
            complemento: onbAddress.complemento.trim() || null,
            bairro_loja: onbAddress.bairro_loja.trim() || null,
            cidade: onbAddress.cidade.trim() || null,
            uf: onbAddress.uf.trim().toUpperCase() || null,
            latitude: onbAddress.latitude,
            longitude: onbAddress.longitude,
            mostrar_endereco: onbAddress.mostrar_endereco,
          })
          .eq('owner_id', session.user.id)
          .eq('slug', cleanSlug);

        if (addrErr) {
          console.error('Erro ao salvar endereço inicial:', addrErr);
        }
      }

      sessionStorage.removeItem(STORAGE_PENDING_REG);
      await loadOwnerEstablishment(session.user.id);
      showNotice('ok', 'Estabelecimento criado com sucesso!');
    } catch (err) {
      setOnbError(translateRpcError(err));
    } finally {
      setOnbSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  };

  const handleCopyPublicLink = async () => {
    if (!estabelecimento) return;
    const url = `${window.location.origin}/${estabelecimento.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // Ignorar
    }
  };

  // --- Aparência: Logo, Capa e Tema ---
  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !session?.user || !supabase || !estabelecimento) return;
    setUploadingLogo(true);
    setFeedback(null);

    try {
      const storagePath = `${session.user.id}/logo.webp`;
      const publicUrl = await processAndUploadImage(file, storagePath, {
        maxWidth: 400,
        maxHeight: 400,
        maxBytes: 450 * 1024,
        appendCacheBuster: true,
      });
      setApLogoUrl(publicUrl);

      const { data, error } = await supabase
        .from('estabelecimentos')
        .update({ logo_url: publicUrl })
        .eq('id', estabelecimento.id)
        .select('*')
        .single();

      if (!error && data) {
        setEstabelecimento(data as Estabelecimento);
      }
      showNotice('ok', 'Logo comprimida (máx. 400px WebP) e salva com sucesso!');
    } catch (err) {
      console.error('Erro ao enviar logo:', err);
      showNotice('err', translateSupabaseError(err, 'Erro ao enviar logo.'));
    } finally {
      setUploadingLogo(false);
      e.target.value = '';
    }
  };

  const handleRemoveLogo = async () => {
    if (!supabase || !estabelecimento) return;
    const oldUrl = apLogoUrl;
    setApLogoUrl('');
    try {
      await deleteStoragePhoto(oldUrl);
      const { data, error } = await supabase
        .from('estabelecimentos')
        .update({ logo_url: null })
        .eq('id', estabelecimento.id)
        .select('*')
        .single();
      if (error) throw error;
      setEstabelecimento(data as Estabelecimento);
      showNotice('ok', 'Logo removida. A inicial da sua loja será exibida no lugar.');
    } catch (err) {
      console.error('Erro ao remover logo:', err);
      showNotice('err', translateSupabaseError(err, 'Erro ao remover logo.'));
    }
  };

  const handleCapaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !session?.user || !supabase || !estabelecimento) return;
    setUploadingCapa(true);
    setFeedback(null);

    try {
      const storagePath = `${session.user.id}/capa.webp`;
      const publicUrl = await processAndUploadImage(file, storagePath, {
        maxWidth: 1400,
        maxHeight: 1000,
        maxBytes: 450 * 1024,
        appendCacheBuster: true,
      });
      setApCapaUrl(publicUrl);

      const { data, error } = await supabase
        .from('estabelecimentos')
        .update({ capa_url: publicUrl })
        .eq('id', estabelecimento.id)
        .select('*')
        .single();

      if (!error && data) {
        setEstabelecimento(data as Estabelecimento);
      }
      showNotice('ok', 'Capa comprimida (máx. 1400px WebP) e salva com sucesso!');
    } catch (err) {
      console.error('Erro ao enviar capa:', err);
      showNotice('err', translateSupabaseError(err, 'Erro ao enviar capa.'));
    } finally {
      setUploadingCapa(false);
      e.target.value = '';
    }
  };

  const handleRemoveCapa = async () => {
    if (!supabase || !estabelecimento) return;
    const oldUrl = apCapaUrl;
    setApCapaUrl('');
    try {
      await deleteStoragePhoto(oldUrl);
      const { data, error } = await supabase
        .from('estabelecimentos')
        .update({ capa_url: null })
        .eq('id', estabelecimento.id)
        .select('*')
        .single();
      if (error) throw error;
      setEstabelecimento(data as Estabelecimento);
      showNotice('ok', 'Capa removida. Um degradê do tema selecionado será usado.');
    } catch (err) {
      console.error('Erro ao remover capa:', err);
      showNotice('err', translateSupabaseError(err, 'Erro ao remover capa.'));
    }
  };

  const handleSaveAppearance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !estabelecimento) return;
    setApSaving(true);
    setFeedback(null);

    try {
      const presetColors =
        apTema !== 'personalizado'
          ? {
              cor_primaria: THEME_PRESETS[apTema].accent,
              cor_secundaria: THEME_PRESETS[apTema].secondary,
            }
          : {
              cor_primaria: apCorPrimaria,
              cor_secundaria: apCorSecundaria,
            };

      const { data, error } = await supabase
        .from('estabelecimentos')
        .update({
          tema: apTema,
          cor_primaria: presetColors.cor_primaria,
          cor_secundaria: presetColors.cor_secundaria,
          logo_url: apLogoUrl.trim() || null,
          capa_url: apCapaUrl.trim() || null,
        })
        .eq('id', estabelecimento.id)
        .select('*')
        .single();

      if (error) throw error;
      const updated = data as Estabelecimento;
      setEstabelecimento(updated);
      syncFormStateFromEstablishment(updated);
      showNotice('ok', 'Aparência e tema salvos com sucesso!');
    } catch (err) {
      console.error('Erro ao salvar aparência:', err);
      showNotice('err', translateSupabaseError(err, 'Erro ao salvar aparência.'));
    } finally {
      setApSaving(false);
    }
  };

  // --- Entrega ---
  const handleSaveDelivery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !estabelecimento) return;

    const taxaFixaVal = centsToNumber(delTaxaFixaCents);
    if (taxaFixaVal === null || taxaFixaVal < 0) {
      showNotice('err', 'Informe uma taxa fixa válida.');
      return;
    }

    const freteGratisVal = centsToNumber(delFreteGratisCents);
    const pedidoMinimoVal = centsToNumber(delPedidoMinimoCents);

    setDelSaving(true);
    setFeedback(null);

    try {
      const { data, error } = await supabase
        .from('estabelecimentos')
        .update({
          aceita_entrega: delAceitaEntrega,
          aceita_retirada: delAceitaRetirada,
          modo_entrega: delModo,
          taxa_entrega: taxaFixaVal,
          entrega_gratis_acima: freteGratisVal && freteGratisVal > 0 ? freteGratisVal : null,
          pedido_minimo: pedidoMinimoVal && pedidoMinimoVal > 0 ? pedidoMinimoVal : null,
          tempo_estimado: delTempoEstimado.trim() || null,
        })
        .eq('id', estabelecimento.id)
        .select('*')
        .single();

      if (error) throw error;
      const updated = data as Estabelecimento;
      setEstabelecimento(updated);
      syncFormStateFromEstablishment(updated);
      showNotice('ok', 'Configurações de entrega salvas!');
    } catch (err) {
      console.error('Erro ao salvar entrega:', err);
      showNotice('err', translateSupabaseError(err, 'Erro ao salvar entrega.'));
    } finally {
      setDelSaving(false);
    }
  };

  const openConfigTab = () => {
    if (estabelecimento) {
      setCfgNome(estabelecimento.nome || '');
      setCfgSlug(estabelecimento.slug || '');
      setCfgWhatsapp(formatWhatsAppMask(estabelecimento.whatsapp));
      setCfgPix(estabelecimento.chave_pix || '');
      setCfgLink(estabelecimento.link_pagamento || '');
      setCfgHorario(estabelecimento.horario || '');
      setCfgAddress({
        cep: formatCepMask(estabelecimento.cep),
        logradouro: estabelecimento.logradouro || '',
        numero: estabelecimento.numero || '',
        complemento: estabelecimento.complemento || '',
        bairro_loja: estabelecimento.bairro_loja || '',
        cidade: estabelecimento.cidade || '',
        uf: estabelecimento.uf || '',
        latitude:
          estabelecimento.latitude !== null && estabelecimento.latitude !== undefined
            ? Number(estabelecimento.latitude)
            : null,
        longitude:
          estabelecimento.longitude !== null && estabelecimento.longitude !== undefined
            ? Number(estabelecimento.longitude)
            : null,
        mostrar_endereco: Boolean(estabelecimento.mostrar_endereco),
      });

      if (supabase) {
        supabase
          .from('estabelecimentos')
          .select('*')
          .eq('id', estabelecimento.id)
          .maybeSingle()
          .then(({ data, error }) => {
            if (error) {
              console.error('Erro ao carregar Dados da loja:', error);
              return;
            }
            if (data) {
              const latest = data as Estabelecimento;
              setEstabelecimento(latest);
              syncFormStateFromEstablishment(latest);
            }
          });
      }
    }
    setActiveTab('config');
  };

  const handleConfirmConfigAddress = async (resolved: StoreAddressState) => {
    if (!supabase || !estabelecimento) return;
    const cepDigits = cleanCepDigits(resolved.cep);
    if (cepDigits.length > 0 && cepDigits.length !== 8) {
      showNotice('err', 'O CEP deve conter exatamente 8 dígitos.');
      return;
    }

    try {
      const { data, error } = await supabase
        .from('estabelecimentos')
        .update({
          cep: cepDigits || null,
          logradouro: resolved.logradouro.trim() || null,
          numero: resolved.numero.trim() || null,
          complemento: resolved.complemento.trim() || null,
          bairro_loja: resolved.bairro_loja.trim() || null,
          cidade: resolved.cidade.trim() || null,
          uf: resolved.uf.trim().toUpperCase() || null,
          latitude: resolved.latitude,
          longitude: resolved.longitude,
          mostrar_endereco: resolved.mostrar_endereco,
        })
        .eq('id', estabelecimento.id)
        .select('*')
        .single();

      if (error) throw error;
      const updated = data as Estabelecimento;
      setEstabelecimento(updated);
    } catch (err) {
      console.error('Erro ao salvar endereço confirmado:', err);
      showNotice('err', translateSupabaseError(err, 'Erro ao salvar endereço da loja.'));
    }
  };

  // --- Salvar Dados da Loja (Sem alterar slug) ---
  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !estabelecimento) return;

    const cleanNome = cfgNome.trim();
    if (cleanNome.length < 2) {
      showNotice('err', 'O nome do estabelecimento deve ter pelo menos 2 caracteres.');
      return;
    }

    const cleanWpp = toWhatsAppStorageDigits(cfgWhatsapp);
    if (cleanWpp.length < 12 || cleanWpp.length > 13 || !cleanWpp.startsWith('55')) {
      showNotice(
        'err',
        'Informe um WhatsApp válido com DDD (10 ou 11 dígitos, ex: (11) 99999-9999).'
      );
      return;
    }

    const trimmedLink = cfgLink.trim();
    if (trimmedLink) {
      if (!trimmedLink.startsWith('https://') || !sanitizeExternalUrl(trimmedLink)) {
        showNotice('err', 'O link de pagamento deve começar com https://');
        return;
      }
    }

    const cepDigits = cleanCepDigits(cfgAddress.cep);
    if (cepDigits.length > 0 && cepDigits.length !== 8) {
      showNotice('err', 'O CEP deve conter exatamente 8 dígitos (ou ficar em branco).');
      return;
    }

    setCfgSaving(true);
    setFeedback(null);

    try {
      const { data, error } = await supabase
        .from('estabelecimentos')
        .update({
          nome: cleanNome,
          whatsapp: cleanWpp,
          chave_pix: cfgPix.trim(),
          link_pagamento: trimmedLink,
          horario: cfgHorario.trim(),
          cep: cepDigits || null,
          logradouro: cfgAddress.logradouro.trim() || null,
          numero: cfgAddress.numero.trim() || null,
          complemento: cfgAddress.complemento.trim() || null,
          bairro_loja: cfgAddress.bairro_loja.trim() || null,
          cidade: cfgAddress.cidade.trim() || null,
          uf: cfgAddress.uf.trim().toUpperCase() || null,
          latitude: cfgAddress.latitude,
          longitude: cfgAddress.longitude,
          mostrar_endereco: cfgAddress.mostrar_endereco,
        })
        .eq('id', estabelecimento.id)
        .select('*')
        .single();

      if (error) {
        console.error('Erro ao salvar Dados da loja no Supabase:', error);
        showNotice('err', translateSupabaseError(error, 'Erro ao salvar dados no Supabase.'));
        return;
      }

      const updated = data as Estabelecimento;
      setEstabelecimento(updated);
      syncFormStateFromEstablishment(updated);
      showNotice('ok', 'Dados da loja salvos com sucesso!');
    } catch (err) {
      console.error('Erro inesperado ao salvar Dados da loja:', err);
      showNotice('err', translateSupabaseError(err, 'Erro ao salvar configurações.'));
    } finally {
      setCfgSaving(false);
    }
  };

  // --- Categorias ---
  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !estabelecimento) return;
    const nome = newCatNome.trim();
    if (!nome) return;

    try {
      const nextOrdem =
        categorias.length > 0 ? Math.max(...categorias.map((c) => c.ordem)) + 1 : 1;
      const { data, error } = await supabase
        .from('categorias')
        .insert({
          estabelecimento_id: estabelecimento.id,
          nome,
          ordem: nextOrdem,
        })
        .select('*')
        .single();

      if (error) throw error;
      setCategorias((prev) => [...prev, data as Categoria]);
      setNewCatNome('');
      showNotice('ok', 'Categoria criada com sucesso.');
    } catch (err) {
      console.error('Erro ao criar categoria:', err);
      showNotice('err', translateSupabaseError(err, 'Erro ao criar categoria.'));
    }
  };

  const handleSaveCategoryName = async (id: string) => {
    if (!supabase) return;
    const nome = editingCatNome.trim();
    if (!nome) return;

    try {
      const { error } = await supabase.from('categorias').update({ nome }).eq('id', id);
      if (error) throw error;
      setCategorias((prev) => prev.map((c) => (c.id === id ? { ...c, nome } : c)));
      setEditingCatId(null);
      showNotice('ok', 'Categoria atualizada.');
    } catch (err) {
      console.error('Erro ao atualizar categoria:', err);
      showNotice('err', translateSupabaseError(err, 'Erro ao atualizar categoria.'));
    }
  };

  const handleMoveCategory = async (index: number, direction: -1 | 1) => {
    if (!supabase) return;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= categorias.length) return;

    const current = categorias[index];
    const target = categorias[targetIndex];
    const updated = [...categorias];
    updated[index] = { ...target, ordem: current.ordem };
    updated[targetIndex] = { ...current, ordem: target.ordem };
    updated.sort((a, b) => a.ordem - b.ordem);
    setCategorias(updated);

    try {
      const [res1, res2] = await Promise.all([
        supabase.from('categorias').update({ ordem: target.ordem }).eq('id', current.id),
        supabase.from('categorias').update({ ordem: current.ordem }).eq('id', target.id),
      ]);
      if (res1.error) throw res1.error;
      if (res2.error) throw res2.error;
    } catch (err) {
      console.error('Erro ao reordenar categorias:', err);
      showNotice('err', translateSupabaseError(err, 'Erro ao reordenar categorias.'));
    }
  };

  const handleDeleteCategory = async (catId: string) => {
    if (!window.confirm('Tem certeza que deseja excluir esta categoria? Os produtos ficarão sem categoria.')) {
      return;
    }
    if (!supabase) return;

    try {
      const { error } = await supabase.from('categorias').delete().eq('id', catId);
      if (error) throw error;
      setCategorias((prev) => prev.filter((c) => c.id !== catId));
      setProdutos((prev) =>
        prev.map((p) => (p.categoria_id === catId ? { ...p, categoria_id: null } : p))
      );
      showNotice('ok', 'Categoria excluída.');
    } catch (err) {
      console.error('Erro ao excluir categoria:', err);
      showNotice('err', translateSupabaseError(err, 'Erro ao excluir categoria.'));
    }
  };

  // --- Produtos ---
  const openNewProductModal = () => {
    setEditingProduto(null);
    setProdNome('');
    setProdDesc('');
    setProdPrecoCents(0);
    setProdCategoriaId(categorias[0]?.id || '');
    setProdFotoUrl('');
    setProdAtivo(true);
    setProductModalOpen(true);
  };

  const openEditProductModal = (prod: Produto) => {
    setEditingProduto(prod);
    setProdNome(prod.nome);
    setProdDesc(prod.descricao || '');
    setProdPrecoCents(numberToCents(prod.preco) ?? 0);
    setProdCategoriaId(prod.categoria_id || '');
    setProdFotoUrl(prod.foto_url || '');
    setProdAtivo(prod.ativo);
    setProductModalOpen(true);
  };

  const handleProductPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !session?.user) return;
    setUploadingPhoto(true);
    setFeedback(null);

    try {
      const tempId = editingProduto?.id || `new-${Date.now()}`;
      const storagePath = `${session.user.id}/${tempId}.webp`;
      const publicUrl = await processAndUploadImage(file, storagePath, {
        maxWidth: 1000,
        maxHeight: 1000,
        maxBytes: 450 * 1024,
        appendCacheBuster: true,
      });
      setProdFotoUrl(publicUrl);
      showNotice('ok', 'Foto redimensionada e enviada para o Storage.');
    } catch (err) {
      console.error('Erro ao enviar foto do produto:', err);
      showNotice('err', translateSupabaseError(err, 'Falha ao enviar foto.'));
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !estabelecimento) return;

    const cleanNome = prodNome.trim();
    const numericPreco = centsToNumber(prodPrecoCents);
    if (!cleanNome) {
      showNotice('err', 'Informe o nome do produto.');
      return;
    }
    if (numericPreco === null || numericPreco < 0) {
      showNotice('err', 'Informe um preço válido.');
      return;
    }

    setSavingProduct(true);
    setFeedback(null);

    try {
      const payload = {
        estabelecimento_id: estabelecimento.id,
        categoria_id: prodCategoriaId || null,
        nome: cleanNome,
        descricao: prodDesc.trim(),
        preco: numericPreco,
        foto_url: prodFotoUrl.trim(),
        ativo: prodAtivo,
      };

      if (editingProduto) {
        const { data, error } = await supabase
          .from('produtos')
          .update(payload)
          .eq('id', editingProduto.id)
          .select('*')
          .single();

        if (error) throw error;
        const updated = data as Produto;
        setProdutos((prev) =>
          prev.map((p) => (p.id === editingProduto.id ? { ...updated, preco: Number(updated.preco) } : p))
        );
        showNotice('ok', 'Produto atualizado com sucesso!');
      } else {
        const nextOrdem =
          produtos.length > 0 ? Math.max(...produtos.map((p) => p.ordem)) + 1 : 1;
        const { data, error } = await supabase
          .from('produtos')
          .insert({ ...payload, ordem: nextOrdem })
          .select('*')
          .single();

        if (error) throw error;
        const inserted = data as Produto;
        setProdutos((prev) => [...prev, { ...inserted, preco: Number(inserted.preco) }]);
        showNotice('ok', 'Produto cadastrado com sucesso!');
      }

      setProductModalOpen(false);
    } catch (err) {
      console.error('Erro ao salvar produto:', err);
      setFeedback({
        type: 'err',
        text: translateRpcError(err),
      });
    } finally {
      setSavingProduct(false);
    }
  };

  const handleToggleProductActive = async (prod: Produto) => {
    if (!supabase) return;
    try {
      const nextAtivo = !prod.ativo;
      const { error } = await supabase
        .from('produtos')
        .update({ ativo: nextAtivo })
        .eq('id', prod.id);

      if (error) throw error;
      setProdutos((prev) =>
        prev.map((p) => (p.id === prod.id ? { ...p, ativo: nextAtivo } : p))
      );
    } catch (err) {
      console.error('Erro ao alterar status do produto:', err);
      showNotice('err', translateSupabaseError(err, 'Erro ao alterar status do produto.'));
    }
  };

  const handleDeleteProduct = async (prod: Produto) => {
    if (!window.confirm(`Tem certeza que deseja excluir o produto "${prod.nome}"?`)) {
      return;
    }
    if (!supabase) return;

    try {
      await deleteStoragePhoto(prod.foto_url);
      const { error } = await supabase.from('produtos').delete().eq('id', prod.id);
      if (error) throw error;

      setProdutos((prev) => prev.filter((p) => p.id !== prod.id));
      showNotice('ok', 'Produto excluído com sucesso.');
    } catch (err) {
      console.error('Erro ao excluir produto:', err);
      showNotice('err', translateSupabaseError(err, 'Erro ao excluir produto.'));
    }
  };

  if (!isSupabaseConfigured) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-4 shadow-sm">
          <Store className="w-10 h-10 text-slate-400 mx-auto" />
          <h1 className="text-xl font-semibold text-slate-900">Supabase não configurado</h1>
          <p className="text-sm text-slate-600">
            Configure as variáveis <code className="font-mono text-xs">VITE_SUPABASE_URL</code> e{' '}
            <code className="font-mono text-xs">VITE_SUPABASE_ANON_KEY</code> no arquivo .env ou nos Secrets do AI Studio.
          </p>
          <button
            type="button"
            onClick={() => onNavigate('/')}
            className="min-h-[44px] px-5 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-medium"
          >
            Voltar ao início
          </button>
        </div>
      </div>
    );
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-slate-300 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  // Tela de Login / Recuperação de Senha
  if (!session) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <header className="h-14 border-b border-slate-200 bg-white px-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => onNavigate('/')}
            className="min-h-[44px] inline-flex items-center gap-2 text-sm font-semibold text-slate-700 hover:text-slate-900"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Voltar ao início</span>
          </button>
          <span className="font-bold text-slate-900 text-sm">Painel do Dono</span>
          <div className="w-24" />
        </header>

        <main className="flex-1 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6 shadow-sm">
            {authView === 'login' ? (
              <>
                <div>
                  <h1 className="text-xl font-bold text-slate-900">Entrar no Painel</h1>
                  <p className="text-sm text-slate-600 mt-1">
                    Acesse com suas credenciais de proprietário.
                  </p>
                </div>

                <form onSubmit={handleLogin} className="space-y-4">
                  <div>
                    <label htmlFor="login-email" className="block text-xs font-semibold text-slate-700 mb-1">
                      E-mail
                    </label>
                    <input
                      id="login-email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        if (authError) setAuthError(null);
                      }}
                      placeholder="seu@email.com"
                      className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label htmlFor="login-pass" className="block text-xs font-semibold text-slate-700">
                        Senha
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setAuthView('forgot');
                          setAuthError(null);
                          setAuthMessage(null);
                        }}
                        className="text-xs text-emerald-700 hover:text-emerald-800 font-semibold"
                      >
                        Esqueci minha senha
                      </button>
                    </div>
                    <div className="relative">
                      <input
                        id="login-pass"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="current-password"
                        required
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          if (authError) setAuthError(null);
                        }}
                        placeholder="••••••••"
                        className="w-full min-h-[44px] pl-3.5 pr-11 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((prev) => !prev)}
                        aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 flex items-center justify-center"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {authError && (
                    <p className="text-xs font-semibold text-rose-600 bg-rose-50 border border-rose-200 rounded-xl p-3" role="alert">
                      {authError}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={authSubmitting}
                    className="w-full min-h-[48px] rounded-xl bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 text-sm font-bold shadow-xs transition-colors"
                  >
                    {authSubmitting ? 'Entrando...' : 'Entrar no painel'}
                  </button>

                  <div className="text-center pt-3 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => onNavigate('/cadastro')}
                      className="text-xs text-slate-600 hover:text-slate-900 font-semibold"
                    >
                      Não tem uma conta? <span className="text-emerald-700 underline">Criar conta</span>
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <>
                <div>
                  <h1 className="text-xl font-bold text-slate-900">Recuperar Senha</h1>
                  <p className="text-sm text-slate-600 mt-1">
                    Enviaremos um link para você redefinir sua senha.
                  </p>
                </div>

                <form onSubmit={handleForgotPassword} className="space-y-4">
                  <div>
                    <label htmlFor="forgot-email" className="block text-xs font-semibold text-slate-700 mb-1">
                      E-mail cadastrado
                    </label>
                    <input
                      id="forgot-email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="seu@email.com"
                      className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2"
                    />
                  </div>

                  {authError && (
                    <p className="text-xs font-semibold text-rose-600 bg-rose-50 border border-rose-200 rounded-xl p-3" role="alert">
                      {authError}
                    </p>
                  )}

                  {authMessage && (
                    <p className="text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl p-3" role="alert">
                      {authMessage}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={authSubmitting}
                    className="w-full min-h-[48px] rounded-xl bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 text-sm font-bold shadow-xs transition-colors"
                  >
                    {authSubmitting ? 'Enviando...' : 'Enviar link de recuperação'}
                  </button>

                  <div className="text-center pt-3 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => {
                        setAuthView('login');
                        setAuthError(null);
                        setAuthMessage(null);
                      }}
                      className="text-xs text-slate-600 hover:text-slate-900 font-semibold"
                    >
                      Voltar ao login
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </main>
      </div>
    );
  }

  if (dataLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-slate-300 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  // Primeiro login sem estabelecimento (Finalize seu cadastro - apenas nome e slug)
  if (needsEstablishmentSetup) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <header className="h-14 border-b border-slate-200 bg-white px-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => onNavigate('/')}
            className="min-h-[40px] px-2.5 rounded-lg text-slate-600 hover:bg-slate-100 inline-flex items-center gap-1.5 text-sm font-medium"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Início</span>
          </button>
          <span className="font-bold text-slate-900 text-sm">Finalizar Cadastro</span>
          <button
            type="button"
            onClick={handleSignOut}
            className="min-h-[40px] px-3.5 py-2 rounded-xl bg-slate-900 text-white hover:bg-slate-800 text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <LogOut className="w-4 h-4" />
            <span>Sair</span>
          </button>
        </header>

        <main className="flex-1 flex items-center justify-center p-4 py-8">
          <div className="w-full max-w-xl bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6 shadow-sm">
            <div>
              <h1 className="text-xl font-bold text-slate-900">Finalize seu cadastro</h1>
              <p className="text-sm text-slate-600 mt-1">
                Informe os dados básicos e o endereço (opcional) do seu estabelecimento para continuar.
              </p>
            </div>

            <form onSubmit={handleFinalizeSetup} className="space-y-5">
              <div>
                <label htmlFor="onb-nome" className="block text-xs font-semibold text-slate-700 mb-1">
                  Nome do Estabelecimento *
                </label>
                <input
                  id="onb-nome"
                  type="text"
                  required
                  value={onbNome}
                  onChange={(e) => {
                    const v = e.target.value;
                    setOnbNome(v);
                    if (!onbSlug || onbSlug === slugify(onbNome)) {
                      setOnbSlug(slugify(v));
                    }
                  }}
                  placeholder="Ex: Cantina Italiana"
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 text-sm"
                />
              </div>

              <SlugField
                id="onb-slug"
                value={onbSlug}
                onChange={setOnbSlug}
                cidadeHint={onbAddress.cidade}
                placeholder="ajlb"
              />

              <div className="pt-3 border-t border-slate-100 space-y-3">
                <div>
                  <h2 className="text-sm font-bold text-slate-900">
                    Endereço da loja (opcional)
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Consulte o CEP para preencher automaticamente e habilitar a busca de bairros próximos.
                  </p>
                </div>
                <StoreAddressFields
                  value={onbAddress}
                  onChange={setOnbAddress}
                  idPrefix="onb-addr"
                />
              </div>

              {onbError && (
                <p className="text-xs font-semibold text-rose-600 bg-rose-50 border border-rose-200 rounded-xl p-3" role="alert">
                  {onbError}
                </p>
              )}

              <button
                type="submit"
                disabled={onbSubmitting}
                className="w-full min-h-[48px] rounded-xl bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 text-sm font-bold shadow-xs"
              >
                {onbSubmitting ? 'Salvando...' : 'Concluir configuração'}
              </button>
            </form>
          </div>
        </main>
      </div>
    );
  }

  if (!estabelecimento) {
    return null;
  }

  // Checklist de configuração
  const hasWhatsappAndPix = Boolean(
    (estabelecimento.whatsapp || '').trim() && (estabelecimento.chave_pix || '').trim()
  );
  const hasCategories = categorias.length > 0;
  const hasProducts = produtos.length > 0;
  const isDeliveryByAreaEmpty =
    estabelecimento.aceita_entrega !== false &&
    estabelecimento.modo_entrega === 'bairro' &&
    bairros.length === 0;
  const hasDeliveryAreasConfigured =
    estabelecimento.aceita_entrega === false ||
    estabelecimento.modo_entrega !== 'bairro' ||
    bairros.length > 0;
  const checklistComplete =
    hasWhatsappAndPix && hasCategories && hasProducts && hasDeliveryAreasConfigured;

  const publicMenuUrl = `${window.location.origin}/${estabelecimento.slug}`;
  const shareWhatsappUrl = `https://wa.me/?text=${encodeURIComponent(
    `Confira o cardápio digital de ${estabelecimento.nome}: ${publicMenuUrl}`
  )}`;

  const previewTheme = resolveStoreTheme({
    tema: apTema,
    cor_primaria: apCorPrimaria,
    cor_secundaria: apCorSecundaria,
  });
  const storeInitial = (estabelecimento.nome || 'L').trim().charAt(0).toUpperCase();

  const newOrdersCount = pedidos.filter((p) => p.status === 'novo').length;

  return (
    <>
      <div className="min-h-screen bg-slate-50 text-slate-900 print:hidden">
      {/* Top Bar do Painel */}
      <header className="sticky top-0 z-30 h-14 bg-white border-b border-slate-200 shadow-xs">
        <div className="max-w-6xl mx-auto h-full px-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => onNavigate('/')}
              className="min-h-[40px] px-2.5 rounded-lg text-slate-600 hover:bg-slate-100 inline-flex items-center gap-1.5 text-sm font-medium"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Início</span>
            </button>
            <span className="font-bold text-slate-900 truncate">{estabelecimento.nome}</span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate(`/${estabelecimento.slug}`)}
              className="min-h-[40px] px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs sm:text-sm font-semibold text-slate-800 whitespace-nowrap inline-flex items-center gap-1.5"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Ver meu cardápio</span>
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              className="min-h-[40px] px-3.5 py-2 rounded-xl bg-slate-900 text-white hover:bg-slate-800 text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <LogOut className="w-4 h-4" />
              <span>Sair</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Aviso no topo enquanto WhatsApp ou Pix estiverem vazios */}
        {(!((estabelecimento.whatsapp || '').trim()) || !((estabelecimento.chave_pix || '').trim())) && (
          <div
            role="alert"
            className="bg-amber-50 border border-amber-300 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-amber-950">
                  Complete seus dados para receber pedidos
                </p>
                <p className="text-xs text-amber-800 mt-0.5">
                  {!(estabelecimento.whatsapp || '').trim() && !(estabelecimento.chave_pix || '').trim()
                    ? 'Preencha seu WhatsApp e sua Chave Pix na aba Dados da loja.'
                    : !(estabelecimento.whatsapp || '').trim()
                    ? 'Preencha seu número de WhatsApp na aba Dados da loja para receber pedidos.'
                    : 'Cadastre sua Chave Pix na aba Dados da loja para aceitar pagamentos via Pix.'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={openConfigTab}
              className="min-h-[44px] px-4 py-2 rounded-xl bg-amber-900 text-white hover:bg-amber-950 text-xs sm:text-sm font-bold whitespace-nowrap shrink-0 shadow-xs transition-colors"
            >
              Ir para Dados da loja
            </button>
          </div>
        )}

        {/* Aviso no topo se modo "Por cidade e bairro" está ativo sem áreas cadastradas */}
        {isDeliveryByAreaEmpty && (
          <div
            role="alert"
            className="bg-amber-50 border border-amber-300 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs"
          >
            <div className="flex items-start gap-3">
              <Truck className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-amber-950">
                  Cadastre suas áreas de entrega por cidade e bairro
                </p>
                <p className="text-xs text-amber-800 mt-0.5">
                  O modo "Por cidade e bairro" está selecionado, mas nenhuma região foi cadastrada ainda.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('entrega')}
              className="min-h-[44px] px-4 py-2 rounded-xl bg-amber-900 text-white hover:bg-amber-950 text-xs sm:text-sm font-bold whitespace-nowrap shrink-0 shadow-xs transition-colors"
            >
              Cadastrar áreas agora
            </button>
          </div>
        )}

        {/* Card SEMPRE VISÍVEL: Link da sua loja (Copiar link, Compartilhar no WhatsApp e QR Code) */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-4 shadow-xs">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-bold text-slate-900">Link da sua loja</h2>
            <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full">
              Ativo
            </span>
          </div>

          <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-2">
            <input
              type="text"
              readOnly
              value={publicMenuUrl}
              aria-label="Link público da loja"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm font-mono text-slate-800 focus:outline-none"
            />
            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleCopyPublicLink}
                className="flex-1 sm:flex-initial min-h-[44px] px-4 py-2.5 rounded-xl bg-slate-900 text-white hover:bg-slate-800 text-sm font-bold inline-flex items-center justify-center gap-2 whitespace-nowrap shadow-xs"
              >
                {linkCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span>{linkCopied ? 'Copiado!' : 'Copiar link'}</span>
              </button>
              <a
                href={shareWhatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 sm:flex-initial min-h-[44px] px-4 py-2.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 text-sm font-bold inline-flex items-center justify-center gap-2 whitespace-nowrap shadow-xs"
              >
                <MessageCircle className="w-4 h-4" />
                <span>Compartilhar no WhatsApp</span>
              </a>
              <button
                type="button"
                onClick={() => setActiveTab('qrcode')}
                className="flex-1 sm:flex-initial min-h-[44px] px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 text-sm font-bold inline-flex items-center justify-center gap-2 whitespace-nowrap shadow-xs"
              >
                <QrCode className="w-4 h-4" />
                <span>QR Code</span>
              </button>
            </div>
          </div>
        </div>

        {/* Checklist simples: Complete seu cardápio */}
        {!checklistComplete && (
          <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900">Complete seu cardápio</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              <button
                type="button"
                onClick={openConfigTab}
                className={`p-3 rounded-xl border flex items-center gap-2 text-left transition-colors ${
                  hasWhatsappAndPix
                    ? 'bg-emerald-50/50 border-emerald-200 text-emerald-900'
                    : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                }`}
              >
                {hasWhatsappAndPix ? <Check className="w-4 h-4 text-emerald-700 shrink-0" /> : <div className="w-4 h-4 rounded-full border border-slate-400 shrink-0" />}
                <span>1. Preencher WhatsApp e Pix</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('categorias')}
                className={`p-3 rounded-xl border flex items-center gap-2 text-left transition-colors ${
                  hasCategories
                    ? 'bg-emerald-50/50 border-emerald-200 text-emerald-900'
                    : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                }`}
              >
                {hasCategories ? <Check className="w-4 h-4 text-emerald-700 shrink-0" /> : <div className="w-4 h-4 rounded-full border border-slate-400 shrink-0" />}
                <span>2. Criar categorias</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('produtos')}
                className={`p-3 rounded-xl border flex items-center gap-2 text-left transition-colors ${
                  hasProducts
                    ? 'bg-emerald-50/50 border-emerald-200 text-emerald-900'
                    : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                }`}
              >
                {hasProducts ? <Check className="w-4 h-4 text-emerald-700 shrink-0" /> : <div className="w-4 h-4 rounded-full border border-slate-400 shrink-0" />}
                <span>3. Cadastrar produtos</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('entrega')}
                className={`p-3 rounded-xl border flex items-center gap-2 text-left transition-colors ${
                  hasDeliveryAreasConfigured && bairros.length > 0
                    ? 'bg-emerald-50/50 border-emerald-200 text-emerald-900'
                    : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                }`}
              >
                {hasDeliveryAreasConfigured && bairros.length > 0 ? (
                  <Check className="w-4 h-4 text-emerald-700 shrink-0" />
                ) : (
                  <div className="w-4 h-4 rounded-full border border-slate-400 shrink-0" />
                )}
                <span>4. Cadastrar áreas de entrega e valores</span>
              </button>
            </div>
          </div>
        )}

        {feedback && (
          <div
            role="status"
            className={`px-4 py-3 rounded-xl border text-sm font-semibold flex items-center justify-between gap-3 shadow-xs ${
              feedback.type === 'ok'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-rose-50 border-rose-200 text-rose-900'
            }`}
          >
            <span>{feedback.text}</span>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="text-xs underline shrink-0"
            >
              Fechar
            </button>
          </div>
        )}

        {/* Abas do Painel (sempre visíveis sem esconder Dados da loja) */}
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 pb-1 border-b border-slate-200">
          <button
            type="button"
            onClick={() => setActiveTab('pedidos')}
            className={`min-h-[44px] px-3.5 py-2 text-sm font-semibold inline-flex items-center gap-2 border-b-2 whitespace-nowrap transition-colors ${
              activeTab === 'pedidos'
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <ShoppingBag className="w-4 h-4" />
            <span>Pedidos</span>
            {newOrdersCount > 0 && (
              <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-rose-600 text-white text-[11px] font-bold tabular-nums inline-flex items-center justify-center">
                {newOrdersCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={openConfigTab}
            className={`min-h-[44px] px-3.5 py-2 text-sm font-semibold inline-flex items-center gap-2 border-b-2 whitespace-nowrap transition-colors ${
              activeTab === 'config'
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Settings className="w-4 h-4" />
            <span>Dados da loja</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('produtos')}
            className={`min-h-[44px] px-3.5 py-2 text-sm font-semibold inline-flex items-center gap-2 border-b-2 whitespace-nowrap transition-colors ${
              activeTab === 'produtos'
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <UtensilsCrossed className="w-4 h-4" />
            <span>Produtos ({produtos.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('categorias')}
            className={`min-h-[44px] px-3.5 py-2 text-sm font-semibold inline-flex items-center gap-2 border-b-2 whitespace-nowrap transition-colors ${
              activeTab === 'categorias'
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Tag className="w-4 h-4" />
            <span>Categorias ({categorias.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('entrega')}
            className={`min-h-[44px] px-3.5 py-2 text-sm font-semibold inline-flex items-center gap-2 border-b-2 whitespace-nowrap transition-colors ${
              activeTab === 'entrega'
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Truck className="w-4 h-4" />
            <span>Entrega</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('aparencia')}
            className={`min-h-[44px] px-3.5 py-2 text-sm font-semibold inline-flex items-center gap-2 border-b-2 whitespace-nowrap transition-colors ${
              activeTab === 'aparencia'
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Palette className="w-4 h-4" />
            <span>Aparência</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('qrcode')}
            className={`min-h-[44px] px-3.5 py-2 text-sm font-semibold inline-flex items-center gap-2 border-b-2 whitespace-nowrap transition-colors ${
              activeTab === 'qrcode'
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <QrCode className="w-4 h-4" />
            <span>QR Code</span>
          </button>
        </div>

        {/* ABA 0: PEDIDOS */}
        {activeTab === 'pedidos' && (
          <OwnerOrdersTab
            estabelecimentoNome={estabelecimento.nome}
            pedidos={pedidos}
            loading={pedidosLoading}
            newlyArrivedIds={newlyArrivedIds}
            updatingOrderId={updatingOrderId}
            onRefresh={() => fetchPedidos(estabelecimento.id)}
            onUpdateStatus={handleUpdateOrderStatus}
            onTogglePaid={handleToggleOrderPaid}
            onPrintPedido={handlePrintPedido}
          />
        )}

        {/* ABA 1: PRODUTOS */}
        {activeTab === 'produtos' && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h1 className="text-xl font-bold text-slate-900">Gerenciar Produtos</h1>
                <p className="text-sm text-slate-600">
                  Adicione, edite preços, envie fotos e altere a visibilidade dos itens (Limite: 100 produtos).
                </p>
              </div>
              <button
                type="button"
                onClick={openNewProductModal}
                className="min-h-[44px] px-5 py-2.5 rounded-xl bg-slate-900 text-white hover:bg-slate-800 text-sm font-bold inline-flex items-center gap-2 shadow-sm whitespace-nowrap"
              >
                <Plus className="w-4 h-4" />
                <span>Novo produto</span>
              </button>
            </div>

            {produtos.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center space-y-3 shadow-xs">
                <UtensilsCrossed className="w-8 h-8 text-slate-400 mx-auto" />
                <p className="text-base font-semibold text-slate-900">Nenhum produto cadastrado</p>
                <p className="text-sm text-slate-500">Crie seu primeiro item para aparecer no cardápio.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {produtos.map((prod) => {
                  const catNome =
                    categorias.find((c) => c.id === prod.categoria_id)?.nome || 'Sem categoria';
                  return (
                    <div
                      key={prod.id}
                      className={`bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs flex flex-col justify-between ${
                        !prod.ativo ? 'opacity-65' : ''
                      }`}
                    >
                      <div className="relative aspect-[4/3] bg-slate-100">
                        <ImageWithFallback
                          src={prod.foto_url}
                          alt={prod.nome}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="p-4 flex-1 flex flex-col justify-between gap-4">
                        <div>
                          <div className="flex items-center justify-between gap-2 text-xs text-slate-500 mb-1">
                            <span className="truncate">{catNome}</span>
                            <span className="shrink-0 font-semibold">
                              {prod.ativo ? 'Ativo' : 'Oculto'}
                            </span>
                          </div>
                          <h3 className="text-base font-bold text-slate-900 line-clamp-1">{prod.nome}</h3>
                          {prod.descricao && (
                            <p className="text-xs text-slate-600 line-clamp-2 mt-1 leading-relaxed">
                              {prod.descricao}
                            </p>
                          )}
                          <p className="text-base font-bold text-slate-900 tabular-nums mt-2">
                            {formatBRL(prod.preco)}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                          <button
                            type="button"
                            onClick={() => openEditProductModal(prod)}
                            className="flex-1 min-h-[40px] px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 inline-flex items-center justify-center gap-1.5"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            <span>Editar</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleProductActive(prod)}
                            className="min-h-[40px] px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 inline-flex items-center justify-center gap-1.5"
                          >
                            {prod.ativo ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            <span>{prod.ativo ? 'Ocultar' : 'Mostrar'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteProduct(prod)}
                            aria-label={`Excluir ${prod.nome}`}
                            className="min-h-[40px] w-10 rounded-xl border border-slate-200 text-rose-600 hover:bg-rose-50 inline-flex items-center justify-center"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ABA 2: CATEGORIAS */}
        {activeTab === 'categorias' && (
          <div className="max-w-2xl space-y-5">
            <div>
              <h1 className="text-xl font-bold text-slate-900">Gerenciar Categorias</h1>
              <p className="text-sm text-slate-600">
                Organize as seções do cardápio e defina a ordem de exibição.
              </p>
            </div>

            <form onSubmit={handleAddCategory} className="flex gap-2">
              <input
                type="text"
                required
                value={newCatNome}
                onChange={(e) => setNewCatNome(e.target.value)}
                placeholder="Nome da categoria (ex: Lanches, Bebidas)"
                className="flex-1 min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2"
              />
              <button
                type="submit"
                className="min-h-[44px] px-5 py-2.5 rounded-xl bg-slate-900 text-white hover:bg-slate-800 text-sm font-bold inline-flex items-center gap-2 whitespace-nowrap shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>Adicionar</span>
              </button>
            </form>

            <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100 shadow-xs">
              {categorias.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">
                  Nenhuma categoria cadastrada.
                </div>
              ) : (
                categorias.map((cat, idx) => (
                  <div key={cat.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
                    {editingCatId === cat.id ? (
                      <div className="flex-1 flex items-center gap-2 min-w-[200px]">
                        <input
                          type="text"
                          value={editingCatNome}
                          onChange={(e) => setEditingCatNome(e.target.value)}
                          className="flex-1 min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-200 text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => handleSaveCategoryName(cat.id)}
                          className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-emerald-700 text-white text-xs font-bold"
                        >
                          Salvar
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingCatId(null)}
                          className="min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-200 text-xs"
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <div>
                        <p className="text-sm font-bold text-slate-900">{cat.nome}</p>
                      </div>
                    )}

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleMoveCategory(idx, -1)}
                        disabled={idx === 0}
                        aria-label="Mover acima"
                        className="w-10 h-10 rounded-xl border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 disabled:opacity-30"
                      >
                        <ArrowUp className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMoveCategory(idx, 1)}
                        disabled={idx === categorias.length - 1}
                        aria-label="Mover abaixo"
                        className="w-10 h-10 rounded-xl border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 disabled:opacity-30"
                      >
                        <ArrowDown className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingCatId(cat.id);
                          setEditingCatNome(cat.nome);
                        }}
                        aria-label={`Editar ${cat.nome}`}
                        className="w-10 h-10 rounded-xl border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteCategory(cat.id)}
                        aria-label={`Excluir ${cat.nome}`}
                        className="w-10 h-10 rounded-xl border border-slate-200 flex items-center justify-center text-rose-600 hover:bg-rose-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ABA 3: ENTREGA CONFIGURÁVEL */}
        {activeTab === 'entrega' && (
          <OwnerDeliveryTab
            estabelecimento={estabelecimento}
            bairros={bairros}
            delAceitaEntrega={delAceitaEntrega}
            setDelAceitaEntrega={setDelAceitaEntrega}
            delAceitaRetirada={delAceitaRetirada}
            setDelAceitaRetirada={setDelAceitaRetirada}
            delModo={delModo}
            setDelModo={setDelModo}
            delTaxaFixaCents={delTaxaFixaCents}
            setDelTaxaFixaCents={setDelTaxaFixaCents}
            delFreteGratisCents={delFreteGratisCents}
            setDelFreteGratisCents={setDelFreteGratisCents}
            delPedidoMinimoCents={delPedidoMinimoCents}
            setDelPedidoMinimoCents={setDelPedidoMinimoCents}
            delTempoEstimado={delTempoEstimado}
            setDelTempoEstimado={setDelTempoEstimado}
            delSaving={delSaving}
            onSaveDelivery={handleSaveDelivery}
            onBairrosChange={setBairros}
            onNotify={showNotice}
            onOpenConfigTab={openConfigTab}
          />
        )}

        {/* ABA 4: APARÊNCIA (LOGO, CAPA E TEMAS PREMIUM) */}
        {activeTab === 'aparencia' && (
          <form
            onSubmit={handleSaveAppearance}
            className="max-w-4xl bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-8 shadow-xs"
          >
            <div>
              <h1 className="text-xl font-bold text-slate-900">Aparência do Cardápio</h1>
              <p className="text-sm text-slate-600 mt-1">
                Personalize logo, capa e escolha um tema visual para o seu estabelecimento.
              </p>
            </div>

            {/* Pré-visualização rápida do cabeçalho */}
            <div className="space-y-2">
              <span className="block text-xs font-semibold text-slate-700">
                Pré-visualização do cabeçalho
              </span>
              <div
                className="rounded-2xl overflow-hidden border"
                style={{
                  backgroundColor: previewTheme.bg,
                  color: previewTheme.text,
                  borderColor: previewTheme.border,
                }}
              >
                <div className="relative z-0 h-28 sm:h-36 w-full overflow-hidden">
                  {apCapaUrl.trim() ? (
                    <img
                      src={apCapaUrl}
                      alt="Prévia da capa"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div
                      className="w-full h-full"
                      style={{ background: previewTheme.coverGradient }}
                    />
                  )}
                </div>
                <div className="relative z-10 px-5 pb-5">
                  <div className="-mt-7 flex items-end justify-between gap-3">
                    <div
                      className="relative z-10 w-16 h-16 rounded-full overflow-hidden flex items-center justify-center shadow-md shrink-0"
                      style={{
                        border: `3px solid ${previewTheme.bg}`,
                        backgroundColor: apLogoUrl.trim() ? previewTheme.cardBg : previewTheme.accent,
                        color: previewTheme.accentText,
                      }}
                    >
                      {apLogoUrl.trim() ? (
                        <img
                          src={apLogoUrl}
                          alt="Prévia da logo"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-xl font-bold">{storeInitial}</span>
                      )}
                    </div>

                    <span
                      className="px-3.5 py-1.5 rounded-full text-xs font-bold shadow-xs"
                      style={{
                        backgroundColor: previewTheme.accent,
                        color: previewTheme.accentText,
                      }}
                    >
                      + Adicionar
                    </span>
                  </div>
                  <p className="mt-2 font-bold text-base">{estabelecimento.nome}</p>
                  <p className="text-xs" style={{ color: previewTheme.mutedText }}>
                    Tema: {previewTheme.nome}
                  </p>
                </div>
              </div>
            </div>

            {/* Logo e Capa opcionais */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2 border-t border-slate-100">
              {/* Logo (máx 400px WebP) */}
              <div className="space-y-3">
                <div>
                  <h2 className="text-sm font-bold text-slate-900">Logo (opcional)</h2>
                  <p className="text-xs font-semibold text-slate-700 mt-0.5">
                    Dimensão recomendada: 400 × 400 px (proporção 1:1 quadrada)
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Comprimida automaticamente para até 400px em WebP (&lt; 450 KB). Sem logo, mostramos a inicial do nome.
                  </p>
                </div>

                <div className="flex items-center gap-4">
                  <div
                    className="w-16 h-16 rounded-full overflow-hidden border border-slate-200 shrink-0 flex items-center justify-center"
                    style={{
                      backgroundColor: apLogoUrl.trim() ? '#f1f5f9' : previewTheme.accent,
                      color: previewTheme.accentText,
                    }}
                  >
                    {apLogoUrl.trim() ? (
                      <ImageWithFallback src={apLogoUrl} alt="Logo" showLabel={false} />
                    ) : (
                      <span className="text-xl font-bold">{storeInitial}</span>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <label className="min-h-[40px] px-4 py-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold inline-flex items-center gap-2 cursor-pointer">
                      <ImagePlus className="w-4 h-4" />
                      <span>{uploadingLogo ? 'Enviando...' : 'Enviar logo'}</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleLogoUpload}
                        disabled={uploadingLogo}
                        className="sr-only"
                      />
                    </label>

                    {apLogoUrl.trim() && (
                      <button
                        type="button"
                        onClick={handleRemoveLogo}
                        className="min-h-[40px] px-3 py-2 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 text-xs font-semibold inline-flex items-center gap-1.5"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Remover</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Capa / Banner (máx 1400px WebP) */}
              <div className="space-y-3">
                <div>
                  <h2 className="text-sm font-bold text-slate-900">Capa / Banner (opcional)</h2>
                  <p className="text-xs font-semibold text-slate-700 mt-0.5">
                    Dimensão recomendada: 1400 × 500 px (formato horizontal / widescreen)
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Comprimida automaticamente para até 1400px em WebP (&lt; 450 KB). Sem capa, mostramos um degradê da paleta.
                  </p>
                </div>

                <div className="flex items-center gap-4">
                  <div className="w-28 h-16 rounded-xl overflow-hidden border border-slate-200 shrink-0">
                    {apCapaUrl.trim() ? (
                      <ImageWithFallback src={apCapaUrl} alt="Capa" showLabel={false} />
                    ) : (
                      <div
                        className="w-full h-full"
                        style={{ background: previewTheme.coverGradient }}
                      />
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <label className="min-h-[40px] px-4 py-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold inline-flex items-center gap-2 cursor-pointer">
                      <ImagePlus className="w-4 h-4" />
                      <span>{uploadingCapa ? 'Enviando...' : 'Enviar capa'}</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleCapaUpload}
                        disabled={uploadingCapa}
                        className="sr-only"
                      />
                    </label>

                    {apCapaUrl.trim() && (
                      <button
                        type="button"
                        onClick={handleRemoveCapa}
                        className="min-h-[40px] px-3 py-2 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 text-xs font-semibold inline-flex items-center gap-1.5"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Remover</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Seleção de Tema Premium em Cartões */}
            <div className="space-y-4 pt-2 border-t border-slate-100">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Temas Premium</h2>
                <p className="text-xs text-slate-500">
                  Escolha a paleta de cores aplicada automaticamente em todo o cardápio público.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {ALL_THEME_OPTIONS.map((themeKey) => {
                  const isCustom = themeKey === 'personalizado';
                  const tokens = isCustom
                    ? resolveStoreTheme({
                        tema: 'personalizado',
                        cor_primaria: apCorPrimaria,
                        cor_secundaria: apCorSecundaria,
                      })
                    : THEME_PRESETS[themeKey];
                  const selected = apTema === themeKey;

                  return (
                    <button
                      key={themeKey}
                      type="button"
                      onClick={() => setApTema(themeKey)}
                      className={`p-4 rounded-2xl border text-left transition-all flex flex-col justify-between gap-3 ${
                        selected
                          ? 'border-slate-900 ring-2 ring-slate-900/15 shadow-sm'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 w-full">
                        <span className="text-sm font-bold text-slate-900">{tokens.nome}</span>
                        {selected && (
                          <span className="w-5 h-5 rounded-full bg-slate-900 text-white flex items-center justify-center shrink-0">
                            <Check className="w-3 h-3" />
                          </span>
                        )}
                      </div>

                      {/* Mini prévia do tema */}
                      <div
                        className="w-full rounded-xl p-3 border flex items-center justify-between gap-2"
                        style={{
                          backgroundColor: tokens.bg,
                          borderColor: tokens.border,
                        }}
                      >
                        <div className="space-y-1">
                          <div
                            className="text-xs font-bold"
                            style={{ color: tokens.text }}
                          >
                            Prato do dia
                          </div>
                          <div
                            className="text-[11px] font-semibold"
                            style={{ color: tokens.accent }}
                          >
                            R$ 34,90
                          </div>
                        </div>
                        <span
                          className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shadow-xs"
                          style={{
                            backgroundColor: tokens.accent,
                            color: tokens.accentText,
                          }}
                        >
                          +
                        </span>
                      </div>

                      <p className="text-[11px] text-slate-500 leading-snug">
                        {tokens.descricao}
                      </p>
                    </button>
                  );
                })}
              </div>

              {/* Controles de cor personalizada com contraste automático */}
              {apTema === 'personalizado' && (
                <div className="p-4 sm:p-5 rounded-2xl bg-slate-50 border border-slate-200 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-800">
                      Cores do tema personalizado
                    </span>
                    <span
                      className="px-2.5 py-1 rounded-full text-[11px] font-semibold"
                      style={{
                        backgroundColor: apCorPrimaria,
                        color: getContrastText(apCorPrimaria),
                      }}
                    >
                      Texto com contraste automático
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Cor Primária (destaque e botões)
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={apCorPrimaria}
                          onChange={(e) => setApCorPrimaria(e.target.value)}
                          className="w-11 h-10 rounded-lg border border-slate-200 cursor-pointer"
                        />
                        <input
                          type="text"
                          value={apCorPrimaria}
                          onChange={(e) => setApCorPrimaria(e.target.value)}
                          className="flex-1 min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-sm font-mono"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Cor Secundária (degradê da capa)
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={apCorSecundaria}
                          onChange={(e) => setApCorSecundaria(e.target.value)}
                          className="w-11 h-10 rounded-lg border border-slate-200 cursor-pointer"
                        />
                        <input
                          type="text"
                          value={apCorSecundaria}
                          onChange={(e) => setApCorSecundaria(e.target.value)}
                          className="flex-1 min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-sm font-mono"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {PALETAS_CORES.map((p) => (
                      <button
                        key={p.nome}
                        type="button"
                        onClick={() => {
                          setApCorPrimaria(p.primaria);
                          setApCorSecundaria(p.secundaria);
                        }}
                        className="min-h-[36px] px-3 rounded-lg border border-slate-200 text-xs font-medium inline-flex items-center gap-2 bg-white hover:bg-slate-100"
                      >
                        <span className="w-3 h-3 rounded-full" style={{ backgroundColor: p.primaria }} />
                        <span>{p.nome}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={apSaving || uploadingLogo || uploadingCapa}
                className="min-h-[48px] px-6 py-2.5 rounded-xl bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 text-sm font-bold shadow-xs"
              >
                {apSaving ? 'Salvando...' : 'Salvar aparência'}
              </button>
            </div>
          </form>
        )}

        {/* ABA 5: DADOS DA LOJA (Slug não editável) */}
        {activeTab === 'config' && (
          <form onSubmit={handleSaveConfig} className="max-w-2xl bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6 shadow-xs">
            <div>
              <h1 className="text-xl font-bold text-slate-900">Dados da loja</h1>
              <p className="text-sm text-slate-600 mt-1">
                Configure nome, WhatsApp para pedidos, chave Pix, link de pagamento e horário de funcionamento.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="cfg-nome" className="block text-xs font-semibold text-slate-700 mb-1">
                  Nome do estabelecimento *
                </label>
                <input
                  id="cfg-nome"
                  type="text"
                  required
                  value={cfgNome}
                  onChange={(e) => setCfgNome(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 text-sm"
                />
              </div>

              <div>
                <label htmlFor="cfg-slug" className="block text-xs font-semibold text-slate-700 mb-1">
                  Link (Slug) <span className="text-slate-400 font-normal">(não pode ser alterado)</span>
                </label>
                <input
                  id="cfg-slug"
                  type="text"
                  readOnly
                  value={cfgSlug}
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 bg-slate-100 text-sm font-mono text-slate-600 cursor-not-allowed"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="cfg-wpp" className="block text-xs font-semibold text-slate-700 mb-1">
                  WhatsApp *
                </label>
                <input
                  id="cfg-wpp"
                  type="tel"
                  required
                  value={cfgWhatsapp}
                  onChange={(e) => setCfgWhatsapp(formatWhatsAppMask(e.target.value))}
                  placeholder="(11) 99999-9999"
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 text-sm font-mono"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Salvo automaticamente com DDI 55 (ex: 5511999999999).
                </p>
              </div>

              <div>
                <label htmlFor="cfg-horario" className="block text-xs font-semibold text-slate-700 mb-1">
                  Horário de funcionamento
                </label>
                <input
                  id="cfg-horario"
                  type="text"
                  value={cfgHorario}
                  onChange={(e) => setCfgHorario(e.target.value)}
                  placeholder="Ter a Dom · 18h às 23h"
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 text-sm"
                />
              </div>
            </div>

            <div>
              <label htmlFor="cfg-pix" className="block text-xs font-semibold text-slate-700 mb-1">
                Chave Pix
              </label>
              <input
                id="cfg-pix"
                type="text"
                value={cfgPix}
                onChange={(e) => setCfgPix(e.target.value)}
                placeholder="CPF/CNPJ, e-mail, telefone ou chave aleatória"
                className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 text-sm font-mono"
              />
              <p className="mt-1 text-xs text-slate-500">
                Esta chave aparece para o cliente copiar na hora de pagar
              </p>
            </div>

            <div>
              <label htmlFor="cfg-link" className="block text-xs font-semibold text-slate-700 mb-1">
                Link de pagamento (opcional)
              </label>
              <input
                id="cfg-link"
                type="url"
                value={cfgLink}
                onChange={(e) => setCfgLink(e.target.value)}
                placeholder="https://link.mercadopago.com.br/..."
                className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 text-sm"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Se preenchido, deve começar com https://
              </p>
            </div>

            <div className="pt-4 border-t border-slate-100 space-y-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">Endereço do estabelecimento</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Digite o CEP para preencher automaticamente. Depois informe número/complemento e confirme o endereço para liberar a busca de bairros próximos.
                </p>
              </div>
              <StoreAddressFields
                value={cfgAddress}
                onChange={setCfgAddress}
                onConfirmAddress={handleConfirmConfigAddress}
                idPrefix="cfg-addr"
              />
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={cfgSaving}
                className="min-h-[48px] px-6 py-2.5 rounded-xl bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 text-sm font-bold shadow-xs"
              >
                {cfgSaving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </form>
        )}

        {/* ABA 6: QR CODE */}
        {activeTab === 'qrcode' && (
          <QrCodeGenerator
            nomeEstabelecimento={estabelecimento.nome}
            slug={estabelecimento.slug}
            onOpenMenu={(s) => onNavigate(`/${s}`)}
          />
        )}
      </main>

      {/* Modal Criar / Editar Produto */}
      {productModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setProductModalOpen(false)}
        >
          <form
            onSubmit={handleSaveProduct}
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">
                {editingProduto ? 'Editar Produto' : 'Novo Produto'}
              </h2>
              <button
                type="button"
                onClick={() => setProductModalOpen(false)}
                className="text-sm font-medium text-slate-500 hover:text-slate-900"
              >
                Fechar
              </button>
            </div>

            <div>
              <label htmlFor="p-nome" className="block text-xs font-semibold text-slate-700 mb-1">
                Nome do Produto *
              </label>
              <input
                id="p-nome"
                type="text"
                required
                value={prodNome}
                onChange={(e) => setProdNome(e.target.value)}
                placeholder="Ex: X-Bacon Artesanal"
                className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 text-sm"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="p-preco" className="block text-xs font-semibold text-slate-700 mb-1">
                  Preço (R$) *
                </label>
                <CurrencyInput
                  id="p-preco"
                  required
                  valueCents={prodPrecoCents}
                  onChangeCents={(c) => setProdPrecoCents(c ?? 0)}
                  placeholder="R$ 34,90"
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 text-sm tabular-nums"
                />
              </div>

              <div>
                <label htmlFor="p-cat" className="block text-xs font-semibold text-slate-700 mb-1">
                  Categoria
                </label>
                <select
                  id="p-cat"
                  value={prodCategoriaId}
                  onChange={(e) => setProdCategoriaId(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm"
                >
                  <option value="">Sem categoria</option>
                  {categorias.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="p-desc" className="block text-xs font-semibold text-slate-700 mb-1">
                Descrição
              </label>
              <textarea
                id="p-desc"
                rows={3}
                maxLength={500}
                value={prodDesc}
                onChange={(e) => setProdDesc(e.target.value)}
                placeholder="Ingredientes e detalhes do prato..."
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-700">
                Foto do Produto (redimensionada para WebP)
              </label>
              <div className="flex items-center gap-4">
                <div className="w-20 h-20 rounded-xl overflow-hidden border border-slate-200 bg-slate-50 shrink-0">
                  <ImageWithFallback src={prodFotoUrl} alt={prodNome || 'Prévia'} />
                </div>
                <div className="flex-1 space-y-2">
                  <label className="min-h-[40px] px-4 py-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold inline-flex items-center gap-2 cursor-pointer">
                    <ImagePlus className="w-4 h-4" />
                    <span>{uploadingPhoto ? 'Processando...' : 'Selecionar foto'}</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleProductPhotoUpload}
                      disabled={uploadingPhoto}
                      className="sr-only"
                    />
                  </label>
                  <input
                    type="url"
                    value={prodFotoUrl}
                    onChange={(e) => setProdFotoUrl(e.target.value)}
                    placeholder="Ou cole a URL da imagem"
                    aria-label="URL da foto"
                    className="w-full min-h-[38px] px-3 py-1.5 rounded-lg border border-slate-200 text-xs"
                  />
                </div>
              </div>
            </div>

            <label className="flex items-center gap-2.5 text-sm font-medium text-slate-700 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={prodAtivo}
                onChange={(e) => setProdAtivo(e.target.checked)}
                className="w-4 h-4 accent-emerald-700"
              />
              <span>Produto ativo (visível no cardápio)</span>
            </label>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setProductModalOpen(false)}
                className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={savingProduct || uploadingPhoto}
                className="min-h-[44px] px-5 py-2 rounded-xl bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 text-sm font-bold shadow-xs"
              >
                {savingProduct ? 'Salvando...' : 'Salvar produto'}
              </button>
            </div>
          </form>
        </div>
      )}
      {/* Toast flutuante para feedback imediato */}
      {feedback && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-4 right-4 z-50 max-w-md px-4 py-3 rounded-2xl border shadow-xl flex items-center justify-between gap-3 text-sm font-semibold ${
            feedback.type === 'ok'
              ? 'bg-emerald-900 border-emerald-700 text-white'
              : 'bg-rose-900 border-rose-700 text-white'
          }`}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            aria-label="Fechar aviso"
            className="w-7 h-7 rounded-lg hover:bg-white/15 flex items-center justify-center shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>

    <OrderPrintReceipt
      estabelecimentoNome={estabelecimento.nome}
      pedido={printingPedido}
    />
    </>
  );
}
