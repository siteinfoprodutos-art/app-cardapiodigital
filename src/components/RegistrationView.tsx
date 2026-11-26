import { useState } from 'react';
import { ArrowLeft, Check, Copy, MessageCircle, Store, Truck } from 'lucide-react';
import { isSupabaseConfigured, supabase, translateSupabaseError } from '../lib/supabase';
import { cleanCepDigits } from '../lib/geo';
import { slugify, validateSlugFormat } from '../types/menu';
import { QrCodeGenerator } from './QrCodeGenerator';
import { SlugField } from './SlugField';
import {
  EMPTY_STORE_ADDRESS,
  StoreAddressFields,
  type StoreAddressState,
} from './StoreAddressFields';

interface RegistrationViewProps {
  onNavigate: (path: string) => void;
}

const STORAGE_PENDING_REG = 'cardapio_pending_reg_v1';
const STORAGE_INITIAL_TAB = 'cardapio_initial_tab_v1';

export function RegistrationView({ onNavigate }: RegistrationViewProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [nomeEstabelecimento, setNomeEstabelecimento] = useState('');
  const [slug, setSlug] = useState('');

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successCreated, setSuccessCreated] = useState(false);
  const [createdSlug, setCreatedSlug] = useState('');
  const [createdName, setCreatedName] = useState('');
  const [linkCopied, setLinkCopied] = useState(false);
  const [storeAddress, setStoreAddress] = useState<StoreAddressState>(EMPTY_STORE_ADDRESS);
  const [addressSaveStatus, setAddressSaveStatus] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  const appUrl = window.location.origin;

  const translateError = (err: unknown): string => {
    return translateSupabaseError(err, 'Falha ao processar cadastro. Tente novamente.');
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSupabaseConfigured || !supabase) {
      setErrorMsg('Supabase não configurado neste ambiente.');
      return;
    }

    setErrorMsg(null);

    const cleanEmail = email.trim();
    const cleanNome = nomeEstabelecimento.trim();
    const cleanSlug = slug.trim();

    if (!cleanEmail || !password || !cleanNome || !cleanSlug) {
      setErrorMsg('Preencha todos os campos obrigatórios.');
      return;
    }

    if (password.length < 6) {
      setErrorMsg('A senha deve ter pelo menos 6 caracteres.');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMsg('As senhas não coincidem.');
      return;
    }

    const slugError = validateSlugFormat(cleanSlug);
    if (slugError) {
      setErrorMsg(slugError);
      return;
    }

    setLoading(true);

    try {
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
      });

      if (authError) throw authError;

      if (authData.session) {
        const { error: rpcError } = await supabase.rpc('criar_estabelecimento', {
          p_nome: cleanNome,
          p_slug: cleanSlug,
        });

        if (rpcError) throw rpcError;

        setCreatedSlug(cleanSlug);
        setCreatedName(cleanNome);
        setSuccessCreated(true);
        return;
      }

      // Se exigir confirmação de e-mail, guardamos em sessionStorage
      sessionStorage.setItem(
        STORAGE_PENDING_REG,
        JSON.stringify({ nome: cleanNome, slug: cleanSlug })
      );

      setErrorMsg(
        'Enviamos um e-mail de confirmação. Confirme seu e-mail e depois faça login no painel para finalizar.'
      );
    } catch (err) {
      setErrorMsg(translateError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleCopyLink = async (urlToCopy: string) => {
    try {
      await navigator.clipboard.writeText(urlToCopy);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // Ignorar clipboard
    }
  };

  const shareWhatsappUrl = createdSlug
    ? `https://wa.me/?text=${encodeURIComponent(
        `Confira o cardápio digital de ${createdName}: ${appUrl}/${createdSlug}`
      )}`
    : '#';

  const handleSaveOnboardingAddress = async (resolved: StoreAddressState) => {
    if (!supabase || !createdSlug) return;
    setAddressSaveStatus(null);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const ownerId = userData?.user?.id;
      if (!ownerId) return;

      const cepDigits = cleanCepDigits(resolved.cep);
      const { error } = await supabase
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
        .eq('owner_id', ownerId)
        .eq('slug', createdSlug);

      if (error) throw error;
      setAddressSaveStatus({
        type: 'ok',
        text: 'Endereço salvo no cadastro da loja!',
      });
    } catch (err) {
      console.error('Erro ao salvar endereço no onboarding:', err);
      setAddressSaveStatus({
        type: 'err',
        text: translateSupabaseError(err, 'Não foi possível salvar o endereço agora.'),
      });
    }
  };

  if (successCreated) {
    const storeUrl = `${appUrl}/${createdSlug}`;
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
        <header className="h-14 border-b border-slate-200 bg-white px-4 flex items-center justify-between">
          <span className="font-bold text-slate-900 text-sm">Loja Criada com Sucesso</span>
          <button
            type="button"
            onClick={() => onNavigate('/painel')}
            className="text-xs font-semibold text-emerald-700 hover:text-emerald-800"
          >
            Ir para o Painel
          </button>
        </header>

        <main className="flex-1 flex items-center justify-center p-4 py-8">
          <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-8 shadow-sm">
            <div className="text-center space-y-2">
              <div className="w-14 h-14 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center mx-auto shadow-sm">
                <Check className="w-8 h-8" />
              </div>
              <h1 className="text-2xl font-bold text-slate-900">Sua loja está no ar!</h1>
              <p className="text-sm text-slate-600">
                O cardápio digital de <strong className="text-slate-800">{createdName}</strong> já está ativo e pronto para receber pedidos.
              </p>
            </div>

            {/* a) Link público grande com botão Copiar link */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Link Público do Cardápio
              </span>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={storeUrl}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-mono text-slate-800 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => handleCopyLink(storeUrl)}
                  className="min-h-[44px] px-5 py-2.5 rounded-xl bg-slate-900 text-white hover:bg-slate-800 text-sm font-bold inline-flex items-center justify-center gap-2 shrink-0 shadow-xs"
                >
                  {linkCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  <span>{linkCopied ? 'Copiado!' : 'Copiar link'}</span>
                </button>
              </div>
            </div>

            {/* b) Botão Compartilhar no WhatsApp */}
            <div>
              <a
                href={shareWhatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full min-h-[48px] rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 text-sm font-bold inline-flex items-center justify-center gap-2 shadow-xs transition-colors"
              >
                <MessageCircle className="w-5 h-5" />
                <span>Compartilhar no WhatsApp</span>
              </a>
            </div>

            {/* c) QR Code com botão Baixar PNG */}
            <div className="pt-2 border-t border-slate-100">
              <QrCodeGenerator
                nomeEstabelecimento={createdName}
                slug={createdSlug}
                onOpenMenu={(s) => onNavigate(`/${s}`)}
              />
            </div>

            {/* d) Endereço da loja (por CEP) */}
            <div className="p-4 sm:p-5 rounded-2xl bg-slate-50 border border-slate-200 space-y-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Endereço do estabelecimento (opcional)
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Digite o CEP para preencher automaticamente. Com as coordenadas confirmadas, você poderá sugerir bairros próximos para entrega.
                </p>
              </div>

              <StoreAddressFields
                value={storeAddress}
                onChange={setStoreAddress}
                onConfirmAddress={handleSaveOnboardingAddress}
                confirmButtonLabel="Confirmar e salvar endereço"
                idPrefix="reg-onb"
              />

              {addressSaveStatus && (
                <p
                  role="status"
                  className={`text-xs font-semibold rounded-xl px-3 py-2 border ${
                    addressSaveStatus.type === 'ok'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      : 'bg-rose-50 border-rose-200 text-rose-800'
                  }`}
                >
                  {addressSaveStatus.text}
                </p>
              )}
            </div>

            {/* e) Passo: Configure sua entrega */}
            <div className="p-4 sm:p-5 rounded-2xl bg-emerald-50/70 border border-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                  <Truck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-emerald-950">Configure sua entrega</h3>
                  <p className="text-xs text-emerald-900 mt-0.5 leading-relaxed">
                    Defina taxas por cidade e bairro ou taxa única, pedido mínimo, retirada e frete grátis.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  try {
                    sessionStorage.setItem(STORAGE_INITIAL_TAB, 'entrega');
                  } catch {
                    // Ignorar erro de storage
                  }
                  onNavigate('/painel');
                }}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-emerald-700 text-white hover:bg-emerald-800 text-xs sm:text-sm font-bold whitespace-nowrap shrink-0 shadow-xs transition-colors"
              >
                Configurar entrega agora
              </button>
            </div>

            {/* e) Checklist */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
              <h3 className="text-sm font-bold text-slate-900">Próximos passos (Checklist):</h3>
              <ul className="space-y-2 text-xs sm:text-sm text-slate-700">
                <li className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded-full border border-slate-400 shrink-0" />
                  <span>Preencher WhatsApp e chave Pix no Painel</span>
                </li>
                <li className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded-full border border-slate-400 shrink-0" />
                  <span>Cadastrar áreas de entrega e valores</span>
                </li>
                <li className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded-full border border-slate-400 shrink-0" />
                  <span>Criar categorias (ex: Lanches, Bebidas)</span>
                </li>
                <li className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded-full border border-slate-400 shrink-0" />
                  <span>Cadastrar produtos com foto e preço</span>
                </li>
              </ul>
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={() => onNavigate('/painel')}
                className="w-full min-h-[48px] rounded-xl bg-slate-900 text-white hover:bg-slate-800 text-sm font-bold shadow-xs"
              >
                Acessar o Painel do Dono
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <header className="h-14 border-b border-slate-200 bg-white px-4 flex items-center justify-between">
        <button
          type="button"
          onClick={() => onNavigate('/')}
          className="min-h-[44px] inline-flex items-center gap-2 text-sm font-semibold text-slate-700 hover:text-slate-900"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Voltar ao início</span>
        </button>
        <span className="font-bold text-slate-900 text-sm">Criar Conta e Loja</span>
        <div className="w-24" />
      </header>

      <main className="flex-1 flex items-center justify-center p-4 py-8">
        <div className="w-full max-w-lg bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6 shadow-sm">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold mb-3">
              <Store className="w-3.5 h-3.5" />
              <span>Cadastro de Nova Loja</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-900">Crie seu Cardápio Digital</h1>
            <p className="text-sm text-slate-600 mt-1">
              Preencha os dados abaixo para criar sua conta de proprietário e sua loja online.
            </p>
          </div>

          <form onSubmit={handleRegister} className="space-y-4">
            <div>
              <label htmlFor="reg-email" className="block text-xs font-semibold text-slate-700 mb-1">
                E-mail do Proprietário *
              </label>
              <input
                id="reg-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu@email.com"
                className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="reg-pass" className="block text-xs font-semibold text-slate-700 mb-1">
                  Senha (mín. 6 caracteres) *
                </label>
                <input
                  id="reg-pass"
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2"
                />
              </div>

              <div>
                <label htmlFor="reg-cpass" className="block text-xs font-semibold text-slate-700 mb-1">
                  Confirmar Senha *
                </label>
                <input
                  id="reg-cpass"
                  type="password"
                  required
                  minLength={6}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2"
                />
              </div>
            </div>

            <hr className="border-slate-100 my-2" />

            <div>
              <label htmlFor="reg-nome" className="block text-xs font-semibold text-slate-700 mb-1">
                Nome do Estabelecimento *
              </label>
              <input
                id="reg-nome"
                type="text"
                required
                value={nomeEstabelecimento}
                onChange={(e) => {
                  const v = e.target.value;
                  setNomeEstabelecimento(v);
                  if (!slug || slug === slugify(nomeEstabelecimento)) {
                    setSlug(slugify(v));
                  }
                }}
                placeholder="Ex: Pizzaria Bella Napoli"
                className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2"
              />
            </div>

            <SlugField
              id="reg-slug"
              value={slug}
              onChange={setSlug}
              placeholder="ajlb"
            />

            {errorMsg && (
              <p className="text-xs font-semibold text-rose-600 bg-rose-50 border border-rose-200 rounded-xl p-3" role="alert">
                {errorMsg}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full min-h-[48px] rounded-xl bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 text-sm font-bold shadow-xs transition-colors"
            >
              {loading ? 'Criando conta e loja...' : 'Criar minha loja'}
            </button>

            <div className="text-center pt-2">
              <button
                type="button"
                onClick={() => onNavigate('/painel')}
                className="text-xs text-slate-600 hover:text-slate-900 font-semibold"
              >
                Já tem uma conta? Faça login no painel
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
