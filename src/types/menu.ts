export type ModoEntrega = 'fixa' | 'bairro';

export type ThemeId =
  | 'classico'
  | 'premium_escuro'
  | 'vinho_dourado'
  | 'natural'
  | 'laranja_vibrante'
  | 'rosa_doce'
  | 'personalizado';

export interface Estabelecimento {
  id: string;
  owner_id: string;
  nome: string;
  slug: string;
  whatsapp: string;
  chave_pix: string;
  link_pagamento: string;
  horario: string;
  cor_primaria: string;
  cor_secundaria: string;
  logo_url: string | null;
  capa_url?: string | null;
  tema?: ThemeId | string | null;
  aceita_entrega?: boolean | null;
  aceita_retirada?: boolean | null;
  modo_entrega?: ModoEntrega | string | null;
  taxa_entrega?: number | null;
  entrega_gratis_acima?: number | null;
  pedido_minimo?: number | null;
  tempo_estimado?: string | null;
  cep?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro_loja?: string | null;
  cidade?: string | null;
  uf?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  mostrar_endereco?: boolean | null;
  ativo: boolean;
  created_at?: string;
}

export interface BairroEntrega {
  id: string;
  estabelecimento_id: string;
  bairro: string;
  taxa: number;
  cidade?: string | null;
  bairro_nome?: string | null;
  distancia_km?: number | null;
}

export function formatAreaLabel(cidade: string, bairroNome?: string | null): string {
  const cleanCidade = cidade.trim();
  const cleanBairro = (bairroNome || '').trim();
  if (!cleanCidade) return cleanBairro;
  if (cleanBairro) {
    return `${cleanBairro} - ${cleanCidade}`;
  }
  return `${cleanCidade} (toda a cidade)`;
}

export function getAreaCidade(area: Pick<BairroEntrega, 'bairro' | 'cidade' | 'bairro_nome'>): string {
  const explicitCidade = (area.cidade || '').trim();
  if (explicitCidade) return explicitCidade;

  const rawLabel = (area.bairro || '').trim();
  const wholeCitySuffix = ' (toda a cidade)';
  if (rawLabel.toLowerCase().endsWith(wholeCitySuffix)) {
    return rawLabel.slice(0, rawLabel.length - wholeCitySuffix.length).trim() || 'Outras regiões';
  }
  const dashIdx = rawLabel.lastIndexOf(' - ');
  if (dashIdx > 0) {
    return rawLabel.slice(dashIdx + 3).trim() || 'Outras regiões';
  }
  return 'Outras regiões';
}

export function getAreaBairroNome(area: Pick<BairroEntrega, 'bairro' | 'cidade' | 'bairro_nome'>): string {
  if (area.cidade && area.cidade.trim()) {
    return (area.bairro_nome || '').trim();
  }
  const rawLabel = (area.bairro || '').trim();
  const wholeCitySuffix = ' (toda a cidade)';
  if (rawLabel.toLowerCase().endsWith(wholeCitySuffix)) {
    return '';
  }
  const dashIdx = rawLabel.lastIndexOf(' - ');
  if (dashIdx > 0) {
    return rawLabel.slice(0, dashIdx).trim();
  }
  return rawLabel;
}

export function getAreaSelectLabel(area: Pick<BairroEntrega, 'bairro' | 'cidade' | 'bairro_nome'>): string {
  const bairroNome = getAreaBairroNome(area);
  return bairroNome || 'Toda a cidade';
}

export interface Categoria {
  id: string;
  estabelecimento_id: string;
  nome: string;
  ordem: number;
}

export interface Produto {
  id: string;
  estabelecimento_id: string;
  categoria_id: string | null;
  nome: string;
  descricao: string;
  preco: number;
  foto_url: string;
  ativo: boolean;
  ordem: number;
  created_at?: string;
}

export interface CartItem {
  cartItemId: string;
  produto: Produto;
  quantidade: number;
  observacao: string;
}

export type TipoEntrega = 'entrega' | 'retirada';
export type FormaPagamento = 'na_entrega' | 'pix' | 'link';

export type PedidoStatus =
  | 'novo'
  | 'em_preparo'
  | 'saiu_entrega'
  | 'pronto_retirada'
  | 'entregue'
  | 'cancelado';

export interface PedidoItem {
  produto_id?: string;
  nome?: string;
  produto_nome?: string;
  qtd?: number;
  quantidade?: number;
  preco?: number;
  preco_unitario?: number;
  subtotal?: number;
  obs?: string | null;
  observacao?: string | null;
}

export interface Pedido {
  id: string;
  estabelecimento_id: string;
  numero: number;
  cliente: string;
  telefone: string | null;
  tipo: TipoEntrega;
  endereco: string | null;
  bairro: string | null;
  pagamento: FormaPagamento | string;
  obs: string | null;
  itens: PedidoItem[];
  subtotal: number;
  taxa_entrega: number;
  total: number;
  status: PedidoStatus | string;
  pago: boolean;
  created_at: string;
}

export interface CriarPedidoResult {
  id?: string;
  numero: number;
  subtotal: number;
  taxa_entrega: number;
  total: number;
  itens: PedidoItem[];
}

export const DEFAULT_COR_PRIMARIA = '#E63946';
export const DEFAULT_COR_SECUNDARIA = '#1D3557';

export const PALETAS_CORES = [
  { nome: 'Clássico', primaria: '#E63946', secundaria: '#1D3557' },
  { nome: 'Dourado', primaria: '#C9A227', secundaria: '#16161D' },
  { nome: 'Vinho', primaria: '#6D1A36', secundaria: '#D4AF37' },
  { nome: 'Natural', primaria: '#2D6A4F', secundaria: '#52B788' },
  { nome: 'Vibrante', primaria: '#FF6B35', secundaria: '#1A1A2E' },
  { nome: 'Doce', primaria: '#E75480', secundaria: '#3A1F2B' },
];

export interface ThemeTokens {
  id: ThemeId;
  nome: string;
  descricao: string;
  bg: string;
  cardBg: string;
  text: string;
  mutedText: string;
  accent: string;
  accentText: string;
  secondary: string;
  secondaryText: string;
  border: string;
  pillBg: string;
  pillText: string;
  inputBg: string;
  headerGlass: string;
  coverGradient: string;
  isDark: boolean;
}

function normalizeHex(hex: string | null | undefined, fallback: string): string {
  if (!hex) return fallback;
  const cleaned = hex.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(cleaned)) return cleaned;
  if (/^#[0-9A-Fa-f]{3}$/.test(cleaned)) {
    return (
      '#' +
      cleaned[1] +
      cleaned[1] +
      cleaned[2] +
      cleaned[2] +
      cleaned[3] +
      cleaned[3]
    );
  }
  return fallback;
}

export function getRelativeLuminance(hex: string): number {
  const safe = normalizeHex(hex, '#000000');
  const r = parseInt(safe.slice(1, 3), 16) / 255;
  const g = parseInt(safe.slice(3, 5), 16) / 255;
  const b = parseInt(safe.slice(5, 7), 16) / 255;

  const toLinear = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function getContrastText(bgHex: string): '#FFFFFF' | '#111827' {
  const lum = getRelativeLuminance(bgHex);
  return lum > 0.36 ? '#111827' : '#FFFFFF';
}

export function hexToRgba(hex: string, alpha: number): string {
  const safe = normalizeHex(hex, '#0F172A');
  const r = parseInt(safe.slice(1, 3), 16);
  const g = parseInt(safe.slice(3, 5), 16);
  const b = parseInt(safe.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export const THEME_PRESETS: Record<Exclude<ThemeId, 'personalizado'>, ThemeTokens> = {
  classico: {
    id: 'classico',
    nome: 'Clássico',
    descricao: 'Fundo branco limpo com azul marinho e vermelho vibrante',
    bg: '#FFFFFF',
    cardBg: '#FFFFFF',
    text: '#1D3557',
    mutedText: '#526580',
    accent: '#E63946',
    accentText: '#FFFFFF',
    secondary: '#1D3557',
    secondaryText: '#FFFFFF',
    border: 'rgba(29, 53, 87, 0.12)',
    pillBg: '#F1F5F9',
    pillText: '#1D3557',
    inputBg: '#F8FAFC',
    headerGlass: 'rgba(255, 255, 255, 0.92)',
    coverGradient: 'linear-gradient(135deg, #1D3557 0%, #E63946 100%)',
    isDark: false,
  },
  premium_escuro: {
    id: 'premium_escuro',
    nome: 'Premium Escuro',
    descricao: 'Fundo escuro elegante com cartões grafite e ouro',
    bg: '#0B0B0F',
    cardBg: '#16161D',
    text: '#F5F5F7',
    mutedText: '#A1A1B5',
    accent: '#C9A227',
    accentText: '#0B0B0F',
    secondary: '#C9A227',
    secondaryText: '#0B0B0F',
    border: 'rgba(245, 245, 247, 0.12)',
    pillBg: '#20202A',
    pillText: '#E2E2EC',
    inputBg: '#1C1C25',
    headerGlass: 'rgba(11, 11, 15, 0.90)',
    coverGradient: 'linear-gradient(135deg, #16161D 0%, #3F3212 60%, #C9A227 100%)',
    isDark: true,
  },
  vinho_dourado: {
    id: 'vinho_dourado',
    nome: 'Vinho & Dourado',
    descricao: 'Creme quente refinado com bordô intenso e detalhes em ouro',
    bg: '#FBF7F2',
    cardBg: '#FFFFFF',
    text: '#2B1B20',
    mutedText: '#6E555D',
    accent: '#6D1A36',
    accentText: '#FFFFFF',
    secondary: '#D4AF37',
    secondaryText: '#2B1B20',
    border: 'rgba(109, 26, 54, 0.14)',
    pillBg: '#F3EAE0',
    pillText: '#2B1B20',
    inputBg: '#FFFFFF',
    headerGlass: 'rgba(251, 247, 242, 0.92)',
    coverGradient: 'linear-gradient(135deg, #4A1024 0%, #6D1A36 65%, #D4AF37 100%)',
    isDark: false,
  },
  natural: {
    id: 'natural',
    nome: 'Natural',
    descricao: 'Tom orgânico suave com verde floresta acolhedor',
    bg: '#F4F1DE',
    cardBg: '#FFFDF7',
    text: '#1B2F26',
    mutedText: '#4F655B',
    accent: '#2D6A4F',
    accentText: '#FFFFFF',
    secondary: '#1B2F26',
    secondaryText: '#FFFFFF',
    border: 'rgba(27, 47, 38, 0.12)',
    pillBg: '#E7E2CA',
    pillText: '#1B2F26',
    inputBg: '#FFFDF7',
    headerGlass: 'rgba(244, 241, 222, 0.92)',
    coverGradient: 'linear-gradient(135deg, #1B2F26 0%, #2D6A4F 70%, #52B788 100%)',
    isDark: false,
  },
  laranja_vibrante: {
    id: 'laranja_vibrante',
    nome: 'Laranja Vibrante',
    descricao: 'Energia apetitosa com fundo creme claro e laranja intenso',
    bg: '#FFF8F1',
    cardBg: '#FFFFFF',
    text: '#1A1A2E',
    mutedText: '#5E5E76',
    accent: '#FF6B35',
    accentText: '#FFFFFF',
    secondary: '#1A1A2E',
    secondaryText: '#FFFFFF',
    border: 'rgba(26, 26, 46, 0.10)',
    pillBg: '#FFEAD8',
    pillText: '#1A1A2E',
    inputBg: '#FFFFFF',
    headerGlass: 'rgba(255, 248, 241, 0.92)',
    coverGradient: 'linear-gradient(135deg, #1A1A2E 0%, #D94E1F 60%, #FF6B35 100%)',
    isDark: false,
  },
  rosa_doce: {
    id: 'rosa_doce',
    nome: 'Rosa Doce',
    descricao: 'Delicado para confeitarias e docerias, com contraste marcante',
    bg: '#FFF5F8',
    cardBg: '#FFFFFF',
    text: '#3A1F2B',
    mutedText: '#765262',
    accent: '#E75480',
    accentText: '#FFFFFF',
    secondary: '#3A1F2B',
    secondaryText: '#FFFFFF',
    border: 'rgba(231, 84, 128, 0.16)',
    pillBg: '#FCE3EC',
    pillText: '#3A1F2B',
    inputBg: '#FFFFFF',
    headerGlass: 'rgba(255, 245, 248, 0.92)',
    coverGradient: 'linear-gradient(135deg, #3A1F2B 0%, #B8335D 60%, #E75480 100%)',
    isDark: false,
  },
};

export function resolveStoreTheme(
  est?: Pick<Estabelecimento, 'tema' | 'cor_primaria' | 'cor_secundaria'> | null
): ThemeTokens {
  const rawTema = est?.tema as ThemeId | undefined | null;

  if (rawTema && rawTema !== 'personalizado' && rawTema in THEME_PRESETS) {
    return THEME_PRESETS[rawTema as Exclude<ThemeId, 'personalizado'>];
  }

  // Backward compatibility: if no tema stored yet and custom colors don't exist, default to classico
  if (!rawTema && !est?.cor_primaria) {
    return THEME_PRESETS.classico;
  }

  const primaria = normalizeHex(est?.cor_primaria, DEFAULT_COR_PRIMARIA);
  const secundaria = normalizeHex(est?.cor_secundaria, DEFAULT_COR_SECUNDARIA);
  const accentText = getContrastText(primaria);
  const secondaryText = getContrastText(secundaria);

  return {
    id: 'personalizado',
    nome: 'Personalizado',
    descricao: 'Suas cores exclusivas com contraste automático legível',
    bg: '#F8FAFC',
    cardBg: '#FFFFFF',
    text: '#0F172A',
    mutedText: '#475569',
    accent: primaria,
    accentText,
    secondary: secundaria,
    secondaryText,
    border: 'rgba(15, 23, 42, 0.10)',
    pillBg: '#E2E8F0',
    pillText: '#0F172A',
    inputBg: '#FFFFFF',
    headerGlass: 'rgba(248, 250, 252, 0.92)',
    coverGradient: `linear-gradient(135deg, ${secundaria} 0%, ${primaria} 100%)`,
    isDark: false,
  };
}

export const ALL_THEME_OPTIONS: ThemeId[] = [
  'classico',
  'premium_escuro',
  'vinho_dourado',
  'natural',
  'laranja_vibrante',
  'rosa_doce',
  'personalizado',
];

/**
 * Tenta determinar se o estabelecimento está aberto agora com base no texto do horário.
 * Retorna 'open' | 'closed' ou null quando o formato não permite inferir com segurança.
 */
export function parseOpeningStatus(horario?: string | null): 'open' | 'closed' | null {
  if (!horario || !horario.trim()) return null;
  const raw = horario
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  if (raw.includes('24h') || raw.includes('24 horas')) {
    return 'open';
  }

  const now = new Date();
  const currentDay = now.getDay(); // 0=Dom ... 6=Sab
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const dayMap: Record<string, number> = {
    dom: 0,
    domingo: 0,
    seg: 1,
    segunda: 1,
    ter: 2,
    terca: 2,
    qua: 3,
    quarta: 3,
    qui: 4,
    quinta: 4,
    sex: 5,
    sexta: 5,
    sab: 6,
    sabado: 6,
  };

  // Detecta intervalo de dias opcional (ex: "seg a sex", "ter a dom", "seg-sab")
  const dayRangeMatch = raw.match(
    /\b(domingo|dom|segunda|seg|terca|ter|quarta|qua|quinta|qui|sexta|sex|sabado|sab)\s*(?:a|ate|-|–)\s*(domingo|dom|segunda|seg|terca|ter|quarta|qua|quinta|qui|sexta|sex|sabado|sab)\b/
  );

  if (dayRangeMatch) {
    const startDay = dayMap[dayRangeMatch[1]];
    const endDay = dayMap[dayRangeMatch[2]];
    if (startDay !== undefined && endDay !== undefined) {
      const isDayOpen =
        startDay <= endDay
          ? currentDay >= startDay && currentDay <= endDay
          : currentDay >= startDay || currentDay <= endDay;
      if (!isDayOpen) {
        return 'closed';
      }
    }
  }

  // Detecta intervalo de horas: ex "18h às 23h", "18:00 - 23:30", "09h30 as 22h"
  const timeMatch = raw.match(
    /(\d{1,2})(?:[:h](\d{2}))?\s*h?\s*(?:as|a|ate|-|–)\s*(\d{1,2})(?:[:h](\d{2}))?\s*h?/
  );

  if (!timeMatch) return null;

  const startHour = Number(timeMatch[1]);
  const startMin = Number(timeMatch[2] || '0');
  const endHour = Number(timeMatch[3]);
  const endMin = Number(timeMatch[4] || '0');

  if (
    startHour > 23 ||
    startMin > 59 ||
    endHour > 24 ||
    endMin > 59
  ) {
    return null;
  }

  const startTotal = startHour * 60 + startMin;
  const endTotal = (endHour === 24 ? 24 * 60 : endHour * 60 + endMin);

  if (startTotal === endTotal) return null;

  if (startTotal < endTotal) {
    return currentMinutes >= startTotal && currentMinutes < endTotal ? 'open' : 'closed';
  } else {
    // Passa da meia-noite (ex: 18h às 02h)
    return currentMinutes >= startTotal || currentMinutes < endTotal ? 'open' : 'closed';
  }
}

export const FORBIDDEN_SLUGS = ['painel', 'cadastro', 'admin', 'login', 'api', 'assets'];

export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/g, '');
}

export function sanitizeSlugInput(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .slice(0, 30);
}

export function validateSlugFormat(rawSlug: string): string | null {
  const clean = rawSlug.trim();
  if (!clean) {
    return 'Informe um link para sua loja.';
  }
  if (clean.startsWith('-') || clean.endsWith('-')) {
    return 'O link não pode começar nem terminar com hífen.';
  }
  if (clean.length < 3) {
    return 'O link deve ter pelo menos 3 caracteres.';
  }
  if (clean.length > 30) {
    return 'O link deve ter no máximo 30 caracteres.';
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(clean)) {
    return 'Use apenas letras minúsculas, números e hífen (sem hífen no começo ou no fim).';
  }
  if (FORBIDDEN_SLUGS.includes(clean)) {
    return 'Este link é reservado e não pode ser usado.';
  }
  return null;
}

export function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number.isFinite(value) ? value : 0);
}

export function sanitizeExternalUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

export function normalizeWhatsAppDigits(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return '';
  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) {
    return `55${digits}`;
  }
  return digits;
}

export function formatBrazilianPhoneMask(raw?: string | null): string {
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

const SP_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const SP_TIME_FORMATTER = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const SP_DATETIME_FORMATTER = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function getSaoPauloDateKey(dateInput: Date | string): string {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (Number.isNaN(date.getTime())) return '';
  return SP_DATE_FORMATTER.format(date);
}

export function shiftDateKey(dateKey: string, deltaDays: number): string {
  const parts = dateKey.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return dateKey;
  const utcDate = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + deltaDays, 12, 0, 0));
  return utcDate.toISOString().slice(0, 10);
}

export function formatSaoPauloTime(dateInput: Date | string): string {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (Number.isNaN(date.getTime())) return '--:--';
  return SP_TIME_FORMATTER.format(date);
}

export function formatSaoPauloDateTime(dateInput: Date | string): string {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (Number.isNaN(date.getTime())) return '';
  return SP_DATETIME_FORMATTER.format(date);
}

export function getPagamentoLabel(
  pagamento: FormaPagamento | string,
  tipo: TipoEntrega | string
): string {
  if (pagamento === 'pix') return 'Pix';
  if (pagamento === 'link') return 'Link de pagamento online';
  return tipo === 'entrega' ? 'Na entrega' : 'Na retirada';
}

export interface WhatsAppOrderItemInput {
  nome: string;
  qtd: number;
  subtotal: number;
  obs?: string | null;
}

export function buildWhatsAppOrderUrl(params: {
  whatsapp: string;
  estabelecimentoNome: string;
  numero?: number | string | null;
  itens: WhatsAppOrderItemInput[];
  subtotal: number;
  taxaEntrega: number;
  freteGratisAplicado?: boolean;
  total: number;
  tipoEntrega: TipoEntrega;
  bairroSelecionado?: string;
  clienteNome: string;
  clienteTelefone?: string;
  enderecoTexto?: string;
  obsPedido?: string;
  formaPagamento: FormaPagamento;
}): string | null {
  const digits = normalizeWhatsAppDigits(params.whatsapp);
  if (!digits) return null;

  const linhasItens = params.itens.map((item) => {
    const itemSubtotal = formatBRL(item.subtotal);
    const obs = item.obs && item.obs.trim() ? ` (obs: ${item.obs.trim()})` : '';
    return `• ${item.qtd}x ${item.nome}${obs} - ${itemSubtotal}`;
  });

  const labelEntrega =
    params.tipoEntrega === 'entrega'
      ? `Entrega\n*Endereço:* ${params.enderecoTexto || ''}${
          params.bairroSelecionado ? ` - ${params.bairroSelecionado}` : ''
        }`
      : 'Retirada no local';

  const labelTaxa =
    params.tipoEntrega === 'retirada'
      ? 'R$ 0,00 (Retirada)'
      : params.taxaEntrega === 0 && params.freteGratisAplicado
      ? 'Frete grátis! (R$ 0,00)'
      : params.taxaEntrega === 0
      ? params.bairroSelecionado
        ? `Grátis (${params.bairroSelecionado})`
        : 'Frete grátis! (R$ 0,00)'
      : params.bairroSelecionado
      ? `${formatBRL(params.taxaEntrega)} (${params.bairroSelecionado})`
      : formatBRL(params.taxaEntrega);

  const labelPagamento =
    params.formaPagamento === 'pix'
      ? 'Pix (comprovante enviado no WhatsApp)'
      : params.formaPagamento === 'link'
      ? 'Link de pagamento online'
      : params.tipoEntrega === 'entrega'
      ? 'Pagar na entrega'
      : 'Pagar na retirada';

  const titulo =
    params.numero !== undefined && params.numero !== null && String(params.numero).trim() !== ''
      ? `*Pedido #${params.numero} - ${params.estabelecimentoNome}*`
      : `*Novo pedido - ${params.estabelecimentoNome}*`;

  const lines: string[] = [
    titulo,
    '',
    `*Cliente:* ${params.clienteNome.trim()}`,
  ];

  if (params.clienteTelefone && params.clienteTelefone.trim()) {
    lines.push(`*Telefone:* ${params.clienteTelefone.trim()}`);
  }

  lines.push(`*Recebimento:* ${labelEntrega}`);
  lines.push('');
  lines.push('*Itens:*');
  lines.push(...linhasItens);

  if (params.obsPedido && params.obsPedido.trim()) {
    lines.push('');
    lines.push(`*Observações:* ${params.obsPedido.trim()}`);
  }

  lines.push('');
  lines.push(`*Subtotal:* ${formatBRL(params.subtotal)}`);
  lines.push(`*Taxa de entrega:* ${labelTaxa}`);
  lines.push(`*Total:* ${formatBRL(params.total)}`);
  lines.push(`*Pagamento:* ${labelPagamento}`);

  const texto = lines.join('\n');
  return `https://wa.me/${digits}?text=${encodeURIComponent(texto)}`;
}

export function formatStoreAddress(
  est: Pick<
    Estabelecimento,
    'logradouro' | 'numero' | 'complemento' | 'bairro_loja' | 'cidade' | 'uf' | 'cep'
  >
): string {
  const street = (est.logradouro || '').trim();
  const num = (est.numero || '').trim();
  const comp = (est.complemento || '').trim();
  const bairro = (est.bairro_loja || '').trim();
  const cidade = (est.cidade || '').trim();
  const uf = (est.uf || '').trim().toUpperCase();

  const parts: string[] = [];
  if (street) {
    parts.push(num ? `${street}, ${num}` : street);
  }
  if (comp) {
    parts.push(comp);
  }
  if (bairro) {
    parts.push(bairro);
  }
  if (cidade) {
    parts.push(uf ? `${cidade}/${uf}` : cidade);
  } else if (uf) {
    parts.push(uf);
  }

  return parts.join(' - ');
}

export function buildGoogleMapsLink(
  latitude?: number | null,
  longitude?: number | null
): string | null {
  if (latitude === null || latitude === undefined || longitude === null || longitude === undefined) {
    return null;
  }
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) {
    return null;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lon}`)}`;
}


