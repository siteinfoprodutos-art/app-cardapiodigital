import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, CheckCircle2, Copy, Loader2, Lock } from 'lucide-react';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import {
  FORBIDDEN_SLUGS,
  sanitizeSlugInput,
  slugify,
  validateSlugFormat,
} from '../types/menu';

interface SlugFieldProps {
  id?: string;
  value: string;
  onChange: (nextSlug: string) => void;
  cidadeHint?: string;
  placeholder?: string;
  allowCopyPreview?: boolean;
}

type AvailabilityStatus = 'idle' | 'checking' | 'available' | 'taken' | 'error';

function buildSlugWithSuffix(baseSlug: string, suffix: string): string {
  const cleanSuffix = slugify(suffix);
  if (!cleanSuffix) return '';
  const maxBaseLen = 30 - cleanSuffix.length - 1;
  if (maxBaseLen < 2) return '';
  const trimmedBase = baseSlug.slice(0, maxBaseLen).replace(/-+$/g, '');
  if (!trimmedBase) return '';
  return `${trimmedBase}-${cleanSuffix}`;
}

export function SlugField({
  id = 'store-slug',
  value,
  onChange,
  cidadeHint,
  placeholder = 'ajlb',
  allowCopyPreview = true,
}: SlugFieldProps) {
  const [availability, setAvailability] = useState<AvailabilityStatus>('idle');
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  const checkCounterRef = useRef(0);
  const lastCheckedSlugRef = useRef<string>('');

  const formatError = value ? validateSlugFormat(value) : null;

  useEffect(() => {
    if (value !== lastCheckedSlugRef.current) {
      setAvailability('idle');
      setAvailabilityError(null);
      setSuggestions([]);
    }
  }, [value]);

  const checkSlugAvailability = async (slugToCheck: string) => {
    const clean = slugToCheck.trim();
    const validationErr = validateSlugFormat(clean);
    if (validationErr) {
      setAvailability('idle');
      setSuggestions([]);
      return;
    }

    if (!isSupabaseConfigured || !supabase) {
      return;
    }

    const requestId = ++checkCounterRef.current;
    lastCheckedSlugRef.current = clean;
    setAvailability('checking');
    setAvailabilityError(null);
    setSuggestions([]);

    try {
      const { data, error } = await supabase
        .from('estabelecimentos')
        .select('id')
        .eq('slug', clean)
        .limit(1)
        .maybeSingle();

      if (requestId !== checkCounterRef.current) return;

      if (error) {
        setAvailability('error');
        setAvailabilityError('Não foi possível verificar disponibilidade agora.');
        return;
      }

      if (!data) {
        setAvailability('available');
        setSuggestions([]);
        return;
      }

      // Slug já está em uso: montar variações (slug-2, slug-cidade, slug-3, slug-loja)
      const rawCandidates = [
        buildSlugWithSuffix(clean, '2'),
        cidadeHint ? buildSlugWithSuffix(clean, cidadeHint) : '',
        buildSlugWithSuffix(clean, '3'),
        buildSlugWithSuffix(clean, 'loja'),
      ].filter(
        (cand, idx, arr) =>
          Boolean(cand) &&
          cand !== clean &&
          arr.indexOf(cand) === idx &&
          validateSlugFormat(cand) === null &&
          !FORBIDDEN_SLUGS.includes(cand)
      );

      let availableSuggestions = rawCandidates;
      if (rawCandidates.length > 0) {
        const { data: takenRows } = await supabase
          .from('estabelecimentos')
          .select('slug')
          .in('slug', rawCandidates);

        if (requestId !== checkCounterRef.current) return;

        const takenSet = new Set(
          (takenRows || []).map((row) => String((row as { slug?: string }).slug || ''))
        );
        availableSuggestions = rawCandidates.filter((cand) => !takenSet.has(cand)).slice(0, 3);
      }

      setAvailability('taken');
      setSuggestions(availableSuggestions);
    } catch {
      if (requestId !== checkCounterRef.current) return;
      setAvailability('error');
      setAvailabilityError('Não foi possível verificar disponibilidade agora.');
    }
  };

  const handleCopyPreview = async () => {
    const previewUrl = `${window.location.origin}/${value || placeholder}`;
    try {
      await navigator.clipboard.writeText(previewUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignorar erro de clipboard
    }
  };

  const previewUrl = `${window.location.origin}/${value || placeholder}`;

  return (
    <div className="space-y-2">
      <div>
        <label htmlFor={id} className="block text-xs font-semibold text-slate-700 mb-1">
          Link da loja (Slug) *
        </label>
        <p className="text-[11px] text-slate-500 mb-1.5">
          Escolha um nome curto, ex.: <span className="font-mono font-semibold">ajlb</span>. Esse será o link do seu cardápio.
        </p>

        <div className="flex items-center rounded-xl border border-slate-200 overflow-hidden bg-slate-50 focus-within:ring-2 focus-within:ring-slate-900/15">
          <span className="px-3 text-xs font-mono text-slate-400 select-none">/</span>
          <input
            id={id}
            type="text"
            required
            maxLength={30}
            value={value}
            onChange={(e) => onChange(sanitizeSlugInput(e.target.value))}
            onBlur={() => {
              if (value.trim()) {
                checkSlugAvailability(value);
              }
            }}
            placeholder={placeholder}
            className="w-full min-h-[44px] px-2 py-2 bg-white text-sm font-mono text-slate-900 focus:outline-none"
          />
          {availability === 'checking' && (
            <span className="pr-3 inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 shrink-0">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span className="hidden sm:inline">Verificando...</span>
            </span>
          )}
          {availability === 'available' && !formatError && (
            <span className="pr-3 inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 shrink-0">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Disponível</span>
            </span>
          )}
          {availability === 'taken' && !formatError && (
            <span className="pr-3 inline-flex items-center gap-1 text-[11px] font-bold text-rose-600 shrink-0">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>Já em uso</span>
            </span>
          )}
        </div>
      </div>

      {/* Erro de validação de formato */}
      {formatError && (
        <p className="text-xs font-semibold text-rose-600 flex items-center gap-1.5" role="alert">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{formatError}</span>
        </p>
      )}

      {/* Sugestões quando já está em uso */}
      {!formatError && availability === 'taken' && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 space-y-2" role="alert">
          <p className="text-xs font-semibold text-rose-800">
            Já em uso. Escolha outro link ou selecione uma sugestão:
          </p>
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((sug) => (
                <button
                  key={sug}
                  type="button"
                  onClick={() => {
                    lastCheckedSlugRef.current = sug;
                    onChange(sug);
                    setAvailability('available');
                    setSuggestions([]);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-white border border-rose-200 hover:border-emerald-400 hover:bg-emerald-50 text-xs font-mono font-semibold text-slate-800 transition-colors"
                >
                  /{sug}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {!formatError && availability === 'error' && availabilityError && (
        <p className="text-[11px] text-amber-700 font-medium">{availabilityError}</p>
      )}

      {/* Pré-visualização do link com domínio atual */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600">
        <span className="truncate font-mono">{previewUrl}</span>
        {allowCopyPreview && (
          <button
            type="button"
            onClick={handleCopyPreview}
            className="text-emerald-700 hover:text-emerald-800 font-semibold inline-flex items-center gap-1 shrink-0"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copiado!' : 'Copiar'}</span>
          </button>
        )}
      </div>

      {/* Aviso de imutabilidade */}
      <p className="text-[11px] text-slate-500 flex items-start gap-1.5 leading-relaxed">
        <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
        <span>
          O link não poderá ser alterado depois (porque o QR Code já pode ter sido impresso).
        </span>
      </p>
    </div>
  );
}
