import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  ExternalLink,
  Loader2,
  Lock,
  MapPin,
  MessageCircle,
  Minus,
  Plus,
  QrCode,
  Search,
  ShoppingBag,
  Store,
  Trash2,
  Truck,
  X,
} from 'lucide-react';
import {
  cleanCepDigits,
  formatCepMask,
  lookupCheckoutCep,
  matchDeliveryArea,
} from '../lib/geo';
import { isSupabaseConfigured, supabase, translateSupabaseError } from '../lib/supabase';
import {
  type BairroEntrega,
  buildGoogleMapsLink,
  buildWhatsAppOrderUrl,
  type CartItem,
  type Categoria,
  type CriarPedidoResult,
  type Estabelecimento,
  formatBrazilianPhoneMask,
  formatBRL,
  formatStoreAddress,
  type FormaPagamento,
  getAreaBairroNome,
  getAreaCidade,
  getAreaSelectLabel,
  normalizeWhatsAppDigits,
  parseOpeningStatus,
  type Produto,
  resolveStoreTheme,
  sanitizeExternalUrl,
  type TipoEntrega,
  type WhatsAppOrderItemInput,
} from '../types/menu';
import { ImageWithFallback } from './ImageWithFallback';

interface CustomerMenuViewProps {
  slug: string;
  onNavigate?: (path: string) => void;
}

interface ConfirmedOrderState {
  numero: number;
  token?: string | null;
  subtotal: number;
  taxa_entrega: number;
  total: number;
  itens: WhatsAppOrderItemInput[];
  whatsappUrl: string | null;
  pagamento: FormaPagamento;
  tipo: TipoEntrega;
  bairroSelecionado?: string;
  enderecoTexto?: string;
}

interface StoredLastOrder {
  token: string;
  numero: number;
  savedAt: number;
}

const CART_STORAGE_KEY = 'cardapio_cart_v1_';
const LAST_ORDER_STORAGE_KEY = 'cardapio_last_order_v1_';

function MenuSkeleton() {
  return (
    <div className="min-h-screen bg-slate-50 animate-pulse">
      <div className="h-44 sm:h-56 w-full bg-slate-200" />
      <div className="max-w-5xl mx-auto px-4">
        <div className="-mt-10 sm:-mt-12 flex items-end justify-between gap-4">
          <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-slate-300 border-4 border-slate-50" />
          <div className="h-10 w-32 rounded-xl bg-slate-200 mb-1" />
        </div>
        <div className="mt-4 space-y-2">
          <div className="h-7 w-56 bg-slate-200 rounded-lg" />
          <div className="h-4 w-72 bg-slate-200 rounded-lg" />
        </div>
      </div>

      <div className="mt-6 border-y border-slate-200 bg-white px-4 py-3">
        <div className="max-w-5xl mx-auto flex gap-2 overflow-hidden">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-9 w-24 rounded-full bg-slate-200 shrink-0" />
          ))}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 pt-5 space-y-6">
        <div className="h-11 w-full rounded-xl bg-slate-200" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="rounded-2xl bg-white border border-slate-200 overflow-hidden"
            >
              <div className="aspect-[4/3] bg-slate-200" />
              <div className="p-4 space-y-3">
                <div className="h-5 w-3/4 bg-slate-200 rounded" />
                <div className="h-3 w-full bg-slate-200 rounded" />
                <div className="flex items-center justify-between pt-2">
                  <div className="h-5 w-20 bg-slate-200 rounded" />
                  <div className="w-11 h-11 rounded-full bg-slate-200" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function CustomerMenuView({ slug, onNavigate }: CustomerMenuViewProps) {
  const [estabelecimento, setEstabelecimento] = useState<Estabelecimento | null>(null);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [bairros, setBairros] = useState<BairroEntrega[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('todas');
  const [searchQuery, setSearchQuery] = useState('');

  // Modal de detalhe do produto + observação
  const [activeProduto, setActiveProduto] = useState<Produto | null>(null);
  const [modalQty, setModalQty] = useState(1);
  const [modalObs, setModalObs] = useState('');

  // Carrinho persistente no localStorage
  const storageKey = `${CART_STORAGE_KEY}${slug}`;
  const lastOrderStorageKey = `${LAST_ORDER_STORAGE_KEY}${slug}`;
  const [lastOrder, setLastOrder] = useState<StoredLastOrder | null>(() => {
    try {
      const saved = localStorage.getItem(`${LAST_ORDER_STORAGE_KEY}${slug}`);
      if (!saved) return null;
      const parsed = JSON.parse(saved) as StoredLastOrder;
      if (
        parsed?.token &&
        typeof parsed.numero === 'number' &&
        Date.now() - (parsed.savedAt || 0) < 24 * 60 * 60 * 1000
      ) {
        return parsed;
      }
    } catch {
      // Ignorar erro de parse
    }
    return null;
  });
  const [cart, setCart] = useState<CartItem[]>(() => {
    try {
      const saved = localStorage.getItem(`${CART_STORAGE_KEY}${slug}`);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch {
      // Ignorar erro de parse
    }
    return [];
  });

  const [isCartOpen, setIsCartOpen] = useState(false);
  const [tipoEntrega, setTipoEntrega] = useState<TipoEntrega>('entrega');
  const [manualSelectedAreaId, setManualSelectedAreaId] = useState<string>('');
  const [bairrosLoadError, setBairrosLoadError] = useState<string | null>(null);
  const [clienteNome, setClienteNome] = useState('');
  const [clienteTelefone, setClienteTelefone] = useState('');
  const [cep, setCep] = useState('');
  const [cepLoading, setCepLoading] = useState(false);
  const [cepError, setCepError] = useState<string | null>(null);
  const [addressFieldsUnlocked, setAddressFieldsUnlocked] = useState(false);
  const [rua, setRua] = useState('');
  const [numero, setNumero] = useState('');
  const [complemento, setComplemento] = useState('');
  const [bairroInput, setBairroInput] = useState('');
  const [cidadeInput, setCidadeInput] = useState('');
  const [ufInput, setUfInput] = useState('');
  const [pedidoObs, setPedidoObs] = useState('');
  const [formaPagamento, setFormaPagamento] = useState<FormaPagamento>('na_entrega');
  const [pixCopied, setPixCopied] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [confirmedOrder, setConfirmedOrder] = useState<ConfirmedOrderState | null>(null);
  const [coverImgError, setCoverImgError] = useState(false);
  const [logoImgError, setLogoImgError] = useState(false);

  const lastQueriedCepRef = useRef<string>('');
  const ruaInputRef = useRef<HTMLInputElement>(null);
  const numeroInputRef = useRef<HTMLInputElement>(null);

  const goToOrderTracking = (token: string) => {
    const cleanToken = token.trim();
    if (!cleanToken) return;
    const path = `/pedido/${cleanToken}`;
    if (onNavigate) {
      onNavigate(path);
    } else {
      window.history.pushState({}, '', path);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(cart));
    } catch {
      // Ignorar erro de storage
    }
  }, [cart, storageKey]);

  useEffect(() => {
    let cancelled = false;

    async function loadMenu() {
      if (!isSupabaseConfigured || !supabase) {
        setErrorMsg('Supabase não configurado neste ambiente.');
        setLoading(false);
        return;
      }

      setLoading(true);
      setErrorMsg(null);
      setBairrosLoadError(null);
      setManualSelectedAreaId('');
      setCoverImgError(false);
      setLogoImgError(false);

      try {
        const { data: estabData, error: estabErr } = await supabase
          .from('estabelecimentos')
          .select('*')
          .eq('slug', slug)
          .maybeSingle();

        if (estabErr) throw estabErr;
        if (!estabData) {
          if (!cancelled) {
            setEstabelecimento(null);
            setLoading(false);
          }
          return;
        }

        const est = estabData as Estabelecimento;
        if (est.ativo === false) {
          if (!cancelled) {
            setEstabelecimento(null);
            setLoading(false);
          }
          return;
        }

        const [catRes, prodRes, bairrosRes] = await Promise.all([
          supabase
            .from('categorias')
            .select('*')
            .eq('estabelecimento_id', est.id)
            .order('ordem', { ascending: true }),
          supabase
            .from('produtos')
            .select('*')
            .eq('estabelecimento_id', est.id)
            .eq('ativo', true)
            .order('ordem', { ascending: true }),
          supabase
            .from('bairros_entrega')
            .select('*')
            .eq('estabelecimento_id', est.id)
            .order('bairro', { ascending: true }),
        ]);

        if (catRes.error) throw catRes.error;
        if (prodRes.error) throw prodRes.error;
        if (bairrosRes.error) {
          console.error('Erro ao carregar bairros de entrega:', bairrosRes.error);
          if (!cancelled) {
            setBairrosLoadError(
              translateSupabaseError(bairrosRes.error, 'Não foi possível carregar as áreas de entrega.')
            );
          }
        }

        if (!cancelled) {
          setEstabelecimento(est);
          setCategorias(catRes.data || []);
          setProdutos(
            (prodRes.data || []).map((p) => ({
              ...p,
              preco: Number(p.preco) || 0,
            }))
          );
          const loadedBairros = (bairrosRes.data || []).map((b) => ({
            ...b,
            taxa: Number(b.taxa) || 0,
          })) as BairroEntrega[];
          setBairros(loadedBairros);

          // Ajusta opção inicial de recebimento de acordo com configuração do dono
          const allowDelivery = est.aceita_entrega !== false;
          const allowPickup = est.aceita_retirada !== false;
          if (!allowDelivery && allowPickup) {
            setTipoEntrega('retirada');
          } else if (allowDelivery) {
            setTipoEntrega('entrega');
          }
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Erro ao carregar cardápio:', err);
          setErrorMsg(
            translateSupabaseError(err, 'Não foi possível carregar o cardápio.')
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadMenu();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const theme = useMemo(() => resolveStoreTheme(estabelecimento), [estabelecimento]);

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
        '--menu-header-glass': theme.headerGlass,
        backgroundColor: 'var(--menu-bg)',
        color: 'var(--menu-text)',
      }) as CSSProperties,
    [theme]
  );

  const openingStatus = useMemo(
    () => parseOpeningStatus(estabelecimento?.horario),
    [estabelecimento?.horario]
  );

  const visibleCategoryIds = useMemo(
    () => new Set(categorias.map((c) => c.id)),
    [categorias]
  );

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return produtos.filter((p) => {
      if (!p.ativo) return false;
      if (p.categoria_id && !visibleCategoryIds.has(p.categoria_id)) {
        return false;
      }
      if (selectedCategoryId !== 'todas' && p.categoria_id !== selectedCategoryId) {
        return false;
      }
      if (q) {
        const matchNome = p.nome.toLowerCase().includes(q);
        const matchDesc = (p.descricao || '').toLowerCase().includes(q);
        return matchNome || matchDesc;
      }
      return true;
    });
  }, [produtos, selectedCategoryId, searchQuery, visibleCategoryIds]);

  const groupedSections = useMemo(() => {
    const sections: { id: string; nome: string; items: Produto[] }[] = [];
    const catsToShow =
      selectedCategoryId === 'todas'
        ? categorias
        : categorias.filter((c) => c.id === selectedCategoryId);

    for (const cat of catsToShow) {
      const items = filteredProducts.filter((p) => p.categoria_id === cat.id);
      if (items.length > 0) {
        sections.push({ id: cat.id, nome: cat.nome, items });
      }
    }

    if (selectedCategoryId === 'todas') {
      const uncategorized = filteredProducts.filter((p) => !p.categoria_id);
      if (uncategorized.length > 0) {
        sections.push({ id: 'outros', nome: 'Destaques', items: uncategorized });
      }
    }

    return sections;
  }, [categorias, filteredProducts, selectedCategoryId]);

  const cartQtyByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of cart) {
      map.set(item.produto.id, (map.get(item.produto.id) || 0) + item.quantidade);
    }
    return map;
  }, [cart]);

  const cartTotalCount = useMemo(
    () => cart.reduce((acc, item) => acc + item.quantidade, 0),
    [cart]
  );

  const cartSubtotal = useMemo(
    () => cart.reduce((acc, item) => acc + item.produto.preco * item.quantidade, 0),
    [cart]
  );

  // Regras de entrega configuradas pelo dono
  const aceitaEntrega = estabelecimento?.aceita_entrega !== false;
  const aceitaRetirada = estabelecimento?.aceita_retirada !== false;
  const acceptsAnyOrderMode = aceitaEntrega || aceitaRetirada;
  const modoEntrega = estabelecimento?.modo_entrega === 'bairro' ? 'bairro' : 'fixa';
  const taxaFixa = Number(estabelecimento?.taxa_entrega) || 0;
  const entregaGratisAcima = Number(estabelecimento?.entrega_gratis_acima) || 0;
  const pedidoMinimo = Number(estabelecimento?.pedido_minimo) || 0;

  useEffect(() => {
    if (!aceitaEntrega && aceitaRetirada && tipoEntrega !== 'retirada') {
      setTipoEntrega('retirada');
    } else if (aceitaEntrega && !aceitaRetirada && tipoEntrega !== 'entrega') {
      setTipoEntrega('entrega');
    }
  }, [aceitaEntrega, aceitaRetirada, tipoEntrega]);

  useEffect(() => {
    const digits = cleanCepDigits(cep);
    if (digits.length < 8) {
      lastQueriedCepRef.current = '';
      return;
    }

    if (digits === lastQueriedCepRef.current) {
      return;
    }

    lastQueriedCepRef.current = digits;
    let cancelled = false;

    async function runCheckoutCepLookup() {
      setCepLoading(true);
      setCepError(null);

      try {
        const res = await lookupCheckoutCep(digits);
        if (cancelled) return;

        setRua(res.rua);
        setBairroInput(res.bairro);
        setCidadeInput(res.cidade);
        setUfInput(res.uf);
        setManualSelectedAreaId('');
        setAddressFieldsUnlocked(true);

        setTimeout(() => {
          numeroInputRef.current?.focus();
        }, 30);
      } catch (err) {
        if (cancelled) return;
        setCepError(
          err instanceof Error
            ? err.message
            : 'CEP não encontrado. Preencha o endereço manualmente.'
        );
        setAddressFieldsUnlocked(true);
        setTimeout(() => {
          ruaInputRef.current?.focus();
        }, 30);
      } finally {
        if (!cancelled) {
          setCepLoading(false);
        }
      }
    }

    runCheckoutCepLookup();

    return () => {
      cancelled = true;
    };
  }, [cep]);

  const groupedBairrosByCidade = useMemo(() => {
    const groups = new Map<string, BairroEntrega[]>();
    for (const area of bairros) {
      const cid = getAreaCidade(area);
      const list = groups.get(cid) || [];
      list.push(area);
      groups.set(cid, list);
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b, 'pt-BR'))
      .map(([cidade, items]) => ({
        cidade,
        items: [...items].sort((a, b) => {
          const aName = getAreaBairroNome(a);
          const bName = getAreaBairroNome(b);
          if (!aName && bName) return -1;
          if (aName && !bName) return 1;
          return aName.localeCompare(bName, 'pt-BR');
        }),
      }));
  }, [bairros]);

  const autoMatchedArea = useMemo(() => {
    if (modoEntrega !== 'bairro') return null;
    if (!addressFieldsUnlocked && !bairroInput.trim() && !cidadeInput.trim()) {
      return null;
    }
    return matchDeliveryArea(bairros, bairroInput, cidadeInput);
  }, [modoEntrega, addressFieldsUnlocked, bairros, bairroInput, cidadeInput]);

  const selectedBairroObj = useMemo(() => {
    if (modoEntrega !== 'bairro') return null;
    if (manualSelectedAreaId === '__not_found__') return null;
    if (manualSelectedAreaId) {
      return bairros.find((b) => b.id === manualSelectedAreaId) || null;
    }
    return autoMatchedArea;
  }, [modoEntrega, manualSelectedAreaId, bairros, autoMatchedArea]);

  const isEntrega = tipoEntrega === 'entrega' && aceitaEntrega;
  const freteGratisAplicado =
    isEntrega && entregaGratisAcima > 0 && cartSubtotal >= entregaGratisAcima;
  const missingForFreeShipping =
    isEntrega && entregaGratisAcima > 0 && cartSubtotal < entregaGratisAcima
      ? Math.max(0, entregaGratisAcima - cartSubtotal)
      : 0;

  const rawDeliveryFee = !isEntrega
    ? 0
    : modoEntrega === 'bairro'
    ? selectedBairroObj
      ? Number(selectedBairroObj.taxa) || 0
      : 0
    : taxaFixa;

  const effectiveDeliveryFee = freteGratisAplicado ? 0 : rawDeliveryFee;
  const cartTotal = cartSubtotal + effectiveDeliveryFee;

  const belowMinimumOrder = pedidoMinimo > 0 && cartSubtotal < pedidoMinimo;
  const missingForMinimum = belowMinimumOrder ? Math.max(0, pedidoMinimo - cartSubtotal) : 0;
  const missingMatchedAreaForDelivery =
    isEntrega && modoEntrega === 'bairro' && !selectedBairroObj;

  const openProductModal = (produto: Produto) => {
    setActiveProduto(produto);
    setModalQty(1);
    setModalObs('');
  };

  const quickAddToCart = (produto: Produto) => {
    setCart((prev) => {
      const existingIndex = prev.findIndex(
        (item) => item.produto.id === produto.id && item.observacao.trim() === ''
      );
      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = {
          ...updated[existingIndex],
          quantidade: updated[existingIndex].quantidade + 1,
        };
        return updated;
      }
      return [
        ...prev,
        {
          cartItemId: `${produto.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          produto,
          quantidade: 1,
          observacao: '',
        },
      ];
    });
  };

  const handleAddToCart = () => {
    if (!activeProduto) return;
    const trimmedObs = modalObs.trim();
    setCart((prev) => {
      const existingIndex = prev.findIndex(
        (item) =>
          item.produto.id === activeProduto.id &&
          item.observacao.trim() === trimmedObs
      );
      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = {
          ...updated[existingIndex],
          quantidade: updated[existingIndex].quantidade + modalQty,
        };
        return updated;
      }
      return [
        ...prev,
        {
          cartItemId: `${activeProduto.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          produto: activeProduto,
          quantidade: modalQty,
          observacao: trimmedObs,
        },
      ];
    });
    setActiveProduto(null);
  };

  const updateCartItemQty = (cartItemId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) =>
          item.cartItemId === cartItemId
            ? { ...item, quantidade: item.quantidade + delta }
            : item
        )
        .filter((item) => item.quantidade > 0)
    );
  };

  const updateCartItemObs = (cartItemId: string, observacao: string) => {
    setCart((prev) =>
      prev.map((item) =>
        item.cartItemId === cartItemId ? { ...item, observacao } : item
      )
    );
  };

  const removeCartItem = (cartItemId: string) => {
    setCart((prev) => prev.filter((item) => item.cartItemId !== cartItemId));
  };

  const handleCopyPix = async () => {
    if (!estabelecimento?.chave_pix) return;
    try {
      await navigator.clipboard.writeText(estabelecimento.chave_pix);
      setPixCopied(true);
      setTimeout(() => setPixCopied(false), 2000);
    } catch {
      // Ignorar falha de clipboard
    }
  };

  const safePaymentLink = useMemo(
    () =>
      estabelecimento?.link_pagamento
        ? sanitizeExternalUrl(estabelecimento.link_pagamento)
        : null,
    [estabelecimento?.link_pagamento]
  );

  const directWhatsAppUrl = useMemo(() => {
    const digits = normalizeWhatsAppDigits(estabelecimento?.whatsapp || '');
    if (!digits) return null;
    return `https://wa.me/${digits}`;
  }, [estabelecimento?.whatsapp]);

  const hasWhatsAppConfigured = Boolean(
    normalizeWhatsAppDigits(estabelecimento?.whatsapp || '')
  );

  const openExternalWhatsApp = (url: string) => {
    try {
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch {
      // Usuário pode clicar no botão "Abrir no WhatsApp" na tela de confirmação
    }
  };

  const handleSubmitOrder = async () => {
    if (!estabelecimento || !supabase) {
      setCheckoutError('Conexão com o servidor indisponível no momento.');
      return;
    }
    if (cart.length === 0) {
      setCheckoutError('Adicione pelo menos um item antes de enviar o pedido.');
      return;
    }
    if (!acceptsAnyOrderMode) {
      setCheckoutError('Este estabelecimento não está aceitando pedidos no momento.');
      return;
    }
    if (belowMinimumOrder) {
      setCheckoutError(`O pedido mínimo para envio é de ${formatBRL(pedidoMinimo)}.`);
      return;
    }
    if (!hasWhatsAppConfigured) {
      setCheckoutError('Este estabelecimento ainda não configurou o WhatsApp.');
      return;
    }
    if (!clienteNome.trim()) {
      setCheckoutError('Informe seu nome para enviar o pedido.');
      return;
    }
    if (isEntrega) {
      if (!addressFieldsUnlocked) {
        setCheckoutError('Informe seu CEP ou clique em "Não sei meu CEP" para preencher o endereço.');
        return;
      }
      if (!rua.trim() || !numero.trim()) {
        setCheckoutError('Preencha rua e número para entrega (ou informe S/N se não houver número).');
        return;
      }
      if (!cidadeInput.trim()) {
        setCheckoutError('Preencha a cidade para entrega.');
        return;
      }
      if (modoEntrega === 'bairro') {
        if (!selectedBairroObj) {
          setCheckoutError(
            'Não identificamos uma área de entrega atendida. Selecione na lista ou fale com a loja pelo WhatsApp.'
          );
          return;
        }
      }
      if (modoEntrega === 'fixa' && !bairroInput.trim()) {
        setCheckoutError('Preencha o bairro para entrega.');
        return;
      }
    }

    setCheckoutError(null);
    setSubmittingOrder(true);

    const tipoFinal: TipoEntrega = isEntrega ? 'entrega' : 'retirada';
    const bairroFinal = isEntrega
      ? modoEntrega === 'bairro'
        ? selectedBairroObj?.bairro || ''
        : bairroInput.trim()
      : '';

    const streetWithNum = `${rua.trim()}, ${numero.trim()}${
      complemento.trim() ? ` - ${complemento.trim()}` : ''
    }`;
    const cityUfPart = [cidadeInput.trim(), ufInput.trim().toUpperCase()]
      .filter(Boolean)
      .join('/');
    const cepDigits = cleanCepDigits(cep);
    const cepPart = cepDigits.length === 8 ? `CEP ${formatCepMask(cepDigits)}` : '';

    const enderecoFinal = isEntrega
      ? [streetWithNum, bairroInput.trim(), cityUfPart, cepPart]
          .filter(Boolean)
          .join(' - ')
      : '';

    const pItens = cart.map((item) => ({
      produto_id: item.produto.id,
      qtd: item.quantidade,
      obs: item.observacao.trim(),
    }));

    try {
      const { data, error } = await supabase.rpc('criar_pedido_v2', {
        p_estabelecimento: estabelecimento.id,
        p_cliente: clienteNome.trim(),
        p_telefone: clienteTelefone.trim(),
        p_tipo: tipoFinal,
        p_endereco: enderecoFinal,
        p_bairro: bairroFinal,
        p_pagamento: formaPagamento,
        p_obs: pedidoObs.trim(),
        p_itens: pItens,
      });

      if (error) {
        console.error('Erro RPC criar_pedido_v2:', error);
        setCheckoutError(
          translateSupabaseError(error, 'Não foi possível registrar seu pedido. Tente novamente.')
        );
        return;
      }

      const rawResult = (Array.isArray(data) ? data[0] : data) as CriarPedidoResult | null;
      if (!rawResult || rawResult.numero === undefined || rawResult.numero === null) {
        setCheckoutError('Resposta inesperada ao registrar pedido. Tente novamente.');
        return;
      }

      const orderToken = rawResult.token ? String(rawResult.token).trim() : null;
      const trackingUrl = orderToken
        ? `${window.location.origin}/pedido/${orderToken}`
        : null;

      if (orderToken) {
        const stored: StoredLastOrder = {
          token: orderToken,
          numero: Number(rawResult.numero),
          savedAt: Date.now(),
        };
        setLastOrder(stored);
        try {
          localStorage.setItem(lastOrderStorageKey, JSON.stringify(stored));
        } catch {
          // Ignorar erro de storage
        }
      }

      const rawItens = Array.isArray(rawResult.itens) ? rawResult.itens : [];
      const normalizedItens: WhatsAppOrderItemInput[] =
        rawItens.length > 0
          ? rawItens.map((it, idx) => {
              const fallbackCart =
                cart.find((c) => c.produto.id === it.produto_id) || cart[idx];
              const qtd = Number(it.qtd ?? it.quantidade ?? fallbackCart?.quantidade ?? 1);
              const unitPrice = Number(
                it.preco ?? it.preco_unitario ?? fallbackCart?.produto.preco ?? 0
              );
              const itemSubtotal =
                it.subtotal !== undefined && it.subtotal !== null
                  ? Number(it.subtotal)
                  : unitPrice * qtd;
              const nome =
                it.nome || it.produto_nome || fallbackCart?.produto.nome || 'Item';
              const obs = String(
                it.obs ?? it.observacao ?? fallbackCart?.observacao ?? ''
              ).trim();
              return { nome, qtd, subtotal: itemSubtotal, obs };
            })
          : cart.map((c) => ({
              nome: c.produto.nome,
              qtd: c.quantidade,
              subtotal: c.produto.preco * c.quantidade,
              obs: c.observacao.trim(),
            }));

      const finalSubtotal =
        rawResult.subtotal !== undefined && rawResult.subtotal !== null
          ? Number(rawResult.subtotal)
          : cartSubtotal;
      const finalTaxa =
        rawResult.taxa_entrega !== undefined && rawResult.taxa_entrega !== null
          ? Number(rawResult.taxa_entrega)
          : effectiveDeliveryFee;
      const finalTotal =
        rawResult.total !== undefined && rawResult.total !== null
          ? Number(rawResult.total)
          : finalSubtotal + finalTaxa;

      const waUrl = buildWhatsAppOrderUrl({
        whatsapp: estabelecimento.whatsapp || '',
        estabelecimentoNome: estabelecimento.nome,
        numero: rawResult.numero,
        itens: normalizedItens,
        subtotal: finalSubtotal,
        taxaEntrega: finalTaxa,
        freteGratisAplicado: finalTaxa === 0 && isEntrega,
        total: finalTotal,
        tipoEntrega: tipoFinal,
        bairroSelecionado: bairroFinal || undefined,
        clienteNome: clienteNome.trim(),
        clienteTelefone: clienteTelefone.trim(),
        enderecoTexto: enderecoFinal,
        obsPedido: pedidoObs.trim(),
        formaPagamento,
        trackingUrl,
      });

      setConfirmedOrder({
        numero: Number(rawResult.numero),
        token: orderToken,
        subtotal: finalSubtotal,
        taxa_entrega: finalTaxa,
        total: finalTotal,
        itens: normalizedItens,
        whatsappUrl: waUrl,
        pagamento: formaPagamento,
        tipo: tipoFinal,
        bairroSelecionado: bairroFinal || undefined,
        enderecoTexto: enderecoFinal || undefined,
      });

      setCart([]);
      setPedidoObs('');

      if (waUrl) {
        openExternalWhatsApp(waUrl);
      }
    } catch (err) {
      console.error('Exceção ao criar pedido:', err);
      setCheckoutError(
        translateSupabaseError(err, 'Erro inesperado ao enviar pedido. Tente novamente.')
      );
    } finally {
      setSubmittingOrder(false);
    }
  };

  if (loading) {
    return <MenuSkeleton />;
  }

  if (errorMsg || !estabelecimento) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-3 shadow-sm">
          <Store className="w-10 h-10 text-slate-400 mx-auto" />
          <h1 className="text-lg font-bold text-slate-900">
            {errorMsg
              ? 'Não foi possível carregar o cardápio'
              : 'Cardápio não encontrado. Confira o link com o estabelecimento.'}
          </h1>
          {errorMsg && <p className="text-sm text-slate-600">{errorMsg}</p>}
        </div>
      </div>
    );
  }

  const hasCover = Boolean((estabelecimento.capa_url || '').trim()) && !coverImgError;
  const hasLogo = Boolean((estabelecimento.logo_url || '').trim()) && !logoImgError;
  const storeInitial = (estabelecimento.nome || 'L').trim().charAt(0).toUpperCase();

  return (
    <div style={themeCssVars} className="min-h-screen pb-28 transition-colors duration-200">
      {/* Cabeçalho Premium com Capa + Logo Sobreposta */}
      <header>
        <div className="relative z-0 h-44 sm:h-56 w-full overflow-hidden">
          {hasCover ? (
            <img
              src={estabelecimento.capa_url!}
              alt={`Capa de ${estabelecimento.nome}`}
              referrerPolicy="no-referrer"
              onError={() => setCoverImgError(true)}
              className="w-full h-full object-cover"
            />
          ) : (
            <div
              className="w-full h-full"
              style={{ background: theme.coverGradient }}
              aria-hidden="true"
            />
          )}
          <div
            className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/15 to-black/35"
            aria-hidden="true"
          />

          {/* Ação sobre a capa: WhatsApp da loja */}
          {directWhatsAppUrl && (
            <div className="absolute top-3 left-0 right-0 px-4">
              <div className="max-w-5xl mx-auto flex items-center justify-end gap-3">
                <a
                  href={directWhatsAppUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-h-[44px] px-4 rounded-full bg-black/45 hover:bg-black/65 backdrop-blur-md text-white text-xs font-semibold inline-flex items-center gap-2 transition-colors duration-200"
                >
                  <MessageCircle className="w-4 h-4" />
                  <span>WhatsApp</span>
                </a>
              </div>
            </div>
          )}
        </div>

        {/* Informações da Loja */}
        <div className="relative z-10 max-w-5xl mx-auto px-4 pb-5">
          <div className="relative z-10 -mt-9 sm:-mt-11 flex items-end justify-between gap-4">
            <div
              className="relative z-10 w-20 h-20 sm:w-24 sm:h-24 rounded-full overflow-hidden shadow-md shrink-0 flex items-center justify-center"
              style={{
                border: `4px solid var(--menu-bg)`,
                backgroundColor: hasLogo ? 'var(--menu-card)' : 'var(--menu-accent)',
                color: 'var(--menu-accent-text)',
              }}
            >
              {hasLogo ? (
                <img
                  src={estabelecimento.logo_url!}
                  alt={estabelecimento.nome}
                  referrerPolicy="no-referrer"
                  onError={() => setLogoImgError(true)}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-2xl sm:text-3xl font-bold tracking-tight select-none">
                  {storeInitial}
                </span>
              )}
            </div>

            {openingStatus && (
              <span
                className={`mb-1 px-3 py-1 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 ${
                  openingStatus === 'open'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-rose-600 text-white'
                }`}
              >
                {openingStatus === 'open' ? 'Aberto agora' : 'Fechado'}
              </span>
            )}
          </div>

          <div className="mt-3.5 space-y-2">
            <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-balance">
              {estabelecimento.nome}
            </h1>

            <div
              className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs sm:text-sm"
              style={{ color: 'var(--menu-muted)' }}
            >
              {estabelecimento.horario && (
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="w-4 h-4 shrink-0" />
                  <span>{estabelecimento.horario}</span>
                </span>
              )}

              {estabelecimento.tempo_estimado && (
                <span className="inline-flex items-center gap-1.5">
                  <Truck className="w-4 h-4 shrink-0" />
                  <span>{estabelecimento.tempo_estimado}</span>
                </span>
              )}

              {pedidoMinimo > 0 && (
                <span>Pedido mín. {formatBRL(pedidoMinimo)}</span>
              )}
            </div>

            {estabelecimento.mostrar_endereco === true &&
              formatStoreAddress(estabelecimento) && (
                <div
                  className="pt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:text-sm"
                  style={{ color: 'var(--menu-muted)' }}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="w-4 h-4 shrink-0" />
                    <span>{formatStoreAddress(estabelecimento)}</span>
                  </span>

                  {buildGoogleMapsLink(
                    estabelecimento.latitude,
                    estabelecimento.longitude
                  ) && (
                    <a
                      href={
                        buildGoogleMapsLink(
                          estabelecimento.latitude,
                          estabelecimento.longitude
                        )!
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold underline inline-flex items-center gap-1"
                      style={{ color: 'var(--menu-accent)' }}
                    >
                      <span>Ver no mapa</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              )}

            {lastOrder && (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => goToOrderTracking(lastOrder.token)}
                  className="min-h-[40px] px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-2 shadow-xs transition-transform active:scale-[0.98]"
                  style={{
                    backgroundColor: 'var(--menu-accent)',
                    color: 'var(--menu-accent-text)',
                  }}
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span>Acompanhar meu pedido #{lastOrder.numero}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Menu de Categorias Fixo no Topo em Pílulas */}
      {categorias.length > 0 && (
        <nav
          aria-label="Categorias do cardápio"
          className="sticky top-0 z-30 backdrop-blur-md transition-colors duration-200"
          style={{
            backgroundColor: 'var(--menu-header-glass)',
            borderTop: '1px solid var(--menu-border)',
            borderBottom: '1px solid var(--menu-border)',
          }}
        >
          <div className="max-w-5xl mx-auto px-4 py-2.5 flex items-center gap-2 overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => setSelectedCategoryId('todas')}
              className="min-h-[40px] px-4 rounded-full text-xs sm:text-sm font-semibold whitespace-nowrap shrink-0 transition-all duration-200"
              style={
                selectedCategoryId === 'todas'
                  ? {
                      backgroundColor: 'var(--menu-accent)',
                      color: 'var(--menu-accent-text)',
                    }
                  : {
                      backgroundColor: 'var(--menu-pill-bg)',
                      color: 'var(--menu-pill-text)',
                    }
              }
            >
              Todas
            </button>
            {categorias.map((cat) => {
              const active = selectedCategoryId === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCategoryId(cat.id)}
                  className="min-h-[40px] px-4 rounded-full text-xs sm:text-sm font-semibold whitespace-nowrap shrink-0 transition-all duration-200"
                  style={
                    active
                      ? {
                          backgroundColor: 'var(--menu-accent)',
                          color: 'var(--menu-accent-text)',
                        }
                      : {
                          backgroundColor: 'var(--menu-pill-bg)',
                          color: 'var(--menu-pill-text)',
                        }
                  }
                >
                  {cat.nome}
                </button>
              );
            })}
          </div>
        </nav>
      )}

      {/* Barra de Pesquisa */}
      <div className="max-w-5xl mx-auto px-4 pt-6">
        <div className="relative">
          <Search
            className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: 'var(--menu-muted)' }}
          />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar no cardápio..."
            aria-label="Pesquisar produtos"
            style={{
              backgroundColor: 'var(--menu-input-bg)',
              color: 'var(--menu-text)',
              border: '1px solid var(--menu-border)',
            }}
            className="w-full min-h-[46px] pl-11 pr-4 py-2.5 rounded-2xl text-sm focus:outline-none transition-shadow duration-200"
          />
        </div>
      </div>

      {/* Lista de Produtos */}
      <main className="max-w-5xl mx-auto px-4 pt-6 space-y-10">
        {groupedSections.length === 0 ? (
          <div
            style={{
              backgroundColor: 'var(--menu-card)',
              border: '1px solid var(--menu-border)',
            }}
            className="rounded-2xl p-12 text-center space-y-2 shadow-sm"
          >
            <p className="text-base font-bold">Nenhum produto encontrado</p>
            <p className="text-sm" style={{ color: 'var(--menu-muted)' }}>
              Tente buscar por outro termo ou categoria.
            </p>
          </div>
        ) : (
          groupedSections.map((section) => (
            <section key={section.id} aria-labelledby={`cat-${section.id}`}>
              <h2
                id={`cat-${section.id}`}
                className="font-display text-xl font-bold pb-2.5 mb-5"
                style={{ borderBottom: '1px solid var(--menu-border)' }}
              >
                {section.nome}
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {section.items.map((produto) => {
                  const qtyInCart = cartQtyByProduct.get(produto.id) || 0;
                  return (
                    <article
                      key={produto.id}
                      onClick={() => openProductModal(produto)}
                      style={{
                        backgroundColor: 'var(--menu-card)',
                        border: '1px solid var(--menu-border)',
                      }}
                      className="rounded-[16px] overflow-hidden shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-pointer flex flex-col justify-between"
                    >
                      <div className="relative aspect-[4/3] overflow-hidden bg-slate-200/40">
                        <ImageWithFallback
                          src={produto.foto_url}
                          alt={produto.nome}
                          className="w-full h-full object-cover hover:scale-[1.03] transition-transform duration-200"
                        />
                        {qtyInCart > 0 && (
                          <span
                            className="absolute top-3 right-3 min-w-[28px] h-7 px-2 rounded-full text-xs font-bold tabular-nums flex items-center justify-center shadow-sm"
                            style={{
                              backgroundColor: 'var(--menu-accent)',
                              color: 'var(--menu-accent-text)',
                            }}
                          >
                            {qtyInCart}
                          </span>
                        )}
                      </div>

                      <div className="p-4 sm:p-5 flex-1 flex flex-col justify-between gap-4">
                        <div className="space-y-1.5">
                          <h3 className="text-base font-bold line-clamp-1">
                            {produto.nome}
                          </h3>
                          {produto.descricao && (
                            <p
                              className="text-xs sm:text-sm line-clamp-2 leading-relaxed"
                              style={{ color: 'var(--menu-muted)' }}
                            >
                              {produto.descricao}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center justify-between gap-3 pt-1">
                          <span
                            className="text-lg font-bold tabular-nums"
                            style={{ color: 'var(--menu-accent)' }}
                          >
                            {formatBRL(produto.preco)}
                          </span>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              quickAddToCart(produto);
                            }}
                            aria-label={`Adicionar ${produto.nome}`}
                            className="w-11 h-11 rounded-full flex items-center justify-center shadow-sm transition-transform duration-200 active:scale-95 shrink-0"
                            style={{
                              backgroundColor: 'var(--menu-accent)',
                              color: 'var(--menu-accent-text)',
                            }}
                          >
                            <Plus className="w-5 h-5" strokeWidth={2.5} />
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </main>

      <footer className="max-w-5xl mx-auto px-4 pt-10 pb-2 text-center">
        <p className="text-[11px] font-medium opacity-75" style={{ color: 'var(--menu-muted)' }}>
          Feito com Cardápio Digital
        </p>
      </footer>

      {/* Barra Fixa do Carrinho embaixo */}
      {cartTotalCount > 0 && !isCartOpen && (
        <div className="fixed bottom-0 left-0 right-0 z-40 px-3 pb-3 pt-2 pointer-events-none animate-menu-in">
          <div className="max-w-3xl mx-auto pointer-events-auto">
            <button
              type="button"
              onClick={() => {
                setConfirmedOrder(null);
                setCheckoutError(null);
                setIsCartOpen(true);
              }}
              className="w-full min-h-[54px] px-5 py-3 rounded-2xl shadow-xl flex items-center justify-between font-bold text-sm sm:text-base transition-transform duration-200 active:scale-[0.98]"
              style={{
                backgroundColor: 'var(--menu-accent)',
                color: 'var(--menu-accent-text)',
              }}
            >
              <span className="inline-flex items-center gap-2.5">
                <ShoppingBag className="w-5 h-5 shrink-0" />
                <span>
                  Ver pedido ({cartTotalCount} {cartTotalCount === 1 ? 'item' : 'itens'})
                </span>
              </span>
              <span className="tabular-nums font-bold">{formatBRL(cartSubtotal)}</span>
            </button>
          </div>
        </div>
      )}

      {/* Modal de Detalhe e Observação do Produto */}
      {activeProduto && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setActiveProduto(null)}
        >
          <div
            style={{
              backgroundColor: 'var(--menu-card)',
              color: 'var(--menu-text)',
              border: '1px solid var(--menu-border)',
            }}
            className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl overflow-hidden shadow-2xl max-h-[90vh] flex flex-col animate-menu-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative aspect-[4/3] bg-slate-200/40">
              <ImageWithFallback
                src={activeProduto.foto_url}
                alt={activeProduto.nome}
                className="w-full h-full object-cover"
              />
              <button
                type="button"
                onClick={() => setActiveProduto(null)}
                aria-label="Fechar"
                className="absolute top-3 right-3 w-11 h-11 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition-colors duration-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-display text-lg font-bold">{activeProduto.nome}</h3>
                <span
                  className="text-lg font-bold tabular-nums shrink-0"
                  style={{ color: 'var(--menu-accent)' }}
                >
                  {formatBRL(activeProduto.preco)}
                </span>
              </div>
              {activeProduto.descricao && (
                <p
                  className="text-sm leading-relaxed"
                  style={{ color: 'var(--menu-muted)' }}
                >
                  {activeProduto.descricao}
                </p>
              )}

              <div>
                <label
                  htmlFor="modal-obs"
                  className="block text-xs font-semibold mb-1.5"
                >
                  Observações (opcional)
                </label>
                <textarea
                  id="modal-obs"
                  rows={2}
                  maxLength={200}
                  value={modalObs}
                  onChange={(e) => setModalObs(e.target.value)}
                  placeholder="Ex.: Sem cebola, molho à parte..."
                  style={{
                    backgroundColor: 'var(--menu-input-bg)',
                    color: 'var(--menu-text)',
                    border: '1px solid var(--menu-border)',
                  }}
                  className="w-full px-3.5 py-2.5 rounded-xl text-sm focus:outline-none"
                />
              </div>
            </div>

            <div
              className="p-4 flex items-center gap-3"
              style={{
                borderTop: '1px solid var(--menu-border)',
                backgroundColor: 'var(--menu-bg)',
              }}
            >
              <div
                className="flex items-center rounded-xl"
                style={{
                  backgroundColor: 'var(--menu-card)',
                  border: '1px solid var(--menu-border)',
                }}
              >
                <button
                  type="button"
                  onClick={() => setModalQty((q) => Math.max(1, q - 1))}
                  aria-label="Diminuir quantidade"
                  className="w-11 h-11 flex items-center justify-center"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <span className="w-8 text-center text-sm font-bold tabular-nums">
                  {modalQty}
                </span>
                <button
                  type="button"
                  onClick={() => setModalQty((q) => q + 1)}
                  aria-label="Aumentar quantidade"
                  className="w-11 h-11 flex items-center justify-center"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              <button
                type="button"
                onClick={handleAddToCart}
                className="flex-1 min-h-[46px] px-5 py-2.5 rounded-xl font-bold text-sm flex items-center justify-between shadow-sm transition-transform duration-200 active:scale-[0.98]"
                style={{
                  backgroundColor: 'var(--menu-accent)',
                  color: 'var(--menu-accent-text)',
                }}
              >
                <span>Adicionar</span>
                <span className="tabular-nums">{formatBRL(activeProduto.preco * modalQty)}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Drawer da Sacola e Checkout */}
      {isCartOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex justify-end"
          onClick={() => setIsCartOpen(false)}
        >
          <div
            style={{
              backgroundColor: 'var(--menu-card)',
              color: 'var(--menu-text)',
            }}
            className="w-full max-w-lg h-full flex flex-col shadow-2xl overflow-hidden animate-menu-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="px-5 h-14 flex items-center justify-between shrink-0"
              style={{ borderBottom: '1px solid var(--menu-border)' }}
            >
              <h2 className="font-display text-base font-bold">
                {confirmedOrder ? `Pedido #${confirmedOrder.numero}` : 'Seu pedido'}
              </h2>
              <button
                type="button"
                onClick={() => {
                  setIsCartOpen(false);
                  if (confirmedOrder) setConfirmedOrder(null);
                }}
                aria-label="Fechar pedido"
                className="w-11 h-11 flex items-center justify-center rounded-xl hover:opacity-75 transition-opacity duration-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {confirmedOrder ? (
                <div className="py-4 space-y-5 animate-menu-in">
                  <div className="text-center space-y-3">
                    <div className="w-16 h-16 rounded-full bg-emerald-500/15 text-emerald-600 flex items-center justify-center mx-auto">
                      <CheckCircle2 className="w-9 h-9" />
                    </div>
                    <div>
                      <h3 className="font-display text-xl font-bold">
                        Pedido #{confirmedOrder.numero} enviado!
                      </h3>
                      <p className="text-xs sm:text-sm mt-1" style={{ color: 'var(--menu-muted)' }}>
                        Seu pedido foi registrado com sucesso e encaminhado para o WhatsApp da loja.
                      </p>
                    </div>
                  </div>

                  {confirmedOrder.token && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsCartOpen(false);
                        goToOrderTracking(confirmedOrder.token!);
                      }}
                      className="w-full min-h-[48px] px-5 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-sm transition-transform active:scale-[0.98]"
                      style={{
                        backgroundColor: 'var(--menu-accent)',
                        color: 'var(--menu-accent-text)',
                      }}
                    >
                      <Clock className="w-5 h-5" />
                      <span>Acompanhar meu pedido</span>
                    </button>
                  )}

                  {confirmedOrder.whatsappUrl && (
                    <a
                      href={confirmedOrder.whatsappUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full min-h-[48px] px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-sm transition-colors"
                    >
                      <MessageCircle className="w-5 h-5" />
                      <span>Abrir no WhatsApp</span>
                    </a>
                  )}

                  {confirmedOrder.pagamento === 'pix' && (estabelecimento.chave_pix || '').trim() && (
                    <div
                      className="p-4 rounded-2xl space-y-2"
                      style={{
                        backgroundColor: 'var(--menu-bg)',
                        border: '1px solid var(--menu-border)',
                      }}
                    >
                      <p className="text-xs font-bold">Chave Pix para pagamento:</p>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          readOnly
                          value={estabelecimento.chave_pix}
                          aria-label="Chave Pix"
                          style={{
                            backgroundColor: 'var(--menu-input-bg)',
                            color: 'var(--menu-text)',
                            border: '1px solid var(--menu-border)',
                          }}
                          className="w-full min-h-[40px] px-3 py-1.5 text-xs font-mono-code rounded-lg"
                        />
                        <button
                          type="button"
                          onClick={handleCopyPix}
                          className="min-h-[40px] px-3.5 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 shrink-0"
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

                  {confirmedOrder.pagamento === 'link' && safePaymentLink && (
                    <a
                      href={safePaymentLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full min-h-[44px] px-4 py-2.5 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-2"
                      style={{
                        backgroundColor: 'var(--menu-accent)',
                        color: 'var(--menu-accent-text)',
                      }}
                    >
                      <ExternalLink className="w-4 h-4" />
                      <span>Abrir Link de Pagamento</span>
                    </a>
                  )}

                  <div
                    className="p-4 rounded-2xl space-y-3 text-sm"
                    style={{
                      backgroundColor: 'var(--menu-bg)',
                      border: '1px solid var(--menu-border)',
                    }}
                  >
                    <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--menu-muted)' }}>
                      Resumo do Pedido #{confirmedOrder.numero}
                    </p>
                    <div className="space-y-1.5 text-xs">
                      {confirmedOrder.itens.map((it, idx) => (
                        <div key={idx} className="flex items-start justify-between gap-2">
                          <div>
                            <span className="font-semibold">
                              {it.qtd}x {it.nome}
                            </span>
                            {it.obs && (
                              <p className="text-[11px]" style={{ color: 'var(--menu-muted)' }}>
                                Obs: {it.obs}
                              </p>
                            )}
                          </div>
                          <span className="tabular-nums font-semibold shrink-0">
                            {formatBRL(it.subtotal)}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="pt-2 space-y-1 text-xs" style={{ borderTop: '1px solid var(--menu-border)' }}>
                      <div className="flex justify-between" style={{ color: 'var(--menu-muted)' }}>
                        <span>Subtotal</span>
                        <span className="tabular-nums">{formatBRL(confirmedOrder.subtotal)}</span>
                      </div>
                      <div className="flex justify-between" style={{ color: 'var(--menu-muted)' }}>
                        <span>Frete</span>
                        <span className="tabular-nums">
                          {confirmedOrder.taxa_entrega === 0
                            ? confirmedOrder.tipo === 'retirada'
                              ? 'R$ 0,00 (Retirada)'
                              : 'Frete grátis!'
                            : formatBRL(confirmedOrder.taxa_entrega)}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm font-bold pt-1">
                        <span>Total</span>
                        <span className="tabular-nums" style={{ color: 'var(--menu-accent)' }}>
                          {formatBRL(confirmedOrder.total)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setIsCartOpen(false);
                      setConfirmedOrder(null);
                    }}
                    className="w-full min-h-[46px] px-5 py-2.5 rounded-xl font-bold text-sm"
                    style={{
                      backgroundColor: 'var(--menu-pill-bg)',
                      color: 'var(--menu-pill-text)',
                    }}
                  >
                    Voltar ao cardápio
                  </button>
                </div>
              ) : cart.length === 0 ? (
                <div className="py-16 text-center space-y-3">
                  <ShoppingBag
                    className="w-10 h-10 mx-auto opacity-40"
                  />
                  <p className="text-base font-bold">Sua sacola está vazia</p>
                  <p className="text-sm" style={{ color: 'var(--menu-muted)' }}>
                    Adicione itens do cardápio para pedir.
                  </p>
                </div>
              ) : (
                <>
                  {/* Banner Frete Grátis / Progresso */}
                  {isEntrega && entregaGratisAcima > 0 && (
                    <div
                      className="p-3.5 rounded-xl text-xs font-semibold space-y-2"
                      style={{
                        backgroundColor: freteGratisAplicado
                          ? 'rgba(16, 185, 129, 0.14)'
                          : 'var(--menu-pill-bg)',
                        color: freteGratisAplicado ? '#059669' : 'var(--menu-text)',
                        border: '1px solid var(--menu-border)',
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5">
                          <Truck className="w-4 h-4 shrink-0" />
                          {freteGratisAplicado ? (
                            <span>Frete grátis!</span>
                          ) : (
                            <span>
                              Faltam {formatBRL(missingForFreeShipping)} para frete grátis
                            </span>
                          )}
                        </span>
                        <span className="tabular-nums opacity-80">
                          {formatBRL(entregaGratisAcima)}
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full overflow-hidden bg-black/10">
                        <div
                          className="h-full transition-all duration-200 rounded-full"
                          style={{
                            width: `${Math.min(
                              100,
                              Math.round((cartSubtotal / entregaGratisAcima) * 100)
                            )}%`,
                            backgroundColor: freteGratisAplicado
                              ? '#059669'
                              : 'var(--menu-accent)',
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Lista de Itens no Carrinho */}
                  <div className="space-y-3">
                    {cart.map((item) => (
                      <div
                        key={item.cartItemId}
                        style={{
                          backgroundColor: 'var(--menu-bg)',
                          border: '1px solid var(--menu-border)',
                        }}
                        className="p-3.5 rounded-2xl space-y-2.5"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-bold text-sm">{item.produto.nome}</p>
                            <p
                              className="text-xs tabular-nums"
                              style={{ color: 'var(--menu-muted)' }}
                            >
                              {formatBRL(item.produto.preco)} cada
                            </p>
                          </div>
                          <span className="text-sm font-bold tabular-nums">
                            {formatBRL(item.produto.preco * item.quantidade)}
                          </span>
                        </div>

                        <div className="flex items-center justify-between gap-2">
                          <div
                            style={{
                              backgroundColor: 'var(--menu-card)',
                              border: '1px solid var(--menu-border)',
                            }}
                            className="flex items-center rounded-xl"
                          >
                            <button
                              type="button"
                              onClick={() => updateCartItemQty(item.cartItemId, -1)}
                              aria-label="Menos"
                              className="w-10 h-10 flex items-center justify-center"
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <span className="w-7 text-center text-xs font-bold tabular-nums">
                              {item.quantidade}
                            </span>
                            <button
                              type="button"
                              onClick={() => updateCartItemQty(item.cartItemId, 1)}
                              aria-label="Mais"
                              className="w-10 h-10 flex items-center justify-center"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <button
                            type="button"
                            onClick={() => removeCartItem(item.cartItemId)}
                            className="min-h-[40px] px-2 text-xs font-semibold text-rose-500 hover:text-rose-600 inline-flex items-center gap-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Remover</span>
                          </button>
                        </div>

                        <input
                          type="text"
                          maxLength={200}
                          value={item.observacao}
                          onChange={(e) => updateCartItemObs(item.cartItemId, e.target.value)}
                          placeholder="Observação (ex: sem cebola)"
                          aria-label="Observação do item"
                          style={{
                            backgroundColor: 'var(--menu-input-bg)',
                            color: 'var(--menu-text)',
                            border: '1px solid var(--menu-border)',
                          }}
                          className="w-full min-h-[38px] px-3 py-1.5 rounded-xl text-xs focus:outline-none"
                        />
                      </div>
                    ))}
                  </div>

                  {/* Dados de Entrega / Retirada */}
                  <div
                    className="space-y-4 pt-4"
                    style={{ borderTop: '1px solid var(--menu-border)' }}
                  >
                    <h3 className="text-sm font-bold">Como deseja receber?</h3>

                    {!acceptsAnyOrderMode ? (
                      <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs font-semibold text-rose-500">
                        Este estabelecimento não está aceitando entrega nem retirada no momento.
                      </div>
                    ) : (
                      <>
                        {aceitaEntrega && aceitaRetirada ? (
                          <div
                            className="grid grid-cols-2 gap-2 p-1 rounded-xl"
                            style={{ backgroundColor: 'var(--menu-pill-bg)' }}
                          >
                            <button
                              type="button"
                              onClick={() => setTipoEntrega('entrega')}
                              className="min-h-[42px] rounded-lg text-xs sm:text-sm font-semibold transition-all duration-200"
                              style={
                                tipoEntrega === 'entrega'
                                  ? {
                                      backgroundColor: 'var(--menu-accent)',
                                      color: 'var(--menu-accent-text)',
                                    }
                                  : { color: 'var(--menu-pill-text)' }
                              }
                            >
                              Entrega
                            </button>
                            <button
                              type="button"
                              onClick={() => setTipoEntrega('retirada')}
                              className="min-h-[42px] rounded-lg text-xs sm:text-sm font-semibold transition-all duration-200"
                              style={
                                tipoEntrega === 'retirada'
                                  ? {
                                      backgroundColor: 'var(--menu-accent)',
                                      color: 'var(--menu-accent-text)',
                                    }
                                  : { color: 'var(--menu-pill-text)' }
                              }
                            >
                              Retirada no local
                            </button>
                          </div>
                        ) : (
                          <div
                            className="p-3 rounded-xl text-xs font-semibold flex items-center gap-2"
                            style={{
                              backgroundColor: 'var(--menu-pill-bg)',
                              color: 'var(--menu-pill-text)',
                            }}
                          >
                            <Check className="w-4 h-4 shrink-0" />
                            <span>
                              {aceitaEntrega
                                ? 'Recebimento disponível: Entrega'
                                : 'Recebimento disponível: Retirada no local (sem taxa)'}
                            </span>
                          </div>
                        )}

                        <div className="space-y-3">
                          <div>
                            <label htmlFor="cli-nome" className="block text-xs font-semibold mb-1">
                              Seu Nome *
                            </label>
                            <input
                              id="cli-nome"
                              type="text"
                              required
                              value={clienteNome}
                              onChange={(e) => setClienteNome(e.target.value)}
                              placeholder="Nome completo"
                              style={{
                                backgroundColor: 'var(--menu-input-bg)',
                                color: 'var(--menu-text)',
                                border: '1px solid var(--menu-border)',
                              }}
                              className="w-full min-h-[44px] px-3.5 py-2 rounded-xl text-sm focus:outline-none"
                            />
                          </div>

                          <div>
                            <label htmlFor="cli-tel" className="block text-xs font-semibold mb-1">
                              Seu Telefone / WhatsApp (opcional)
                            </label>
                            <input
                              id="cli-tel"
                              type="tel"
                              value={clienteTelefone}
                              onChange={(e) => setClienteTelefone(formatBrazilianPhoneMask(e.target.value))}
                              placeholder="(11) 99999-9999"
                              style={{
                                backgroundColor: 'var(--menu-input-bg)',
                                color: 'var(--menu-text)',
                                border: '1px solid var(--menu-border)',
                              }}
                              className="w-full min-h-[44px] px-3.5 py-2 rounded-xl text-sm focus:outline-none"
                            />
                            <p
                              className="mt-1.5 text-[11px] inline-flex items-center gap-1"
                              style={{ color: 'var(--menu-muted)' }}
                            >
                              <Lock className="w-3 h-3 shrink-0" />
                              <span>Seus dados são usados apenas para este pedido.</span>
                            </p>
                          </div>

                          {isEntrega && (
                            <div
                              style={{
                                backgroundColor: 'var(--menu-bg)',
                                border: '1px solid var(--menu-border)',
                              }}
                              className="space-y-3.5 p-4 rounded-2xl"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-xs font-bold flex items-center gap-1.5">
                                  <MapPin className="w-4 h-4 shrink-0" />
                                  <span>Endereço de Entrega</span>
                                </p>
                                {!addressFieldsUnlocked && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setCepError(null);
                                      setAddressFieldsUnlocked(true);
                                      setTimeout(() => {
                                        ruaInputRef.current?.focus();
                                      }, 30);
                                    }}
                                    className="text-xs font-semibold underline py-1 px-1"
                                    style={{ color: 'var(--menu-accent)' }}
                                  >
                                    Não sei meu CEP
                                  </button>
                                )}
                              </div>

                              <div>
                                <label
                                  htmlFor="end-cep"
                                  className="block text-xs font-medium mb-1"
                                  style={{ color: 'var(--menu-muted)' }}
                                >
                                  CEP (opcional — preenche o endereço)
                                </label>
                                <div className="relative">
                                  <input
                                    id="end-cep"
                                    type="text"
                                    inputMode="numeric"
                                    autoComplete="postal-code"
                                    maxLength={9}
                                    value={formatCepMask(cep)}
                                    onChange={(e) => {
                                      const masked = formatCepMask(e.target.value);
                                      setCep(masked);
                                      setCepError(null);
                                      setCheckoutError(null);
                                      setManualSelectedAreaId('');
                                    }}
                                    placeholder="00000-000"
                                    style={{
                                      backgroundColor: 'var(--menu-input-bg)',
                                      color: 'var(--menu-text)',
                                      border: '1px solid var(--menu-border)',
                                    }}
                                    className="w-full min-h-[48px] px-3.5 py-2.5 pr-10 rounded-xl text-sm font-mono-code focus:outline-none"
                                  />
                                  {cepLoading && (
                                    <Loader2
                                      className="w-4 h-4 animate-spin absolute right-3.5 top-1/2 -translate-y-1/2"
                                      style={{ color: 'var(--menu-accent)' }}
                                    />
                                  )}
                                </div>
                              </div>

                              {cepLoading && (
                                <div className="space-y-3 pt-1" role="status" aria-live="polite">
                                  <p
                                    className="text-xs font-semibold flex items-center gap-2"
                                    style={{ color: 'var(--menu-accent)' }}
                                  >
                                    <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                                    <span>Buscando endereço...</span>
                                  </p>
                                  <div className="space-y-2.5 animate-pulse">
                                    <div className="grid grid-cols-3 gap-2.5">
                                      <div className="col-span-2 h-12 rounded-xl bg-black/10" />
                                      <div className="h-12 rounded-xl bg-black/10" />
                                    </div>
                                    <div className="h-12 rounded-xl bg-black/10" />
                                    <div className="grid grid-cols-12 gap-2.5">
                                      <div className="col-span-5 h-12 rounded-xl bg-black/10" />
                                      <div className="col-span-5 h-12 rounded-xl bg-black/10" />
                                      <div className="col-span-2 h-12 rounded-xl bg-black/10" />
                                    </div>
                                  </div>
                                </div>
                              )}

                              {cepError && !cepLoading && (
                                <div
                                  role="alert"
                                  className="p-3 rounded-xl bg-amber-500/12 border border-amber-500/30 text-xs font-semibold text-amber-700 flex items-start gap-2"
                                >
                                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                                  <span>{cepError}</span>
                                </div>
                              )}

                              {addressFieldsUnlocked && !cepLoading && (
                                <div className="space-y-3 pt-0.5">
                                  <div className="grid grid-cols-3 gap-2.5">
                                    <div className="col-span-2">
                                      <label
                                        htmlFor="end-rua"
                                        className="block text-xs font-medium mb-1"
                                        style={{ color: 'var(--menu-muted)' }}
                                      >
                                        Rua *
                                      </label>
                                      <input
                                        ref={ruaInputRef}
                                        id="end-rua"
                                        type="text"
                                        required
                                        value={rua}
                                        onChange={(e) => {
                                          setRua(e.target.value);
                                          setCheckoutError(null);
                                        }}
                                        placeholder="Ex: Rua das Flores"
                                        style={{
                                          backgroundColor: 'var(--menu-input-bg)',
                                          color: 'var(--menu-text)',
                                          border: '1px solid var(--menu-border)',
                                        }}
                                        className="w-full min-h-[48px] px-3.5 py-2 rounded-xl text-sm focus:outline-none"
                                      />
                                    </div>

                                    <div>
                                      <div className="flex items-center justify-between gap-1 mb-1">
                                        <label
                                          htmlFor="end-num"
                                          className="block text-xs font-medium"
                                          style={{ color: 'var(--menu-muted)' }}
                                        >
                                          Número *
                                        </label>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setNumero('S/N');
                                            setCheckoutError(null);
                                          }}
                                          className="text-[11px] font-bold underline"
                                          style={{ color: 'var(--menu-accent)' }}
                                        >
                                          S/N
                                        </button>
                                      </div>
                                      <input
                                        ref={numeroInputRef}
                                        id="end-num"
                                        type="text"
                                        inputMode="numeric"
                                        required
                                        value={numero}
                                        onChange={(e) => {
                                          setNumero(e.target.value);
                                          setCheckoutError(null);
                                        }}
                                        placeholder="123"
                                        style={{
                                          backgroundColor: 'var(--menu-input-bg)',
                                          color: 'var(--menu-text)',
                                          border: '1px solid var(--menu-border)',
                                        }}
                                        className="w-full min-h-[48px] px-3.5 py-2 rounded-xl text-sm focus:outline-none"
                                      />
                                    </div>
                                  </div>

                                  <div>
                                    <label
                                      htmlFor="end-comp"
                                      className="block text-xs font-medium mb-1"
                                      style={{ color: 'var(--menu-muted)' }}
                                    >
                                      Complemento (opcional)
                                    </label>
                                    <input
                                      id="end-comp"
                                      type="text"
                                      value={complemento}
                                      onChange={(e) => setComplemento(e.target.value)}
                                      placeholder="Apto, bloco, casa dos fundos..."
                                      style={{
                                        backgroundColor: 'var(--menu-input-bg)',
                                        color: 'var(--menu-text)',
                                        border: '1px solid var(--menu-border)',
                                      }}
                                      className="w-full min-h-[48px] px-3.5 py-2 rounded-xl text-sm focus:outline-none"
                                    />
                                  </div>

                                  <div className="grid grid-cols-12 gap-2.5">
                                    <div className="col-span-12 sm:col-span-5">
                                      <label
                                        htmlFor="end-bairro"
                                        className="block text-xs font-medium mb-1"
                                        style={{ color: 'var(--menu-muted)' }}
                                      >
                                        Bairro {modoEntrega === 'fixa' ? '*' : ''}
                                      </label>
                                      <input
                                        id="end-bairro"
                                        type="text"
                                        required={modoEntrega === 'fixa'}
                                        value={bairroInput}
                                        onChange={(e) => {
                                          setBairroInput(e.target.value);
                                          setManualSelectedAreaId('');
                                          setCheckoutError(null);
                                        }}
                                        placeholder="Nome do bairro"
                                        style={{
                                          backgroundColor: 'var(--menu-input-bg)',
                                          color: 'var(--menu-text)',
                                          border: '1px solid var(--menu-border)',
                                        }}
                                        className="w-full min-h-[48px] px-3.5 py-2 rounded-xl text-sm focus:outline-none"
                                      />
                                    </div>

                                    <div className="col-span-8 sm:col-span-5">
                                      <label
                                        htmlFor="end-cidade"
                                        className="block text-xs font-medium mb-1"
                                        style={{ color: 'var(--menu-muted)' }}
                                      >
                                        Cidade *
                                      </label>
                                      <input
                                        id="end-cidade"
                                        type="text"
                                        required
                                        value={cidadeInput}
                                        onChange={(e) => {
                                          setCidadeInput(e.target.value);
                                          setManualSelectedAreaId('');
                                          setCheckoutError(null);
                                        }}
                                        placeholder="Cidade"
                                        style={{
                                          backgroundColor: 'var(--menu-input-bg)',
                                          color: 'var(--menu-text)',
                                          border: '1px solid var(--menu-border)',
                                        }}
                                        className="w-full min-h-[48px] px-3.5 py-2 rounded-xl text-sm focus:outline-none"
                                      />
                                    </div>

                                    <div className="col-span-4 sm:col-span-2">
                                      <label
                                        htmlFor="end-uf"
                                        className="block text-xs font-medium mb-1"
                                        style={{ color: 'var(--menu-muted)' }}
                                      >
                                        UF
                                      </label>
                                      <input
                                        id="end-uf"
                                        type="text"
                                        maxLength={2}
                                        value={ufInput}
                                        onChange={(e) =>
                                          setUfInput(e.target.value.toUpperCase().slice(0, 2))
                                        }
                                        placeholder="SP"
                                        style={{
                                          backgroundColor: 'var(--menu-input-bg)',
                                          color: 'var(--menu-text)',
                                          border: '1px solid var(--menu-border)',
                                        }}
                                        className="w-full min-h-[48px] px-3 py-2 rounded-xl text-sm uppercase text-center focus:outline-none"
                                      />
                                    </div>
                                  </div>

                                  {/* Cálculo de frete automático ou seleção manual quando modo_entrega = 'bairro' */}
                                  {modoEntrega === 'bairro' && (
                                    <div className="pt-1 space-y-2.5">
                                      {bairrosLoadError ? (
                                        <p className="text-xs text-rose-500 font-semibold" role="alert">
                                          {bairrosLoadError}
                                        </p>
                                      ) : bairros.length === 0 ? (
                                        <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 space-y-2 text-xs">
                                          <p className="font-semibold text-rose-600">
                                            Nenhuma área de entrega cadastrada no momento.
                                          </p>
                                          {directWhatsAppUrl && (
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                              <span style={{ color: 'var(--menu-muted)' }}>
                                                Não atendemos sua região?
                                              </span>
                                              <a
                                                href={`${directWhatsAppUrl}?text=${encodeURIComponent(
                                                  `Olá! Gostaria de saber se entregam na minha região (${estabelecimento.nome}).`
                                                )}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="min-h-[40px] px-3.5 py-2 rounded-xl font-bold inline-flex items-center gap-1.5"
                                                style={{
                                                  backgroundColor: 'var(--menu-accent)',
                                                  color: 'var(--menu-accent-text)',
                                                }}
                                              >
                                                <MessageCircle className="w-4 h-4" />
                                                <span>Falar com a loja</span>
                                              </a>
                                            </div>
                                          )}
                                        </div>
                                      ) : autoMatchedArea && !manualSelectedAreaId ? (
                                        <div
                                          role="status"
                                          className="p-3.5 rounded-xl bg-emerald-500/14 border border-emerald-500/30 text-xs sm:text-sm font-semibold text-emerald-700 flex items-start gap-2.5"
                                        >
                                          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
                                          <div className="space-y-0.5">
                                            <p>
                                              Entregamos no seu bairro: {autoMatchedArea.bairro}.{' '}
                                              Frete:{' '}
                                              {Number(autoMatchedArea.taxa) === 0
                                                ? 'R$ 0,00'
                                                : formatBRL(Number(autoMatchedArea.taxa))}
                                            </p>
                                            {freteGratisAplicado && Number(autoMatchedArea.taxa) > 0 && (
                                              <p className="text-[11px] font-bold">
                                                Frete grátis aplicado pelo valor do pedido!
                                              </p>
                                            )}
                                          </div>
                                        </div>
                                      ) : (
                                        <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-2.5">
                                          <p className="text-xs font-semibold text-amber-800 flex items-start gap-2">
                                            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" />
                                            <span>
                                              Não identificamos seu bairro automaticamente. Selecione abaixo:
                                            </span>
                                          </p>

                                          <select
                                            id="end-area-fallback"
                                            aria-label="Selecione sua área de entrega"
                                            value={manualSelectedAreaId}
                                            onChange={(e) => {
                                              setManualSelectedAreaId(e.target.value);
                                              setCheckoutError(null);
                                            }}
                                            style={{
                                              backgroundColor: 'var(--menu-input-bg)',
                                              color: 'var(--menu-text)',
                                              border: '1px solid var(--menu-border)',
                                            }}
                                            className="w-full min-h-[48px] px-3.5 py-2.5 rounded-xl text-sm focus:outline-none"
                                          >
                                            <option value="">Selecione cidade e bairro...</option>
                                            {groupedBairrosByCidade.map((group) => (
                                              <optgroup key={group.cidade} label={group.cidade}>
                                                {group.items.map((b) => (
                                                  <option key={b.id} value={b.id}>
                                                    {getAreaSelectLabel(b)} —{' '}
                                                    {Number(b.taxa) === 0
                                                      ? 'Grátis (R$ 0,00)'
                                                      : formatBRL(b.taxa)}
                                                  </option>
                                                ))}
                                              </optgroup>
                                            ))}
                                            <option value="__not_found__">
                                              Não encontrei minha região
                                            </option>
                                          </select>

                                          {selectedBairroObj && (
                                            <div
                                              role="status"
                                              className="p-3 rounded-xl bg-emerald-500/14 border border-emerald-500/30 text-xs font-semibold text-emerald-700 flex items-start gap-2"
                                            >
                                              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
                                              <span>
                                                Entregamos no seu bairro: {selectedBairroObj.bairro}.{' '}
                                                Frete:{' '}
                                                {freteGratisAplicado || Number(selectedBairroObj.taxa) === 0
                                                  ? 'R$ 0,00 (Frete grátis!)'
                                                  : formatBRL(effectiveDeliveryFee)}
                                              </span>
                                            </div>
                                          )}

                                          {(!selectedBairroObj ||
                                            manualSelectedAreaId === '__not_found__') && (
                                            <div className="pt-1 flex flex-wrap items-center justify-between gap-2 text-xs">
                                              <span className="font-semibold text-rose-600">
                                                Não atendemos sua região?
                                              </span>
                                              {directWhatsAppUrl && (
                                                <a
                                                  href={`${directWhatsAppUrl}?text=${encodeURIComponent(
                                                    `Olá! Não encontrei meu bairro (${
                                                      bairroInput.trim() || 'informar bairro'
                                                    }${
                                                      cidadeInput.trim() ? ` - ${cidadeInput.trim()}` : ''
                                                    }) na lista de entregas de ${estabelecimento.nome}. Vocês entregam nessa região?`
                                                  )}`}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  className="min-h-[42px] px-4 py-2 rounded-xl font-bold inline-flex items-center gap-1.5 shadow-xs"
                                                  style={{
                                                    backgroundColor: 'var(--menu-accent)',
                                                    color: 'var(--menu-accent-text)',
                                                  }}
                                                >
                                                  <MessageCircle className="w-4 h-4" />
                                                  <span>Falar com a loja</span>
                                                </a>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Observação Geral do Pedido */}
                  <div
                    className="space-y-2 pt-4"
                    style={{ borderTop: '1px solid var(--menu-border)' }}
                  >
                    <label htmlFor="cli-pedido-obs" className="block text-xs font-semibold">
                      Observação do pedido (opcional)
                    </label>
                    <textarea
                      id="cli-pedido-obs"
                      rows={2}
                      maxLength={300}
                      value={pedidoObs}
                      onChange={(e) => setPedidoObs(e.target.value)}
                      placeholder="Ex.: Troco para R$ 50, tocar campainha..."
                      style={{
                        backgroundColor: 'var(--menu-input-bg)',
                        color: 'var(--menu-text)',
                        border: '1px solid var(--menu-border)',
                      }}
                      className="w-full px-3.5 py-2 rounded-xl text-xs sm:text-sm focus:outline-none"
                    />
                  </div>

                  {/* Forma de Pagamento */}
                  <div
                    className="space-y-3 pt-4"
                    style={{ borderTop: '1px solid var(--menu-border)' }}
                  >
                    <h3 className="text-sm font-bold">Forma de pagamento</h3>
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => setFormaPagamento('na_entrega')}
                        style={{
                          backgroundColor: 'var(--menu-bg)',
                          border:
                            formaPagamento === 'na_entrega'
                              ? '2px solid var(--menu-accent)'
                              : '1px solid var(--menu-border)',
                        }}
                        className="w-full min-h-[46px] px-4 py-3 rounded-xl text-left text-sm font-medium flex items-center justify-between transition-all duration-200"
                      >
                        <span className="inline-flex items-center gap-2.5">
                          <CreditCard className="w-4 h-4" />
                          <span>
                            {isEntrega ? 'Pagar na entrega' : 'Pagar na retirada'}
                          </span>
                        </span>
                        {formaPagamento === 'na_entrega' && (
                          <Check className="w-4 h-4" style={{ color: 'var(--menu-accent)' }} />
                        )}
                      </button>

                      {(estabelecimento.chave_pix || '').trim() && (
                        <div
                          style={{
                            backgroundColor: 'var(--menu-bg)',
                            border:
                              formaPagamento === 'pix'
                                ? '2px solid var(--menu-accent)'
                                : '1px solid var(--menu-border)',
                          }}
                          className="rounded-xl overflow-hidden transition-all duration-200"
                        >
                          <button
                            type="button"
                            onClick={() => setFormaPagamento('pix')}
                            className="w-full min-h-[46px] px-4 py-3 text-left text-sm font-medium flex items-center justify-between"
                          >
                            <span className="inline-flex items-center gap-2.5">
                              <QrCode className="w-4 h-4" />
                              <span>Pix (copia e cola)</span>
                            </span>
                            {formaPagamento === 'pix' && (
                              <Check className="w-4 h-4" style={{ color: 'var(--menu-accent)' }} />
                            )}
                          </button>

                          {formaPagamento === 'pix' && (
                            <div
                              className="px-4 pb-4 pt-2 space-y-2"
                              style={{ borderTop: '1px solid var(--menu-border)' }}
                            >
                              <p className="text-xs" style={{ color: 'var(--menu-muted)' }}>
                                Copie a chave Pix abaixo e envie o comprovante junto com o pedido no WhatsApp:
                              </p>
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  readOnly
                                  value={estabelecimento.chave_pix}
                                  aria-label="Chave Pix"
                                  style={{
                                    backgroundColor: 'var(--menu-input-bg)',
                                    color: 'var(--menu-text)',
                                    border: '1px solid var(--menu-border)',
                                  }}
                                  className="w-full min-h-[40px] px-3 py-1.5 text-xs font-mono-code rounded-lg"
                                />
                                <button
                                  type="button"
                                  onClick={handleCopyPix}
                                  className="min-h-[40px] px-3.5 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 shrink-0"
                                  style={{
                                    backgroundColor: 'var(--menu-accent)',
                                    color: 'var(--menu-accent-text)',
                                  }}
                                >
                                  {pixCopied ? (
                                    <Check className="w-3.5 h-3.5" />
                                  ) : (
                                    <Copy className="w-3.5 h-3.5" />
                                  )}
                                  <span>{pixCopied ? 'Copiado!' : 'Copiar'}</span>
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {safePaymentLink && (
                        <div
                          style={{
                            backgroundColor: 'var(--menu-bg)',
                            border:
                              formaPagamento === 'link'
                                ? '2px solid var(--menu-accent)'
                                : '1px solid var(--menu-border)',
                          }}
                          className="rounded-xl overflow-hidden transition-all duration-200"
                        >
                          <button
                            type="button"
                            onClick={() => setFormaPagamento('link')}
                            className="w-full min-h-[46px] px-4 py-3 text-left text-sm font-medium flex items-center justify-between"
                          >
                            <span className="inline-flex items-center gap-2.5">
                              <ExternalLink className="w-4 h-4" />
                              <span>Link de pagamento online</span>
                            </span>
                            {formaPagamento === 'link' && (
                              <Check className="w-4 h-4" style={{ color: 'var(--menu-accent)' }} />
                            )}
                          </button>

                          {formaPagamento === 'link' && (
                            <div
                              className="px-4 pb-4 pt-2 space-y-2"
                              style={{ borderTop: '1px solid var(--menu-border)' }}
                            >
                              <p className="text-xs" style={{ color: 'var(--menu-muted)' }}>
                                Abra o link externo de pagamento do estabelecimento e conclua a transação.
                              </p>
                              <a
                                href={safePaymentLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="w-full min-h-[42px] px-4 py-2 rounded-lg text-xs font-bold inline-flex items-center justify-center gap-2"
                                style={{
                                  backgroundColor: 'var(--menu-accent)',
                                  color: 'var(--menu-accent-text)',
                                }}
                              >
                                <ExternalLink className="w-4 h-4" />
                                <span>Abrir Link de Pagamento</span>
                              </a>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {cart.length > 0 && !confirmedOrder && (
              <div
                className="p-5 space-y-3 shrink-0"
                style={{
                  backgroundColor: 'var(--menu-bg)',
                  borderTop: '1px solid var(--menu-border)',
                }}
              >
                {/* Resumo: Subtotal, Taxa de Entrega, Tempo Estimado e Total */}
                <div className="space-y-1.5 text-sm">
                  <div className="flex items-center justify-between" style={{ color: 'var(--menu-muted)' }}>
                    <span>Subtotal</span>
                    <span className="tabular-nums font-medium">{formatBRL(cartSubtotal)}</span>
                  </div>

                  <div className="flex items-center justify-between" style={{ color: 'var(--menu-muted)' }}>
                    <span>Frete</span>
                    <span className="tabular-nums font-medium">
                      {!isEntrega
                        ? 'R$ 0,00 (Retirada)'
                        : freteGratisAplicado
                        ? 'Frete grátis!'
                        : modoEntrega === 'bairro' && !selectedBairroObj
                        ? addressFieldsUnlocked
                          ? 'Região não selecionada'
                          : 'Informe o CEP ou endereço'
                        : effectiveDeliveryFee === 0
                        ? 'Frete grátis!'
                        : formatBRL(effectiveDeliveryFee)}
                    </span>
                  </div>

                  {estabelecimento.tempo_estimado && (
                    <div className="flex items-center justify-between text-xs" style={{ color: 'var(--menu-muted)' }}>
                      <span>Tempo estimado</span>
                      <span>{estabelecimento.tempo_estimado}</span>
                    </div>
                  )}

                  <div
                    className="flex items-center justify-between text-base font-bold pt-2"
                    style={{ borderTop: '1px solid var(--menu-border)' }}
                  >
                    <span>Total do pedido</span>
                    <span className="tabular-nums" style={{ color: 'var(--menu-accent)' }}>
                      {formatBRL(cartTotal)}
                    </span>
                  </div>
                </div>

                {belowMinimumOrder && (
                  <div
                    className="p-3 rounded-xl bg-rose-500/12 border border-rose-500/30 text-xs font-semibold text-rose-500 flex items-start gap-2"
                    role="alert"
                  >
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      Pedido mínimo de {formatBRL(pedidoMinimo)}. Adicione mais{' '}
                      {formatBRL(missingForMinimum)} para finalizar.
                    </span>
                  </div>
                )}

                {!hasWhatsAppConfigured && (
                  <div
                    className="p-3 rounded-xl bg-amber-500/12 border border-amber-500/30 text-xs font-semibold text-amber-600 flex items-start gap-2"
                    role="alert"
                  >
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>Este estabelecimento ainda não configurou o WhatsApp</span>
                  </div>
                )}

                {missingMatchedAreaForDelivery && addressFieldsUnlocked && (
                  <div
                    className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs font-semibold text-rose-600 flex items-start gap-2"
                    role="alert"
                  >
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      Selecione uma área de entrega atendida acima ou escolha Retirada no local para finalizar.
                    </span>
                  </div>
                )}

                {checkoutError && (
                  <p className="text-xs font-semibold text-rose-500" role="alert">
                    {checkoutError}
                  </p>
                )}

                <button
                  type="button"
                  disabled={
                    submittingOrder ||
                    cepLoading ||
                    !hasWhatsAppConfigured ||
                    belowMinimumOrder ||
                    !acceptsAnyOrderMode ||
                    missingMatchedAreaForDelivery
                  }
                  onClick={handleSubmitOrder}
                  className="w-full min-h-[48px] px-5 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-sm transition-all duration-200 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{
                    backgroundColor: 'var(--menu-accent)',
                    color: 'var(--menu-accent-text)',
                  }}
                >
                  <MessageCircle className="w-5 h-5" />
                  <span>{submittingOrder ? 'Enviando pedido...' : 'Enviar pedido'}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
