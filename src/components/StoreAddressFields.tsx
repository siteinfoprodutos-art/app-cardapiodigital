import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, MapPin } from 'lucide-react';
import {
  cleanCepDigits,
  formatCepMask,
  geocodeAddressNominatim,
  lookupCep,
} from '../lib/geo';

export interface StoreAddressState {
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro_loja: string;
  cidade: string;
  uf: string;
  latitude: number | null;
  longitude: number | null;
  mostrar_endereco: boolean;
}

export const EMPTY_STORE_ADDRESS: StoreAddressState = {
  cep: '',
  logradouro: '',
  numero: '',
  complemento: '',
  bairro_loja: '',
  cidade: '',
  uf: '',
  latitude: null,
  longitude: null,
  mostrar_endereco: false,
};

interface StoreAddressFieldsProps {
  value: StoreAddressState;
  onChange: (next: StoreAddressState) => void;
  onConfirmAddress?: (resolved: StoreAddressState) => Promise<void> | void;
  confirmButtonLabel?: string;
  idPrefix?: string;
  showVisibilityToggle?: boolean;
}

export function StoreAddressFields({
  value,
  onChange,
  onConfirmAddress,
  confirmButtonLabel = 'Confirmar endereço',
  idPrefix = 'addr',
  showVisibilityToggle = true,
}: StoreAddressFieldsProps) {
  const [cepLoading, setCepLoading] = useState(false);
  const [cepError, setCepError] = useState<string | null>(null);
  const [cepNotice, setCepNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [coordNotice, setCoordNotice] = useState<{
    type: 'ok' | 'warn';
    text: string;
  } | null>(null);

  const lastLookedUpCepRef = useRef<string>(cleanCepDigits(value.cep));
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    const digits = cleanCepDigits(value.cep);
    if (digits.length < 8) {
      if (digits.length === 0) {
        lastLookedUpCepRef.current = '';
      }
      return;
    }

    if (digits === lastLookedUpCepRef.current) {
      return;
    }

    lastLookedUpCepRef.current = digits;
    let cancelled = false;

    async function runCepLookup() {
      setCepLoading(true);
      setCepError(null);
      setCepNotice(null);
      setCoordNotice(null);

      try {
        const res = await lookupCep(digits);
        if (cancelled) return;

        const latest = valueRef.current;
        const hasCoords = res.latitude !== null && res.longitude !== null;

        onChange({
          ...latest,
          cep: formatCepMask(res.cep),
          logradouro: res.logradouro || latest.logradouro,
          bairro_loja: res.bairro || latest.bairro_loja,
          cidade: res.cidade || latest.cidade,
          uf: res.uf || latest.uf,
          latitude: hasCoords ? res.latitude : null,
          longitude: hasCoords ? res.longitude : null,
        });

        setCepNotice(
          hasCoords
            ? 'CEP encontrado com localização automática! Informe o número e confira os dados.'
            : 'CEP encontrado! Informe o número e clique em "Confirmar endereço" para localizar no mapa.'
        );
      } catch (err) {
        if (cancelled) return;
        setCepError(
          err instanceof Error
            ? err.message
            : 'CEP inválido ou não encontrado. Preencha o endereço manualmente.'
        );
      } finally {
        if (!cancelled) {
          setCepLoading(false);
        }
      }
    }

    runCepLookup();

    return () => {
      cancelled = true;
    };
  }, [value.cep, onChange]);

  const handleFieldChange = (
    field: keyof StoreAddressState,
    fieldValue: string | boolean,
    invalidateCoords = false
  ) => {
    if (invalidateCoords) {
      setCoordNotice(null);
    }
    onChange({
      ...value,
      [field]: fieldValue,
      ...(invalidateCoords ? { latitude: null, longitude: null } : {}),
    });
  };

  const handleConfirmClick = async () => {
    setCepError(null);
    setCoordNotice(null);

    const hasBasicAddress = Boolean(
      value.logradouro.trim() || (value.cidade.trim() && value.uf.trim())
    );
    if (!hasBasicAddress) {
      setCoordNotice({
        type: 'warn',
        text: 'Informe pelo menos o logradouro, cidade e UF antes de confirmar o endereço.',
      });
      return;
    }

    setConfirming(true);
    try {
      let nextState = { ...value };

      // Se ainda não temos coordenadas da BrasilAPI, faz UMA consulta ao Nominatim
      if (nextState.latitude === null || nextState.longitude === null) {
        const coords = await geocodeAddressNominatim({
          logradouro: nextState.logradouro,
          numero: nextState.numero,
          cidade: nextState.cidade,
          uf: nextState.uf,
        });

        if (coords) {
          nextState = {
            ...nextState,
            latitude: coords.latitude,
            longitude: coords.longitude,
          };
          onChange(nextState);
          setCoordNotice({
            type: 'ok',
            text: 'Endereço confirmado com coordenadas! A busca de bairros próximos está liberada.',
          });
        } else {
          nextState = {
            ...nextState,
            latitude: null,
            longitude: null,
          };
          onChange(nextState);
          setCoordNotice({
            type: 'warn',
            text: 'Não foi possível localizar as coordenadas exatas deste endereço. Você pode seguir normalmente, mas a busca automática de bairros próximos ficará indisponível.',
          });
        }
      } else {
        setCoordNotice({
          type: 'ok',
          text: 'Endereço e coordenadas confirmados! A busca de bairros próximos está liberada.',
        });
      }

      if (onConfirmAddress) {
        await onConfirmAddress(nextState);
      }
    } finally {
      setConfirming(false);
    }
  };

  const hasSavedCoords =
    value.latitude !== null &&
    value.longitude !== null &&
    Number.isFinite(Number(value.latitude)) &&
    Number.isFinite(Number(value.longitude));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
        <div className="sm:col-span-4">
          <label
            htmlFor={`${idPrefix}-cep`}
            className="block text-xs font-semibold text-slate-700 mb-1"
          >
            CEP
          </label>
          <div className="relative">
            <input
              id={`${idPrefix}-cep`}
              type="text"
              inputMode="numeric"
              maxLength={9}
              value={formatCepMask(value.cep)}
              onChange={(e) => {
                const masked = formatCepMask(e.target.value);
                setCepError(null);
                setCepNotice(null);
                onChange({ ...value, cep: masked });
              }}
              placeholder="00000-000"
              className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 text-sm font-mono pr-9"
            />
            {cepLoading && (
              <Loader2 className="w-4 h-4 text-slate-500 animate-spin absolute right-3 top-1/2 -translate-y-1/2" />
            )}
          </div>
        </div>

        <div className="sm:col-span-6">
          <label
            htmlFor={`${idPrefix}-logradouro`}
            className="block text-xs font-semibold text-slate-700 mb-1"
          >
            Logradouro (Rua / Av.)
          </label>
          <input
            id={`${idPrefix}-logradouro`}
            type="text"
            value={value.logradouro}
            onChange={(e) => handleFieldChange('logradouro', e.target.value, true)}
            placeholder="Ex: Rua das Flores"
            className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 text-sm"
          />
        </div>

        <div className="sm:col-span-2">
          <label
            htmlFor={`${idPrefix}-numero`}
            className="block text-xs font-semibold text-slate-700 mb-1"
          >
            Número
          </label>
          <input
            id={`${idPrefix}-numero`}
            type="text"
            value={value.numero}
            onChange={(e) => handleFieldChange('numero', e.target.value, true)}
            placeholder="123"
            className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 text-sm"
          />
        </div>
      </div>

      {cepError && (
        <p
          role="alert"
          className="text-xs font-semibold text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 flex items-start gap-2"
        >
          <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <span>{cepError}</span>
        </p>
      )}

      {cepNotice && !cepError && (
        <p className="text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
          <span>{cepNotice}</span>
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
        <div className="sm:col-span-4">
          <label
            htmlFor={`${idPrefix}-complemento`}
            className="block text-xs font-semibold text-slate-700 mb-1"
          >
            Complemento
          </label>
          <input
            id={`${idPrefix}-complemento`}
            type="text"
            value={value.complemento}
            onChange={(e) => handleFieldChange('complemento', e.target.value)}
            placeholder="Loja 2, Sala 1..."
            className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 text-sm"
          />
        </div>

        <div className="sm:col-span-3">
          <label
            htmlFor={`${idPrefix}-bairro`}
            className="block text-xs font-semibold text-slate-700 mb-1"
          >
            Bairro
          </label>
          <input
            id={`${idPrefix}-bairro`}
            type="text"
            value={value.bairro_loja}
            onChange={(e) => handleFieldChange('bairro_loja', e.target.value)}
            placeholder="Centro"
            className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 text-sm"
          />
        </div>

        <div className="sm:col-span-3">
          <label
            htmlFor={`${idPrefix}-cidade`}
            className="block text-xs font-semibold text-slate-700 mb-1"
          >
            Cidade
          </label>
          <input
            id={`${idPrefix}-cidade`}
            type="text"
            value={value.cidade}
            onChange={(e) => handleFieldChange('cidade', e.target.value, true)}
            placeholder="Jundiaí"
            className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 text-sm"
          />
        </div>

        <div className="sm:col-span-2">
          <label
            htmlFor={`${idPrefix}-uf`}
            className="block text-xs font-semibold text-slate-700 mb-1"
          >
            UF
          </label>
          <input
            id={`${idPrefix}-uf`}
            type="text"
            maxLength={2}
            value={value.uf}
            onChange={(e) =>
              handleFieldChange('uf', e.target.value.toUpperCase().slice(0, 2), true)
            }
            placeholder="SP"
            className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 text-sm uppercase"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <button
          type="button"
          disabled={confirming || cepLoading}
          onClick={handleConfirmClick}
          className="min-h-[42px] px-4 py-2 rounded-xl border border-slate-300 bg-slate-50 hover:bg-slate-100 disabled:opacity-50 text-xs sm:text-sm font-bold text-slate-800 inline-flex items-center gap-2 transition-colors"
        >
          {confirming ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <MapPin className="w-4 h-4 text-emerald-700" />
          )}
          <span>{confirming ? 'Localizando endereço...' : confirmButtonLabel}</span>
        </button>

        <span
          className={`text-xs font-medium inline-flex items-center gap-1.5 ${
            hasSavedCoords ? 'text-emerald-700' : 'text-slate-500'
          }`}
        >
          {hasSavedCoords ? (
            <>
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>Coordenadas prontas para sugerir bairros</span>
            </>
          ) : (
            <span>Sem coordenadas ainda</span>
          )}
        </span>
      </div>

      {coordNotice && (
        <p
          role="status"
          className={`text-xs font-medium rounded-xl px-3 py-2 border flex items-start gap-2 ${
            coordNotice.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-amber-50 border-amber-200 text-amber-900'
          }`}
        >
          {coordNotice.type === 'ok' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          )}
          <span>{coordNotice.text}</span>
        </p>
      )}

      {showVisibilityToggle && (
        <label className="flex items-center gap-2.5 text-sm font-medium text-slate-700 cursor-pointer pt-1">
          <input
            type="checkbox"
            checked={value.mostrar_endereco}
            onChange={(e) => handleFieldChange('mostrar_endereco', e.target.checked)}
            className="w-4 h-4 accent-emerald-700 rounded"
          />
          <span>Mostrar endereço no cardápio</span>
        </label>
      )}
    </div>
  );
}
