import { useEffect, useState } from 'react';
import {
  ArrowRight,
  ClipboardList,
  Database,
  MapPin,
  MessageCircle,
  QrCode,
  Store,
} from 'lucide-react';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

interface StoreDirectoryViewProps {
  onNavigate: (path: string) => void;
}

const BENEFITS = [
  {
    icon: QrCode,
    title: 'Cardápio por QR Code',
    description:
      'Gere o link exclusivo e baixe o QR Code pronto para imprimir nas mesas, balcão ou embalagens.',
  },
  {
    icon: MessageCircle,
    title: 'Pedidos pelo WhatsApp',
    description:
      'Seus clientes escolhem os itens na sacola e enviam o pedido completo direto para o seu WhatsApp.',
  },
  {
    icon: ClipboardList,
    title: 'Painel de pedidos',
    description:
      'Acompanhe cada pedido em tempo real, atualize o status do preparo e controle os pagamentos.',
  },
  {
    icon: MapPin,
    title: 'Entrega por bairro',
    description:
      'Preenchimento automático por CEP, taxas personalizadas por cidade e bairro, pedido mínimo e frete grátis.',
  },
];

export function StoreDirectoryView({ onNavigate }: StoreDirectoryViewProps) {
  const [checkingSession, setCheckingSession] = useState(isSupabaseConfigured);

  useEffect(() => {
    let active = true;

    async function checkAuthRedirect() {
      if (!isSupabaseConfigured || !supabase) {
        if (active) setCheckingSession(false);
        return;
      }

      try {
        const { data } = await supabase.auth.getSession();
        if (!active) return;
        if (data?.session?.user) {
          onNavigate('/painel');
          return;
        }
      } catch {
        // Ignora erro transitório ao checar sessão inicial
      } finally {
        if (active) setCheckingSession(false);
      }
    }

    checkAuthRedirect();
    return () => {
      active = false;
    };
  }, [onNavigate]);

  if (checkingSession) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="w-7 h-7 rounded-full border-2 border-slate-300 border-t-slate-900 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Cabeçalho neutro */}
      <header className="sticky top-0 z-30 h-16 bg-white/95 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-5xl mx-auto h-full px-4 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => onNavigate('/')}
            className="inline-flex items-center gap-2.5 font-display text-lg font-bold tracking-tight text-slate-900"
          >
            <span className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center">
              <Store className="w-4 h-4" />
            </span>
            <span>Cardápio Digital</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onNavigate('/cadastro')}
              className="hidden sm:inline-flex min-h-[40px] px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-sm font-semibold transition-colors"
            >
              Criar minha loja
            </button>
            <button
              type="button"
              onClick={() => onNavigate('/painel')}
              className="min-h-[40px] px-4 py-2 rounded-xl bg-slate-900 text-white hover:bg-slate-800 text-sm font-semibold whitespace-nowrap transition-colors shadow-xs"
            >
              Entrar no meu painel
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero voltado ao dono */}
        <section className="max-w-5xl mx-auto px-4 pt-14 pb-12 sm:pt-20 sm:pb-16 text-center">
          <div className="max-w-2xl mx-auto space-y-6">
            <h1 className="font-display text-4xl sm:text-5xl font-extrabold tracking-tight text-slate-900 text-balance leading-[1.12]">
              Cardápio Digital
            </h1>

            <p className="text-base sm:text-xl text-slate-600 leading-relaxed text-balance">
              Crie seu cardápio digital, receba pedidos pelo WhatsApp e gerencie tudo em um só lugar
            </p>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => onNavigate('/painel')}
                className="min-h-[48px] px-6 py-3 rounded-xl bg-slate-900 text-white hover:bg-slate-800 text-sm sm:text-base font-bold inline-flex items-center justify-center gap-2 shadow-sm transition-colors"
              >
                <span>Entrar no meu painel</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => onNavigate('/cadastro')}
                className="min-h-[48px] px-6 py-3 rounded-xl border border-slate-300 bg-white text-slate-900 hover:bg-slate-100 text-sm sm:text-base font-semibold inline-flex items-center justify-center transition-colors shadow-xs"
              >
                Criar minha loja
              </button>
            </div>
          </div>
        </section>

        {/* Guia caso Supabase não esteja configurado */}
        {!isSupabaseConfigured && (
          <section className="max-w-5xl mx-auto px-4 pb-10">
            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-3 shadow-xs">
              <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
                <Database className="w-5 h-5 text-slate-700" />
                <span>Configuração do Supabase necessária</span>
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">
                Defina as variáveis de ambiente{' '}
                <code className="font-mono text-xs">VITE_SUPABASE_URL</code> e{' '}
                <code className="font-mono text-xs">VITE_SUPABASE_ANON_KEY</code> para ativar o
                sistema.
              </p>
            </div>
          </section>
        )}

        {/* Cartões de benefícios */}
        <section className="max-w-5xl mx-auto px-4 pb-16">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {BENEFITS.map((benefit) => {
              const Icon = benefit.icon;
              return (
                <div
                  key={benefit.title}
                  className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 shadow-xs"
                >
                  <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-800 flex items-center justify-center">
                    <Icon className="w-5 h-5" />
                  </div>
                  <h2 className="text-base font-bold text-slate-900">{benefit.title}</h2>
                  <p className="text-sm text-slate-600 leading-relaxed">{benefit.description}</p>
                </div>
              );
            })}
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-5xl mx-auto px-4 py-6 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
          <span>Cardápio Digital</span>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => onNavigate('/cadastro')}
              className="hover:text-slate-900 font-semibold"
            >
              Criar minha loja
            </button>
            <button
              type="button"
              onClick={() => onNavigate('/painel')}
              className="hover:text-slate-900 font-semibold"
            >
              Entrar no meu painel
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
