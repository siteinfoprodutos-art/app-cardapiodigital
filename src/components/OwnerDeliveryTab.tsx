import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  Compass,
  Layers,
  ListPlus,
  Loader2,
  MapPin,
  Navigation,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  fetchNearbyCitiesOverpass,
  fetchNearbyNeighborhoodsOverpass,
} from '../lib/geo';
import { supabase, translateSupabaseError } from '../lib/supabase';
import {
  type BairroEntrega,
  type Estabelecimento,
  formatAreaLabel,
  formatBRL,
  getAreaBairroNome,
  getAreaCidade,
  type ModoEntrega,
} from '../types/menu';

interface OwnerDeliveryTabProps {
  estabelecimento: Estabelecimento;
  bairros: BairroEntrega[];
  delAceitaEntrega: boolean;
  setDelAceitaEntrega: (val: boolean | ((prev: boolean) => boolean)) => void;
  delAceitaRetirada: boolean;
  setDelAceitaRetirada: (val: boolean | ((prev: boolean) => boolean)) => void;
  delModo: ModoEntrega;
  setDelModo: (val: ModoEntrega) => void;
  delTaxaFixa: string;
  setDelTaxaFixa: (val: string) => void;
  delFreteGratis: string;
  setDelFreteGratis: (val: string) => void;
  delPedidoMinimo: string;
  setDelPedidoMinimo: (val: string) => void;
  delTempoEstimado: string;
  setDelTempoEstimado: (val: string) => void;
  delSaving: boolean;
  onSaveDelivery: (e: React.FormEvent) => Promise<void>;
  onBairrosChange: (updater: (prev: BairroEntrega[]) => BairroEntrega[]) => void;
  onNotify: (type: 'ok' | 'err', text: string) => void;
  onOpenConfigTab?: () => void;
}

function parseNonNegativeMoney(raw: string): number | null {
  const cleaned = raw.trim();
  if (!cleaned) return null;
  const num = Number(cleaned.replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(num) || num < 0) return NaN;
  return num;
}

function formatMoneyInput(val?: number | null): string {
  if (val === null || val === undefined || !Number.isFinite(Number(val))) return '';
  return Number(val).toFixed(2).replace('.', ',');
}

function normalizeKey(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

interface ParsedBatchLine {
  lineNumber: number;
  raw: string;
  cidade: string;
  bairroNome: string;
  label: string;
  taxa: number;
  error: string | null;
}

interface SuggestedAreaRow {
  key: string;
  kind: 'bairro' | 'cidade_inteira';
  selected: boolean;
  bairroNome: string;
  cidade: string;
  distanciaKm: number;
  taxaInput: string;
}

export function OwnerDeliveryTab({
  estabelecimento,
  bairros,
  delAceitaEntrega,
  setDelAceitaEntrega,
  delAceitaRetirada,
  setDelAceitaRetirada,
  delModo,
  setDelModo,
  delTaxaFixa,
  setDelTaxaFixa,
  delFreteGratis,
  setDelFreteGratis,
  delPedidoMinimo,
  setDelPedidoMinimo,
  delTempoEstimado,
  setDelTempoEstimado,
  delSaving,
  onSaveDelivery,
  onBairrosChange,
  onNotify,
  onOpenConfigTab,
}: OwnerDeliveryTabProps) {
  // Formulário individual (Cidade, Bairro, Taxa)
  const [newCidade, setNewCidade] = useState(estabelecimento.cidade || '');
  const [newBairroNome, setNewBairroNome] = useState('');
  const [newTaxa, setNewTaxa] = useState('');
  const [addingArea, setAddingArea] = useState(false);

  // Busca & Edição inline
  const [searchQuery, setSearchQuery] = useState('');
  const [inlineFeeId, setInlineFeeId] = useState<string | null>(null);
  const [inlineFeeValue, setInlineFeeValue] = useState('');
  const [savingInlineId, setSavingInlineId] = useState<string | null>(null);

  // Edição completa na linha
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCidade, setEditCidade] = useState('');
  const [editBairroNome, setEditBairroNome] = useState('');
  const [editTaxa, setEditTaxa] = useState('');

  // Exclusão com confirmação inline
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Lote ("Adicionar vários de uma vez")
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchText, setBatchText] = useState('');
  const [batchSaving, setBatchSaving] = useState(false);

  // Aplicar mesmo valor à cidade inteira
  const [bulkCity, setBulkCity] = useState('');
  const [bulkCityFee, setBulkCityFee] = useState('');
  const [bulkCitySaving, setBulkCitySaving] = useState(false);

  // Sugestões Overpass (bairros próximos e cidades vizinhas)
  const [radiusKm, setRadiusKm] = useState<3 | 5 | 8 | 10>(5);
  const [suggestedBairros, setSuggestedBairros] = useState<SuggestedAreaRow[]>([]);
  const [suggestedCidades, setSuggestedCidades] = useState<SuggestedAreaRow[]>([]);
  const [overpassLoading, setOverpassLoading] = useState<'bairros' | 'cidades' | null>(null);
  const [overpassError, setOverpassError] = useState<string | null>(null);
  const [lastOverpassAction, setLastOverpassAction] = useState<'bairros' | 'cidades' | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [hasSearchedBairros, setHasSearchedBairros] = useState(false);
  const [hasSearchedCidades, setHasSearchedCidades] = useState(false);
  const [savingSuggestions, setSavingSuggestions] = useState(false);

  // Faixas de distância
  const [tier0to2, setTier0to2] = useState('');
  const [tier2to5, setTier2to5] = useState('');
  const [tierAbove5, setTierAbove5] = useState('');

  const manualCidadeInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = setInterval(() => {
      setCooldownSeconds((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldownSeconds]);

  useEffect(() => {
    if (!newCidade && estabelecimento.cidade) {
      setNewCidade(estabelecimento.cidade);
    }
  }, [estabelecimento.cidade, newCidade]);

  const existingLabelsSet = useMemo(() => {
    const set = new Set<string>();
    for (const b of bairros) {
      set.add(normalizeKey(b.bairro));
      const c = getAreaCidade(b);
      const bn = getAreaBairroNome(b);
      set.add(normalizeKey(formatAreaLabel(c, bn)));
    }
    return set;
  }, [bairros]);

  const citiesList = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of bairros) {
      const c = getAreaCidade(b);
      const key = normalizeKey(c);
      if (c && !map.has(key)) {
        map.set(key, c);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [bairros]);

  const groupedByCity = useMemo(() => {
    const q = normalizeKey(searchQuery);
    const groups = new Map<string, { cidade: string; areas: BairroEntrega[] }>();

    for (const b of bairros) {
      const cidade = getAreaCidade(b);
      const bairroNome = getAreaBairroNome(b);
      if (q) {
        const matches =
          normalizeKey(b.bairro).includes(q) ||
          normalizeKey(cidade).includes(q) ||
          normalizeKey(bairroNome).includes(q);
        if (!matches) continue;
      }
      const key = normalizeKey(cidade);
      if (!groups.has(key)) {
        groups.set(key, { cidade, areas: [] });
      }
      groups.get(key)!.areas.push(b);
    }

    const sortedGroups = Array.from(groups.values()).sort((a, b) =>
      a.cidade.localeCompare(b.cidade, 'pt-BR')
    );

    for (const g of sortedGroups) {
      g.areas.sort((a, b) => {
        const bnA = getAreaBairroNome(a);
        const bnB = getAreaBairroNome(b);
        if (!bnA && bnB) return -1;
        if (bnA && !bnB) return 1;
        return bnA.localeCompare(bnB, 'pt-BR');
      });
    }

    return sortedGroups;
  }, [bairros, searchQuery]);

  const previewNewLabel = useMemo(() => {
    if (!newCidade.trim()) return '';
    return formatAreaLabel(newCidade, newBairroNome);
  }, [newCidade, newBairroNome]);

  const parsedBatchLines = useMemo<ParsedBatchLine[]>(() => {
    const rawLines = batchText.split(/\r?\n/);
    const seenInBatch = new Set<string>();
    const results: ParsedBatchLine[] = [];

    rawLines.forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      const parts = trimmed.split(';');
      if (parts.length !== 3) {
        results.push({
          lineNumber: index + 1,
          raw: trimmed,
          cidade: '',
          bairroNome: '',
          label: trimmed,
          taxa: 0,
          error: 'Use o formato "Bairro;Cidade;Valor" (ex.: Centro;Jundiaí;7,50).',
        });
        return;
      }

      const bairroNome = parts[0].trim();
      const cidade = parts[1].trim();
      const valorRaw = parts[2].trim();

      if (!cidade) {
        results.push({
          lineNumber: index + 1,
          raw: trimmed,
          cidade: '',
          bairroNome,
          label: trimmed,
          taxa: 0,
          error: 'Cidade obrigatória.',
        });
        return;
      }

      const taxaVal = parseNonNegativeMoney(valorRaw);
      if (taxaVal === null || Number.isNaN(taxaVal) || taxaVal < 0) {
        results.push({
          lineNumber: index + 1,
          raw: trimmed,
          cidade,
          bairroNome,
          label: formatAreaLabel(cidade, bairroNome),
          taxa: 0,
          error: 'Valor inválido (use número >= 0, ex.: 7,50 ou 0).',
        });
        return;
      }

      const label = formatAreaLabel(cidade, bairroNome);
      const labelKey = normalizeKey(label);

      if (existingLabelsSet.has(labelKey)) {
        results.push({
          lineNumber: index + 1,
          raw: trimmed,
          cidade,
          bairroNome,
          label,
          taxa: taxaVal,
          error: 'Área já cadastrada.',
        });
        return;
      }

      if (seenInBatch.has(labelKey)) {
        results.push({
          lineNumber: index + 1,
          raw: trimmed,
          cidade,
          bairroNome,
          label,
          taxa: taxaVal,
          error: 'Linha duplicada nesta lista.',
        });
        return;
      }

      seenInBatch.add(labelKey);
      results.push({
        lineNumber: index + 1,
        raw: trimmed,
        cidade,
        bairroNome,
        label,
        taxa: taxaVal,
        error: null,
      });
    });

    return results;
  }, [batchText, existingLabelsSet]);

  const validBatchItems = useMemo(
    () => parsedBatchLines.filter((item) => !item.error),
    [parsedBatchLines]
  );

  const handleAddSingleArea = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;

    const cleanCidade = newCidade.trim();
    const cleanBairroNome = newBairroNome.trim();
    const taxaVal = parseNonNegativeMoney(newTaxa);

    if (!cleanCidade) {
      onNotify('err', 'Informe a cidade para cadastrar a área de entrega.');
      return;
    }
    if (taxaVal === null || Number.isNaN(taxaVal) || taxaVal < 0) {
      onNotify('err', 'Informe uma taxa válida maior ou igual a 0 (ex: 7,50 ou 0).');
      return;
    }

    const label = formatAreaLabel(cleanCidade, cleanBairroNome);
    if (existingLabelsSet.has(normalizeKey(label))) {
      onNotify('err', `A área "${label}" já está cadastrada.`);
      return;
    }

    setAddingArea(true);
    try {
      const { data, error } = await supabase
        .from('bairros_entrega')
        .insert({
          estabelecimento_id: estabelecimento.id,
          bairro: label,
          cidade: cleanCidade,
          bairro_nome: cleanBairroNome || null,
          taxa: taxaVal,
        })
        .select('*')
        .single();

      if (error) throw error;

      const inserted = data as BairroEntrega;
      onBairrosChange((prev) => [
        ...prev,
        { ...inserted, taxa: Number(inserted.taxa) || 0 },
      ]);
      setNewBairroNome('');
      setNewTaxa('');
      onNotify('ok', `Área "${label}" adicionada com sucesso!`);
    } catch (err) {
      console.error('Erro ao adicionar área de entrega:', err);
      onNotify('err', translateSupabaseError(err, 'Erro ao adicionar área de entrega.'));
    } finally {
      setAddingArea(false);
    }
  };

  const handleSaveInlineFee = async (area: BairroEntrega) => {
    if (!supabase) return;
    const taxaVal = parseNonNegativeMoney(inlineFeeValue);
    if (taxaVal === null || Number.isNaN(taxaVal) || taxaVal < 0) {
      onNotify('err', 'Informe uma taxa válida (>= 0).');
      return;
    }

    setSavingInlineId(area.id);
    try {
      const { data, error } = await supabase
        .from('bairros_entrega')
        .update({ taxa: taxaVal })
        .eq('id', area.id)
        .select('*')
        .single();

      if (error) throw error;

      const updated = data as BairroEntrega;
      onBairrosChange((prev) =>
        prev.map((item) =>
          item.id === area.id ? { ...updated, taxa: Number(updated.taxa) || 0 } : item
        )
      );
      setInlineFeeId(null);
      onNotify('ok', `Taxa de "${area.bairro}" atualizada.`);
    } catch (err) {
      console.error('Erro ao atualizar taxa inline:', err);
      onNotify('err', translateSupabaseError(err, 'Erro ao atualizar taxa.'));
    } finally {
      setSavingInlineId(null);
    }
  };

  const handleSaveFullEdit = async (area: BairroEntrega) => {
    if (!supabase) return;

    const cleanCidade = editCidade.trim();
    const cleanBairroNome = editBairroNome.trim();
    const taxaVal = parseNonNegativeMoney(editTaxa);

    if (!cleanCidade) {
      onNotify('err', 'A cidade é obrigatória.');
      return;
    }
    if (taxaVal === null || Number.isNaN(taxaVal) || taxaVal < 0) {
      onNotify('err', 'Informe uma taxa válida (>= 0).');
      return;
    }

    const nextLabel = formatAreaLabel(cleanCidade, cleanBairroNome);
    const duplicateExists = bairros.some(
      (b) =>
        b.id !== area.id &&
        normalizeKey(b.bairro) === normalizeKey(nextLabel)
    );
    if (duplicateExists) {
      onNotify('err', `Já existe outra área cadastrada como "${nextLabel}".`);
      return;
    }

    setSavingInlineId(area.id);
    try {
      const { data, error } = await supabase
        .from('bairros_entrega')
        .update({
          bairro: nextLabel,
          cidade: cleanCidade,
          bairro_nome: cleanBairroNome || null,
          taxa: taxaVal,
        })
        .eq('id', area.id)
        .select('*')
        .single();

      if (error) throw error;

      const updated = data as BairroEntrega;
      onBairrosChange((prev) =>
        prev.map((item) =>
          item.id === area.id ? { ...updated, taxa: Number(updated.taxa) || 0 } : item
        )
      );
      setEditingId(null);
      onNotify('ok', 'Área de entrega atualizada.');
    } catch (err) {
      console.error('Erro ao editar área de entrega:', err);
      onNotify('err', translateSupabaseError(err, 'Erro ao editar área de entrega.'));
    } finally {
      setSavingInlineId(null);
    }
  };

  const handleDeleteArea = async (area: BairroEntrega) => {
    if (!supabase) return;
    setSavingInlineId(area.id);
    try {
      const { error } = await supabase
        .from('bairros_entrega')
        .delete()
        .eq('id', area.id);

      if (error) throw error;

      onBairrosChange((prev) => prev.filter((item) => item.id !== area.id));
      setConfirmDeleteId(null);
      onNotify('ok', `Área "${area.bairro}" removida.`);
    } catch (err) {
      console.error('Erro ao excluir área de entrega:', err);
      onNotify('err', translateSupabaseError(err, 'Erro ao excluir área de entrega.'));
    } finally {
      setSavingInlineId(null);
    }
  };

  const handleBatchInsert = async () => {
    if (!supabase || validBatchItems.length === 0) return;

    setBatchSaving(true);
    try {
      const rowsToInsert = validBatchItems.map((item) => ({
        estabelecimento_id: estabelecimento.id,
        bairro: item.label,
        cidade: item.cidade,
        bairro_nome: item.bairroNome || null,
        taxa: item.taxa,
      }));

      const { data, error } = await supabase
        .from('bairros_entrega')
        .insert(rowsToInsert)
        .select('*');

      if (error) throw error;

      const insertedRows = ((data || []) as BairroEntrega[]).map((r) => ({
        ...r,
        taxa: Number(r.taxa) || 0,
      }));

      onBairrosChange((prev) => [...prev, ...insertedRows]);
      setBatchText('');
      setBatchOpen(false);
      onNotify(
        'ok',
        `${insertedRows.length} ${
          insertedRows.length === 1 ? 'área adicionada' : 'áreas adicionadas'
        } com sucesso!`
      );
    } catch (err) {
      console.error('Erro ao adicionar áreas em lote:', err);
      onNotify('err', translateSupabaseError(err, 'Erro ao salvar áreas em lote.'));
    } finally {
      setBatchSaving(false);
    }
  };

  const handleApplyCityRate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;

    const targetCity = bulkCity || citiesList[0] || '';
    if (!targetCity) {
      onNotify('err', 'Selecione uma cidade.');
      return;
    }

    const taxaVal = parseNonNegativeMoney(bulkCityFee);
    if (taxaVal === null || Number.isNaN(taxaVal) || taxaVal < 0) {
      onNotify('err', 'Informe um valor válido >= 0 para aplicar à cidade.');
      return;
    }

    const cityAreaIds = bairros
      .filter((b) => normalizeKey(getAreaCidade(b)) === normalizeKey(targetCity))
      .map((b) => b.id);

    if (cityAreaIds.length === 0) {
      onNotify('err', 'Nenhuma área encontrada para esta cidade.');
      return;
    }

    setBulkCitySaving(true);
    try {
      const { data, error } = await supabase
        .from('bairros_entrega')
        .update({ taxa: taxaVal })
        .in('id', cityAreaIds)
        .select('*');

      if (error) throw error;

      const updatedMap = new Map(
        ((data || []) as BairroEntrega[]).map((r) => [
          r.id,
          { ...r, taxa: Number(r.taxa) || 0 },
        ])
      );

      onBairrosChange((prev) =>
        prev.map((item) => updatedMap.get(item.id) || item)
      );
      setBulkCityFee('');
      onNotify(
        'ok',
        `Taxa de ${formatBRL(taxaVal)} aplicada a ${cityAreaIds.length} ${
          cityAreaIds.length === 1 ? 'área' : 'áreas'
        } de ${targetCity}.`
      );
    } catch (err) {
      console.error('Erro ao aplicar taxa por cidade:', err);
      onNotify('err', translateSupabaseError(err, 'Erro ao atualizar taxas da cidade.'));
    } finally {
      setBulkCitySaving(false);
    }
  };

  const storeLat =
    estabelecimento.latitude !== null && estabelecimento.latitude !== undefined
      ? Number(estabelecimento.latitude)
      : null;
  const storeLon =
    estabelecimento.longitude !== null && estabelecimento.longitude !== undefined
      ? Number(estabelecimento.longitude)
      : null;
  const hasStoreCoords =
    storeLat !== null &&
    storeLon !== null &&
    Number.isFinite(storeLat) &&
    Number.isFinite(storeLon) &&
    !(storeLat === 0 && storeLon === 0);

  const focusManualForm = () => {
    manualCidadeInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => manualCidadeInputRef.current?.focus(), 250);
  };

  const handleSearchNearbyBairros = async (bypassCache = false) => {
    if (!hasStoreCoords || storeLat === null || storeLon === null) return;
    if (overpassLoading || cooldownSeconds > 0) return;

    setOverpassLoading('bairros');
    setLastOverpassAction('bairros');
    setOverpassError(null);
    setCooldownSeconds(10);

    try {
      const results = await fetchNearbyNeighborhoodsOverpass(storeLat, storeLon, radiusKm, {
        bypassCache,
      });
      const defaultCity = (estabelecimento.cidade || '').trim();
      const rows: SuggestedAreaRow[] = results.map((item) => {
        const label = formatAreaLabel(defaultCity, item.name);
        const alreadyExists =
          Boolean(defaultCity) && existingLabelsSet.has(normalizeKey(label));
        return {
          key: `bairro:${normalizeKey(item.name)}`,
          kind: 'bairro',
          selected: !alreadyExists,
          bairroNome: item.name,
          cidade: defaultCity,
          distanciaKm: item.distanciaKm,
          taxaInput: '0,00',
        };
      });
      setSuggestedBairros(rows);
      setHasSearchedBairros(true);
    } catch (err) {
      setOverpassError(
        err instanceof Error
          ? err.message
          : 'Erro ao buscar bairros próximos. Tente de novo ou cadastre manualmente.'
      );
    } finally {
      setOverpassLoading(null);
    }
  };

  const handleSearchNearbyCities = async (bypassCache = false) => {
    if (!hasStoreCoords || storeLat === null || storeLon === null) return;
    if (overpassLoading || cooldownSeconds > 0) return;

    setOverpassLoading('cidades');
    setLastOverpassAction('cidades');
    setOverpassError(null);
    setCooldownSeconds(10);

    try {
      const results = await fetchNearbyCitiesOverpass(storeLat, storeLon, 30, {
        bypassCache,
      });
      const rows: SuggestedAreaRow[] = results.map((item) => {
        const label = formatAreaLabel(item.name, '');
        const alreadyExists = existingLabelsSet.has(normalizeKey(label));
        return {
          key: `cidade:${normalizeKey(item.name)}`,
          kind: 'cidade_inteira',
          selected: !alreadyExists,
          bairroNome: '',
          cidade: item.name,
          distanciaKm: item.distanciaKm,
          taxaInput: '0,00',
        };
      });
      setSuggestedCidades(rows);
      setHasSearchedCidades(true);
    } catch (err) {
      setOverpassError(
        err instanceof Error
          ? err.message
          : 'Erro ao buscar cidades vizinhas. Tente de novo ou cadastre manualmente.'
      );
    } finally {
      setOverpassLoading(null);
    }
  };

  const handleApplyDistanceTiers = () => {
    const val0to2 = tier0to2.trim() ? parseNonNegativeMoney(tier0to2) : null;
    const val2to5 = tier2to5.trim() ? parseNonNegativeMoney(tier2to5) : null;
    const valAbove5 = tierAbove5.trim() ? parseNonNegativeMoney(tierAbove5) : null;

    if (
      (tier0to2.trim() && (val0to2 === null || Number.isNaN(val0to2) || val0to2 < 0)) ||
      (tier2to5.trim() && (val2to5 === null || Number.isNaN(val2to5) || val2to5 < 0)) ||
      (tierAbove5.trim() && (valAbove5 === null || Number.isNaN(valAbove5) || valAbove5 < 0))
    ) {
      onNotify('err', 'Informe valores válidos (>= 0) nas faixas de distância.');
      return;
    }

    if (val0to2 === null && val2to5 === null && valAbove5 === null) {
      onNotify('err', 'Preencha pelo menos uma faixa de distância para aplicar.');
      return;
    }

    setSuggestedBairros((prev) =>
      prev.map((row) => {
        if (row.distanciaKm <= 2 && val0to2 !== null) {
          return { ...row, taxaInput: formatMoneyInput(val0to2) };
        }
        if (row.distanciaKm > 2 && row.distanciaKm <= 5 && val2to5 !== null) {
          return { ...row, taxaInput: formatMoneyInput(val2to5) };
        }
        if (row.distanciaKm > 5 && valAbove5 !== null) {
          return { ...row, taxaInput: formatMoneyInput(valAbove5) };
        }
        return row;
      })
    );
    onNotify('ok', 'Taxas preenchidas conforme a distância de cada bairro!');
  };

  const allSuggestions = useMemo(
    () => [...suggestedBairros, ...suggestedCidades],
    [suggestedBairros, suggestedCidades]
  );

  const selectedSuggestionsCount = useMemo(() => {
    let count = 0;
    for (const row of allSuggestions) {
      if (!row.selected) continue;
      const label = formatAreaLabel(row.cidade, row.bairroNome);
      if (row.cidade.trim() && existingLabelsSet.has(normalizeKey(label))) continue;
      count++;
    }
    return count;
  }, [allSuggestions, existingLabelsSet]);

  const handleAddSelectedSuggestions = async () => {
    if (!supabase) return;

    const chosen = allSuggestions.filter((row) => row.selected);
    if (chosen.length === 0) {
      onNotify('err', 'Selecione pelo menos uma área sugerida para adicionar.');
      return;
    }

    const toInsert: Array<{
      estabelecimento_id: string;
      bairro: string;
      cidade: string;
      bairro_nome: string | null;
      taxa: number;
      distancia_km: number;
    }> = [];
    const seenBatch = new Set<string>();
    let ignoredExistingCount = 0;

    for (const row of chosen) {
      const cleanCidade = row.cidade.trim();
      const cleanBairro = row.bairroNome.trim();

      if (!cleanCidade) {
        onNotify(
          'err',
          `Informe a cidade para "${cleanBairro || 'área selecionada'}" antes de salvar.`
        );
        return;
      }

      const taxaVal = parseNonNegativeMoney(row.taxaInput);
      if (taxaVal === null || Number.isNaN(taxaVal) || taxaVal < 0) {
        onNotify(
          'err',
          `Taxa inválida para "${formatAreaLabel(cleanCidade, cleanBairro)}". Use número >= 0.`
        );
        return;
      }

      const label = formatAreaLabel(cleanCidade, cleanBairro);
      const key = normalizeKey(label);

      if (existingLabelsSet.has(key) || seenBatch.has(key)) {
        ignoredExistingCount++;
        continue;
      }

      seenBatch.add(key);
      toInsert.push({
        estabelecimento_id: estabelecimento.id,
        bairro: label,
        cidade: cleanCidade,
        bairro_nome: cleanBairro || null,
        taxa: taxaVal,
        distancia_km: row.distanciaKm,
      });
    }

    if (toInsert.length === 0) {
      onNotify(
        'ok',
        'Todas as áreas selecionadas já estavam cadastradas na sua lista.'
      );
      return;
    }

    setSavingSuggestions(true);
    try {
      const { data, error } = await supabase
        .from('bairros_entrega')
        .insert(toInsert)
        .select('*');

      if (error) throw error;

      const insertedRows = ((data || []) as BairroEntrega[]).map((r) => ({
        ...r,
        taxa: Number(r.taxa) || 0,
      }));

      onBairrosChange((prev) => [...prev, ...insertedRows]);

      setSuggestedBairros((prev) =>
        prev.map((row) =>
          seenBatch.has(normalizeKey(formatAreaLabel(row.cidade, row.bairroNome)))
            ? { ...row, selected: false }
            : row
        )
      );
      setSuggestedCidades((prev) =>
        prev.map((row) =>
          seenBatch.has(normalizeKey(formatAreaLabel(row.cidade, row.bairroNome)))
            ? { ...row, selected: false }
            : row
        )
      );

      const extraMsg =
        ignoredExistingCount > 0
          ? ` (${ignoredExistingCount} já cadastrada${ignoredExistingCount === 1 ? '' : 's'} ignorada${ignoredExistingCount === 1 ? '' : 's'})`
          : '';
      onNotify(
        'ok',
        `${insertedRows.length} ${
          insertedRows.length === 1 ? 'área adicionada' : 'áreas adicionadas'
        } com sucesso!${extraMsg}`
      );
    } catch (err) {
      console.error('Erro ao salvar áreas sugeridas:', err);
      onNotify(
        'err',
        translateSupabaseError(err, 'Erro ao adicionar áreas selecionadas.')
      );
    } finally {
      setSavingSuggestions(false);
    }
  };

  return (
    <div className="max-w-4xl space-y-6">
      {/* Formulário principal de configurações de entrega */}
      <form
        onSubmit={onSaveDelivery}
        className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6 shadow-xs"
      >
        <div>
          <h1 className="text-xl font-bold text-slate-900">Entrega e Retirada</h1>
          <p className="text-sm text-slate-600 mt-1">
            Configure modalidades aceitas, taxa única ou por cidade e bairro, frete grátis, pedido mínimo e tempo estimado.
          </p>
        </div>

        {/* Interruptores: Aceito entrega / Aceito retirada */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={delAceitaEntrega}
            onClick={() => setDelAceitaEntrega((v) => !v)}
            className={`min-h-[56px] px-4 py-3 rounded-xl border flex items-center justify-between gap-3 transition-colors ${
              delAceitaEntrega
                ? 'border-emerald-600 bg-emerald-50/50 text-slate-900'
                : 'border-slate-200 bg-slate-50 text-slate-600'
            }`}
          >
            <span className="text-sm font-semibold">Aceito entrega</span>
            <span
              className={`w-11 h-6 rounded-full p-0.5 transition-colors flex items-center ${
                delAceitaEntrega ? 'bg-emerald-600 justify-end' : 'bg-slate-300 justify-start'
              }`}
            >
              <span className="w-5 h-5 rounded-full bg-white shadow-xs" />
            </span>
          </button>

          <button
            type="button"
            role="switch"
            aria-checked={delAceitaRetirada}
            onClick={() => setDelAceitaRetirada((v) => !v)}
            className={`min-h-[56px] px-4 py-3 rounded-xl border flex items-center justify-between gap-3 transition-colors ${
              delAceitaRetirada
                ? 'border-emerald-600 bg-emerald-50/50 text-slate-900'
                : 'border-slate-200 bg-slate-50 text-slate-600'
            }`}
          >
            <span className="text-sm font-semibold">Aceito retirada</span>
            <span
              className={`w-11 h-6 rounded-full p-0.5 transition-colors flex items-center ${
                delAceitaRetirada ? 'bg-emerald-600 justify-end' : 'bg-slate-300 justify-start'
              }`}
            >
              <span className="w-5 h-5 rounded-full bg-white shadow-xs" />
            </span>
          </button>
        </div>

        {!delAceitaEntrega && !delAceitaRetirada && (
          <p className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3">
            Atenção: com ambas opções desativadas, os clientes não conseguirão enviar pedidos pelo cardápio.
          </p>
        )}

        {/* Seletor de modo */}
        <div className="space-y-3 pt-2 border-t border-slate-100">
          <span className="block text-xs font-semibold text-slate-700">
            Modo de cobrança da entrega
          </span>
          <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-xl">
            <button
              type="button"
              onClick={() => setDelModo('fixa')}
              className={`min-h-[42px] rounded-lg text-xs sm:text-sm font-semibold transition-colors ${
                delModo === 'fixa'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Taxa única
            </button>
            <button
              type="button"
              onClick={() => setDelModo('bairro')}
              className={`min-h-[42px] rounded-lg text-xs sm:text-sm font-semibold transition-colors ${
                delModo === 'bairro'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Por cidade e bairro
            </button>
          </div>

          {delModo === 'fixa' && (
            <div>
              <label htmlFor="del-taxa-fixa" className="block text-xs font-semibold text-slate-700 mb-1">
                Taxa única de entrega (R$)
              </label>
              <input
                id="del-taxa-fixa"
                type="text"
                value={delTaxaFixa}
                onChange={(e) => setDelTaxaFixa(e.target.value)}
                placeholder="6,00"
                className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 text-sm tabular-nums"
              />
            </div>
          )}
        </div>

        {/* Frete grátis, Pedido mínimo, Tempo estimado */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-slate-100">
          <div>
            <label htmlFor="del-frete-gratis" className="block text-xs font-semibold text-slate-700 mb-1">
              Frete grátis acima de (R$)
            </label>
            <input
              id="del-frete-gratis"
              type="text"
              value={delFreteGratis}
              onChange={(e) => setDelFreteGratis(e.target.value)}
              placeholder="Opcional (ex: 80,00)"
              className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 text-sm tabular-nums"
            />
          </div>

          <div>
            <label htmlFor="del-pedido-min" className="block text-xs font-semibold text-slate-700 mb-1">
              Pedido mínimo (R$)
            </label>
            <input
              id="del-pedido-min"
              type="text"
              value={delPedidoMinimo}
              onChange={(e) => setDelPedidoMinimo(e.target.value)}
              placeholder="Opcional (ex: 25,00)"
              className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 text-sm tabular-nums"
            />
          </div>

          <div>
            <label htmlFor="del-tempo" className="block text-xs font-semibold text-slate-700 mb-1">
              Tempo estimado
            </label>
            <input
              id="del-tempo"
              type="text"
              value={delTempoEstimado}
              onChange={(e) => setDelTempoEstimado(e.target.value)}
              placeholder="Ex: 40–50 min"
              className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 text-sm"
            />
          </div>
        </div>

        <div className="pt-2">
          <button
            type="submit"
            disabled={delSaving}
            className="min-h-[48px] px-6 py-2.5 rounded-xl bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 text-sm font-bold shadow-xs"
          >
            {delSaving ? 'Salvando...' : 'Salvar configurações de entrega'}
          </button>
        </div>
      </form>

      {/* Modo "Por cidade e bairro" */}
      {delModo === 'bairro' && (
        <div className="space-y-6">
          {/* Sugestão automática de bairros próximos e cidades vizinhas */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-5 shadow-xs">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <Compass className="w-5 h-5 text-emerald-700 shrink-0" />
                  <span>Sugestões de Bairros e Cidades Próximas</span>
                </h2>
                <p className="text-xs sm:text-sm text-slate-600 mt-1">
                  Sugestões automáticas baseadas no OpenStreetMap. Confira a lista e adicione manualmente o que faltar.
                </p>
              </div>
            </div>

            {!hasStoreCoords ? (
              <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-900 leading-relaxed">
                    Para buscar bairros próximos automaticamente, cadastre e confirme o endereço do estabelecimento (CEP / coordenadas) na aba{' '}
                    <strong>Dados da loja</strong>.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {onOpenConfigTab && (
                    <button
                      type="button"
                      onClick={onOpenConfigTab}
                      className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-amber-900 text-white hover:bg-amber-950 text-xs font-bold whitespace-nowrap"
                    >
                      Ir para Dados da loja
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={focusManualForm}
                    className="min-h-[38px] px-3.5 py-1.5 rounded-xl border border-amber-300 bg-white text-amber-900 hover:bg-amber-100 text-xs font-bold whitespace-nowrap"
                  >
                    Cadastrar manualmente
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-end gap-2.5">
                  <div>
                    <label
                      htmlFor="overpass-radius"
                      className="block text-xs font-semibold text-slate-700 mb-1"
                    >
                      Raio de busca
                    </label>
                    <select
                      id="overpass-radius"
                      value={radiusKm}
                      onChange={(e) => setRadiusKm(Number(e.target.value) as 3 | 5 | 8 | 10)}
                      className="min-h-[42px] px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs sm:text-sm font-medium"
                    >
                      <option value={3}>3 km</option>
                      <option value={5}>5 km</option>
                      <option value={8}>8 km</option>
                      <option value={10}>10 km</option>
                    </select>
                  </div>

                  <button
                    type="button"
                    disabled={overpassLoading !== null || cooldownSeconds > 0}
                    onClick={() => handleSearchNearbyBairros(false)}
                    className="min-h-[42px] px-4 py-2 rounded-xl bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 text-xs sm:text-sm font-bold inline-flex items-center gap-2"
                  >
                    {overpassLoading === 'bairros' ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Navigation className="w-4 h-4" />
                    )}
                    <span>
                      {overpassLoading === 'bairros'
                        ? 'Buscando bairros...'
                        : cooldownSeconds > 0
                        ? `Buscar bairros próximos (${cooldownSeconds}s)`
                        : 'Buscar bairros próximos'}
                    </span>
                  </button>

                  <button
                    type="button"
                    disabled={overpassLoading !== null || cooldownSeconds > 0}
                    onClick={() => handleSearchNearbyCities(false)}
                    className="min-h-[42px] px-4 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-800 text-xs sm:text-sm font-bold inline-flex items-center gap-2"
                  >
                    {overpassLoading === 'cidades' ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <MapPin className="w-4 h-4 text-emerald-700" />
                    )}
                    <span>
                      {overpassLoading === 'cidades'
                        ? 'Buscando cidades...'
                        : cooldownSeconds > 0
                        ? `Buscar cidades vizinhas (${cooldownSeconds}s)`
                        : 'Buscar cidades vizinhas (30 km)'}
                    </span>
                  </button>
                </div>

                {overpassError && (
                  <div
                    role="alert"
                    className="p-4 rounded-2xl bg-rose-50 border border-rose-200 space-y-3"
                  >
                    <p className="text-xs sm:text-sm font-semibold text-rose-900">
                      {overpassError}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={overpassLoading !== null || cooldownSeconds > 0}
                        onClick={() =>
                          lastOverpassAction === 'cidades'
                            ? handleSearchNearbyCities(true)
                            : handleSearchNearbyBairros(true)
                        }
                        className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-rose-700 text-white hover:bg-rose-800 disabled:opacity-50 text-xs font-bold inline-flex items-center gap-1.5"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>
                          {cooldownSeconds > 0
                            ? `Tentar de novo (${cooldownSeconds}s)`
                            : 'Tentar de novo'}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={focusManualForm}
                        className="min-h-[38px] px-3.5 py-1.5 rounded-xl border border-rose-300 bg-white text-rose-900 hover:bg-rose-100 text-xs font-bold"
                      >
                        Ir para cadastro manual
                      </button>
                    </div>
                  </div>
                )}

                {hasSearchedBairros && suggestedBairros.length === 0 && !overpassError && (
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 flex flex-wrap items-center justify-between gap-2">
                    <span>
                      Nenhum bairro encontrado no OpenStreetMap neste raio de {radiusKm} km. Tente aumentar o raio ou cadastre manualmente.
                    </span>
                    <button
                      type="button"
                      onClick={focusManualForm}
                      className="font-bold text-slate-900 underline"
                    >
                      Cadastrar manualmente
                    </button>
                  </div>
                )}

                {suggestedBairros.length > 0 && (
                  <div className="space-y-4 pt-2 border-t border-slate-100">
                    {/* Aplicar faixas de distância */}
                    <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
                      <span className="block text-xs font-bold text-slate-800">
                        Aplicar faixas de distância nos bairros sugeridos
                      </span>
                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 items-end">
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                            0–2 km (R$)
                          </label>
                          <input
                            type="text"
                            value={tier0to2}
                            onChange={(e) => setTier0to2(e.target.value)}
                            placeholder="5,00"
                            className="w-full min-h-[38px] px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs tabular-nums"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                            2–5 km (R$)
                          </label>
                          <input
                            type="text"
                            value={tier2to5}
                            onChange={(e) => setTier2to5(e.target.value)}
                            placeholder="8,00"
                            className="w-full min-h-[38px] px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs tabular-nums"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                            Acima de 5 km (R$)
                          </label>
                          <input
                            type="text"
                            value={tierAbove5}
                            onChange={(e) => setTierAbove5(e.target.value)}
                            placeholder="12,00"
                            className="w-full min-h-[38px] px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs tabular-nums"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={handleApplyDistanceTiers}
                          className="min-h-[38px] px-4 py-1.5 rounded-xl bg-slate-900 text-white hover:bg-slate-800 text-xs font-bold"
                        >
                          Aplicar faixas
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-bold text-slate-800">
                        Bairros encontrados ({suggestedBairros.length})
                      </span>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() =>
                            setSuggestedBairros((prev) =>
                              prev.map((r) => ({
                                ...r,
                                selected: !(
                                  Boolean(r.cidade.trim()) &&
                                  existingLabelsSet.has(
                                    normalizeKey(formatAreaLabel(r.cidade, r.bairroNome))
                                  )
                                ),
                              }))
                            )
                          }
                          className="font-semibold text-emerald-700 hover:underline"
                        >
                          Selecionar novos
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setSuggestedBairros((prev) =>
                              prev.map((r) => ({ ...r, selected: false }))
                            )
                          }
                          className="font-semibold text-slate-500 hover:underline"
                        >
                          Desmarcar todos
                        </button>
                      </div>
                    </div>

                    <div className="max-h-80 overflow-auto border border-slate-200 rounded-2xl">
                      <table className="w-full text-left border-collapse text-xs sm:text-sm">
                        <thead className="bg-slate-50 sticky top-0 border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-500">
                          <tr>
                            <th className="py-2.5 px-3 w-10">Sel.</th>
                            <th className="py-2.5 px-3">Bairro</th>
                            <th className="py-2.5 px-3">Distância</th>
                            <th className="py-2.5 px-3">Cidade</th>
                            <th className="py-2.5 px-3">Taxa (R$)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {suggestedBairros.map((row) => {
                            const label = formatAreaLabel(row.cidade, row.bairroNome);
                            const alreadyExists =
                              Boolean(row.cidade.trim()) &&
                              existingLabelsSet.has(normalizeKey(label));
                            return (
                              <tr
                                key={row.key}
                                className={alreadyExists ? 'bg-slate-50/70 opacity-70' : ''}
                              >
                                <td className="py-2 px-3">
                                  <input
                                    type="checkbox"
                                    checked={row.selected && !alreadyExists}
                                    disabled={alreadyExists}
                                    onChange={(e) =>
                                      setSuggestedBairros((prev) =>
                                        prev.map((item) =>
                                          item.key === row.key
                                            ? { ...item, selected: e.target.checked }
                                            : item
                                        )
                                      )
                                    }
                                    aria-label={`Selecionar ${row.bairroNome}`}
                                    className="w-4 h-4 accent-emerald-700"
                                  />
                                </td>
                                <td className="py-2 px-3">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="font-semibold text-slate-900">
                                      {row.bairroNome}
                                    </span>
                                    {alreadyExists && (
                                      <span className="px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 text-[10px] font-bold">
                                        Já cadastrado
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="py-2 px-3 text-slate-600 tabular-nums whitespace-nowrap">
                                  {row.distanciaKm.toFixed(1).replace('.', ',')} km
                                </td>
                                <td className="py-2 px-3 min-w-[130px]">
                                  <input
                                    type="text"
                                    value={row.cidade}
                                    disabled={alreadyExists}
                                    onChange={(e) =>
                                      setSuggestedBairros((prev) =>
                                        prev.map((item) =>
                                          item.key === row.key
                                            ? { ...item, cidade: e.target.value }
                                            : item
                                        )
                                      )
                                    }
                                    placeholder="Cidade *"
                                    aria-label={`Cidade para ${row.bairroNome}`}
                                    className="w-full min-h-[34px] px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-xs"
                                  />
                                </td>
                                <td className="py-2 px-3 w-28">
                                  <input
                                    type="text"
                                    value={row.taxaInput}
                                    disabled={alreadyExists}
                                    onChange={(e) =>
                                      setSuggestedBairros((prev) =>
                                        prev.map((item) =>
                                          item.key === row.key
                                            ? { ...item, taxaInput: e.target.value }
                                            : item
                                        )
                                      )
                                    }
                                    placeholder="0,00"
                                    aria-label={`Taxa para ${row.bairroNome}`}
                                    className="w-24 min-h-[34px] px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-xs tabular-nums"
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {hasSearchedCidades && suggestedCidades.length === 0 && !overpassError && (
                  <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-3">
                    Nenhuma cidade vizinha encontrada no raio de 30 km.
                  </p>
                )}

                {suggestedCidades.length > 0 && (
                  <div className="space-y-3 pt-2 border-t border-slate-100">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-bold text-slate-800">
                        Cidades vizinhas em até 30 km ({suggestedCidades.length}) — Cidade inteira
                      </span>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() =>
                            setSuggestedCidades((prev) =>
                              prev.map((r) => ({
                                ...r,
                                selected: !existingLabelsSet.has(
                                  normalizeKey(formatAreaLabel(r.cidade, ''))
                                ),
                              }))
                            )
                          }
                          className="font-semibold text-emerald-700 hover:underline"
                        >
                          Selecionar novas
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setSuggestedCidades((prev) =>
                              prev.map((r) => ({ ...r, selected: false }))
                            )
                          }
                          className="font-semibold text-slate-500 hover:underline"
                        >
                          Desmarcar todas
                        </button>
                      </div>
                    </div>

                    <div className="max-h-64 overflow-auto border border-slate-200 rounded-2xl">
                      <table className="w-full text-left border-collapse text-xs sm:text-sm">
                        <thead className="bg-slate-50 sticky top-0 border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-500">
                          <tr>
                            <th className="py-2.5 px-3 w-10">Sel.</th>
                            <th className="py-2.5 px-3">Cidade (toda a cidade)</th>
                            <th className="py-2.5 px-3">Distância</th>
                            <th className="py-2.5 px-3">Taxa (R$)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {suggestedCidades.map((row) => {
                            const label = formatAreaLabel(row.cidade, '');
                            const alreadyExists = existingLabelsSet.has(normalizeKey(label));
                            return (
                              <tr
                                key={row.key}
                                className={alreadyExists ? 'bg-slate-50/70 opacity-70' : ''}
                              >
                                <td className="py-2 px-3">
                                  <input
                                    type="checkbox"
                                    checked={row.selected && !alreadyExists}
                                    disabled={alreadyExists}
                                    onChange={(e) =>
                                      setSuggestedCidades((prev) =>
                                        prev.map((item) =>
                                          item.key === row.key
                                            ? { ...item, selected: e.target.checked }
                                            : item
                                        )
                                      )
                                    }
                                    aria-label={`Selecionar ${row.cidade}`}
                                    className="w-4 h-4 accent-emerald-700"
                                  />
                                </td>
                                <td className="py-2 px-3">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="font-semibold text-slate-900">
                                      {label}
                                    </span>
                                    {alreadyExists && (
                                      <span className="px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 text-[10px] font-bold">
                                        Já cadastrado
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="py-2 px-3 text-slate-600 tabular-nums whitespace-nowrap">
                                  {row.distanciaKm.toFixed(1).replace('.', ',')} km
                                </td>
                                <td className="py-2 px-3 w-28">
                                  <input
                                    type="text"
                                    value={row.taxaInput}
                                    disabled={alreadyExists}
                                    onChange={(e) =>
                                      setSuggestedCidades((prev) =>
                                        prev.map((item) =>
                                          item.key === row.key
                                            ? { ...item, taxaInput: e.target.value }
                                            : item
                                        )
                                      )
                                    }
                                    placeholder="0,00"
                                    aria-label={`Taxa para ${row.cidade}`}
                                    className="w-24 min-h-[34px] px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-xs tabular-nums"
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {(suggestedBairros.length > 0 || suggestedCidades.length > 0) && (
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                    <span className="text-xs text-slate-500">
                      Áreas já cadastradas são ignoradas automaticamente.
                    </span>
                    <button
                      type="button"
                      disabled={savingSuggestions || selectedSuggestionsCount === 0}
                      onClick={handleAddSelectedSuggestions}
                      className="min-h-[44px] px-5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-xs sm:text-sm font-bold inline-flex items-center gap-2 shadow-xs"
                    >
                      <Plus className="w-4 h-4" />
                      <span>
                        {savingSuggestions
                          ? 'Adicionando...'
                          : `Adicionar selecionados (${selectedSuggestionsCount})`}
                      </span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Card a) Formulário + c) Botão Adicionar vários de uma vez */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-5 shadow-xs">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Áreas de Entrega por Cidade e Bairro
                </h2>
                <p className="text-xs sm:text-sm text-slate-600 mt-1">
                  Cadastre a cidade (obrigatória), o bairro (opcional — deixe vazio para atender a cidade inteira) e a taxa em R$. Use <strong className="text-slate-800">0</strong> para frete grátis.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setBatchOpen((v) => !v)}
                className={`min-h-[40px] px-3.5 py-2 rounded-xl border text-xs font-bold inline-flex items-center gap-1.5 transition-colors shrink-0 ${
                  batchOpen
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-slate-50 text-slate-800 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <ListPlus className="w-4 h-4" />
                <span>Adicionar vários de uma vez</span>
              </button>
            </div>

            {/* a) Formulário individual */}
            <form onSubmit={handleAddSingleArea} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                <div className="sm:col-span-4">
                  <label htmlFor="area-cidade" className="block text-xs font-semibold text-slate-700 mb-1">
                    Cidade *
                  </label>
                  <input
                    ref={manualCidadeInputRef}
                    id="area-cidade"
                    type="text"
                    required
                    list="cidades-existentes-list"
                    value={newCidade}
                    onChange={(e) => setNewCidade(e.target.value)}
                    placeholder="Ex: Jundiaí"
                    className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 text-sm"
                  />
                  <datalist id="cidades-existentes-list">
                    {citiesList.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>

                <div className="sm:col-span-4">
                  <label htmlFor="area-bairro" className="block text-xs font-semibold text-slate-700 mb-1">
                    Bairro (opcional)
                  </label>
                  <input
                    id="area-bairro"
                    type="text"
                    value={newBairroNome}
                    onChange={(e) => setNewBairroNome(e.target.value)}
                    placeholder="Vazio = cidade inteira"
                    className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 text-sm"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label htmlFor="area-taxa" className="block text-xs font-semibold text-slate-700 mb-1">
                    Taxa (R$) *
                  </label>
                  <input
                    id="area-taxa"
                    type="text"
                    required
                    value={newTaxa}
                    onChange={(e) => setNewTaxa(e.target.value)}
                    placeholder="7,50 ou 0"
                    className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 text-sm tabular-nums"
                  />
                </div>

                <div className="sm:col-span-2 flex items-end">
                  <button
                    type="submit"
                    disabled={addingArea}
                    className="w-full min-h-[44px] px-4 py-2 rounded-xl bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 text-sm font-bold inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
                  >
                    <Plus className="w-4 h-4" />
                    <span>{addingArea ? '...' : 'Adicionar'}</span>
                  </button>
                </div>
              </div>

              {previewNewLabel && (
                <p className="text-xs text-slate-500">
                  Exibição no checkout:{' '}
                  <strong className="text-slate-800 font-semibold">{previewNewLabel}</strong>
                </p>
              )}
            </form>

            {/* c) Adicionar vários de uma vez */}
            {batchOpen && (
              <div className="p-4 sm:p-5 rounded-2xl bg-slate-50 border border-slate-200 space-y-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      Importação em lote (Bairro;Cidade;Valor)
                    </h3>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Cole uma área por linha no formato <code className="font-mono bg-white px-1.5 py-0.5 rounded border border-slate-200">Bairro;Cidade;Valor</code>. Para cidade inteira, deixe o bairro vazio antes do primeiro ponto e vírgula (ex.: <code className="font-mono bg-white px-1.5 py-0.5 rounded border border-slate-200">;Itatiba;10,00</code>).
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setBatchOpen(false)}
                    aria-label="Fechar importação em lote"
                    className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <textarea
                  rows={5}
                  value={batchText}
                  onChange={(e) => setBatchText(e.target.value)}
                  placeholder={'Centro;Jundiaí;7,50\nVila Arens;Jundiaí;9,00\n;Itatiba;12,00'}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-xs sm:text-sm font-mono focus:outline-none focus:ring-2"
                />

                {parsedBatchLines.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-slate-700">
                        Pré-visualização ({validBatchItems.length} válida
                        {validBatchItems.length === 1 ? '' : 's'} de {parsedBatchLines.length})
                      </span>
                      {parsedBatchLines.some((l) => l.error) && (
                        <span className="text-rose-700 font-semibold">
                          Linhas com erro serão ignoradas até serem corrigidas.
                        </span>
                      )}
                    </div>

                    <div className="max-h-56 overflow-y-auto bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 text-xs">
                      {parsedBatchLines.map((line) => (
                        <div
                          key={line.lineNumber}
                          className={`px-3 py-2 flex flex-wrap items-center justify-between gap-2 ${
                            line.error ? 'bg-rose-50/70' : ''
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-slate-400 font-mono shrink-0">
                              L{line.lineNumber}
                            </span>
                            {line.error ? (
                              <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                            ) : (
                              <Check className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                            )}
                            <span className="font-semibold text-slate-900 truncate">
                              {line.label}
                            </span>
                          </div>

                          {line.error ? (
                            <span className="text-rose-700 font-medium">{line.error}</span>
                          ) : (
                            <span className="font-bold text-emerald-700 tabular-nums">
                              {line.taxa === 0 ? 'Grátis (R$ 0,00)' : formatBRL(line.taxa)}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="flex justify-end">
                      <button
                        type="button"
                        disabled={batchSaving || validBatchItems.length === 0}
                        onClick={handleBatchInsert}
                        className="min-h-[42px] px-5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-xs sm:text-sm font-bold shadow-xs"
                      >
                        {batchSaving
                          ? 'Salvando...'
                          : `Salvar ${validBatchItems.length} ${
                              validBatchItems.length === 1 ? 'área' : 'áreas'
                            }`}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* d) Aplicar mesmo valor a todos os bairros de uma cidade */}
            {citiesList.length > 0 && (
              <form
                onSubmit={handleApplyCityRate}
                className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3"
              >
                <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                  <Layers className="w-4 h-4 text-slate-600" />
                  <span>Aplicar mesmo valor a todos os bairros de uma cidade</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                  <select
                    value={bulkCity || citiesList[0] || ''}
                    onChange={(e) => setBulkCity(e.target.value)}
                    aria-label="Selecionar cidade para atualização em massa"
                    className="sm:col-span-5 min-h-[42px] px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs sm:text-sm"
                  >
                    {citiesList.map((city) => (
                      <option key={city} value={city}>
                        {city}
                      </option>
                    ))}
                  </select>

                  <input
                    type="text"
                    required
                    value={bulkCityFee}
                    onChange={(e) => setBulkCityFee(e.target.value)}
                    placeholder="Novo valor R$ (ex: 8,00 ou 0)"
                    aria-label="Novo valor da taxa para a cidade"
                    className="sm:col-span-4 min-h-[42px] px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs sm:text-sm tabular-nums"
                  />

                  <button
                    type="submit"
                    disabled={bulkCitySaving}
                    className="sm:col-span-3 min-h-[42px] px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-bold whitespace-nowrap"
                  >
                    {bulkCitySaving ? 'Aplicando...' : 'Aplicar à cidade'}
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* b) Tabela das áreas cadastradas, agrupada por cidade */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-4 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Áreas Cadastradas ({bairros.length})
                </h3>
                <p className="text-xs text-slate-500">
                  Clique no valor para edição rápida da taxa, ou use os botões para editar e excluir.
                </p>
              </div>

              <div className="relative w-full sm:w-64">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar cidade ou bairro..."
                  aria-label="Buscar área de entrega"
                  className="w-full min-h-[40px] pl-9 pr-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs sm:text-sm focus:outline-none focus:bg-white"
                />
              </div>
            </div>

            {bairros.length === 0 ? (
              <div className="border border-dashed border-slate-200 rounded-2xl p-8 text-center space-y-2">
                <MapPin className="w-8 h-8 text-slate-300 mx-auto" />
                <p className="text-sm font-semibold text-slate-800">
                  Nenhuma área de entrega cadastrada ainda
                </p>
                <p className="text-xs text-slate-500">
                  Adicione cidades e bairros acima para começar a cobrar frete por região.
                </p>
              </div>
            ) : groupedByCity.length === 0 ? (
              <div className="border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-500">
                Nenhuma área encontrada para "{searchQuery}".
              </div>
            ) : (
              <div className="space-y-4">
                {groupedByCity.map((group) => (
                  <div
                    key={group.cidade}
                    className="border border-slate-200 rounded-2xl overflow-hidden"
                  >
                    <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-slate-600" />
                        <span className="text-sm font-bold text-slate-900">{group.cidade}</span>
                      </div>
                      <span className="text-xs text-slate-500 font-medium tabular-nums">
                        {group.areas.length} {group.areas.length === 1 ? 'área' : 'áreas'}
                      </span>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wider text-slate-400">
                            <th className="py-2 px-4 font-semibold">Bairro / Área</th>
                            <th className="py-2 px-4 font-semibold">Taxa</th>
                            <th className="py-2 px-4 font-semibold text-right">Ações</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-sm">
                          {group.areas.map((area) => {
                            const bn = getAreaBairroNome(area);
                            const isEditingFull = editingId === area.id;
                            const isEditingInlineFee = inlineFeeId === area.id;
                            const isConfirmingDelete = confirmDeleteId === area.id;
                            const isBusy = savingInlineId === area.id;

                            if (isEditingFull) {
                              return (
                                <tr key={area.id} className="bg-slate-50/70">
                                  <td colSpan={3} className="p-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <input
                                        type="text"
                                        value={editCidade}
                                        onChange={(e) => setEditCidade(e.target.value)}
                                        placeholder="Cidade *"
                                        aria-label="Editar cidade"
                                        className="flex-1 min-w-[130px] min-h-[38px] px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs sm:text-sm"
                                      />
                                      <input
                                        type="text"
                                        value={editBairroNome}
                                        onChange={(e) => setEditBairroNome(e.target.value)}
                                        placeholder="Bairro (vazio = toda cidade)"
                                        aria-label="Editar bairro"
                                        className="flex-1 min-w-[140px] min-h-[38px] px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs sm:text-sm"
                                      />
                                      <input
                                        type="text"
                                        value={editTaxa}
                                        onChange={(e) => setEditTaxa(e.target.value)}
                                        placeholder="Taxa R$"
                                        aria-label="Editar taxa"
                                        className="w-24 min-h-[38px] px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs sm:text-sm tabular-nums"
                                      />
                                      <button
                                        type="button"
                                        disabled={isBusy}
                                        onClick={() => handleSaveFullEdit(area)}
                                        className="min-h-[38px] px-3.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-xs font-bold"
                                      >
                                        Salvar
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setEditingId(null)}
                                        className="min-h-[38px] px-3 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-600"
                                      >
                                        Cancelar
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            }

                            return (
                              <tr key={area.id} className="hover:bg-slate-50/60">
                                <td className="py-3 px-4">
                                  <div className="flex flex-wrap items-center gap-2">
                                    {bn ? (
                                      <span className="font-semibold text-slate-900">{bn}</span>
                                    ) : (
                                      <span className="px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold">
                                        Toda a cidade
                                      </span>
                                    )}
                                    <span className="text-[11px] text-slate-400 font-mono">
                                      ({area.bairro})
                                    </span>
                                    {area.distancia_km !== null &&
                                      area.distancia_km !== undefined &&
                                      Number.isFinite(Number(area.distancia_km)) && (
                                        <span className="text-[11px] text-slate-500 tabular-nums">
                                          • {Number(area.distancia_km).toFixed(1).replace('.', ',')} km
                                        </span>
                                      )}
                                  </div>
                                </td>

                                <td className="py-3 px-4">
                                  {isEditingInlineFee ? (
                                    <div className="inline-flex items-center gap-1.5">
                                      <input
                                        type="text"
                                        autoFocus
                                        value={inlineFeeValue}
                                        onChange={(e) => setInlineFeeValue(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            e.preventDefault();
                                            handleSaveInlineFee(area);
                                          } else if (e.key === 'Escape') {
                                            setInlineFeeId(null);
                                          }
                                        }}
                                        aria-label={`Taxa inline para ${area.bairro}`}
                                        className="w-20 min-h-[34px] px-2.5 py-1 rounded-lg border border-slate-300 bg-white text-xs font-semibold tabular-nums"
                                      />
                                      <button
                                        type="button"
                                        disabled={isBusy}
                                        onClick={() => handleSaveInlineFee(area)}
                                        aria-label="Salvar taxa"
                                        className="w-8 h-8 rounded-lg bg-emerald-700 text-white inline-flex items-center justify-center"
                                      >
                                        <Check className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setInlineFeeId(null)}
                                        aria-label="Cancelar edição da taxa"
                                        className="w-8 h-8 rounded-lg border border-slate-200 text-slate-500 inline-flex items-center justify-center"
                                      >
                                        <X className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setInlineFeeId(area.id);
                                        setInlineFeeValue(formatMoneyInput(area.taxa));
                                        setEditingId(null);
                                      }}
                                      title="Clique para editar a taxa rapidamente"
                                      className={`px-2.5 py-1 rounded-lg border text-xs font-bold tabular-nums transition-colors ${
                                        area.taxa === 0
                                          ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                                          : 'bg-slate-50 border-slate-200 text-slate-900 hover:bg-slate-100'
                                      }`}
                                    >
                                      {area.taxa === 0 ? 'Grátis (R$ 0,00)' : formatBRL(area.taxa)}
                                    </button>
                                  )}
                                </td>

                                <td className="py-3 px-4 text-right">
                                  {isConfirmingDelete ? (
                                    <div className="inline-flex items-center justify-end gap-1.5">
                                      <button
                                        type="button"
                                        disabled={isBusy}
                                        onClick={() => handleDeleteArea(area)}
                                        className="min-h-[34px] px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold"
                                      >
                                        Confirmar
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setConfirmDeleteId(null)}
                                        className="min-h-[34px] px-2.5 py-1 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600"
                                      >
                                        Voltar
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="inline-flex items-center justify-end gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingId(area.id);
                                          setEditCidade(getAreaCidade(area));
                                          setEditBairroNome(getAreaBairroNome(area));
                                          setEditTaxa(formatMoneyInput(area.taxa));
                                          setInlineFeeId(null);
                                          setConfirmDeleteId(null);
                                        }}
                                        aria-label={`Editar ${area.bairro}`}
                                        className="w-9 h-9 rounded-xl border border-slate-200 inline-flex items-center justify-center text-slate-600 hover:bg-slate-100"
                                      >
                                        <Pencil className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setConfirmDeleteId(area.id)}
                                        aria-label={`Excluir ${area.bairro}`}
                                        className="w-9 h-9 rounded-xl border border-slate-200 inline-flex items-center justify-center text-rose-600 hover:bg-rose-50"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
