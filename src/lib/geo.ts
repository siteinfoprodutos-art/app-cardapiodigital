import type { BairroEntrega } from '../types/menu';

export function cleanCepDigits(raw?: string | null): string {
  return (raw || '').replace(/\D/g, '').slice(0, 8);
}

export function formatCepMask(raw?: string | null): string {
  const digits = cleanCepDigits(raw);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5, 8)}`;
}

export interface CheckoutCepAddress {
  rua: string;
  bairro: string;
  cidade: string;
  uf: string;
}

const checkoutCepMemoryCache = new Map<string, CheckoutCepAddress>();

export async function lookupCheckoutCep(cepRaw: string): Promise<CheckoutCepAddress> {
  const digits = cleanCepDigits(cepRaw);
  if (digits.length !== 8) {
    throw new Error('CEP não encontrado. Preencha o endereço manualmente.');
  }

  const cached = checkoutCepMemoryCache.get(digits);
  if (cached) {
    return cached;
  }

  // 1) Tenta BrasilAPI v1 (street, neighborhood, city, state)
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`https://brasilapi.com.br/api/cep/v1/${digits}`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = (await res.json()) as {
        street?: string;
        neighborhood?: string;
        city?: string;
        state?: string;
      };

      if (data && (data.city || data.state)) {
        const normalized: CheckoutCepAddress = {
          rua: (data.street || '').trim(),
          bairro: (data.neighborhood || '').trim(),
          cidade: (data.city || '').trim(),
          uf: (data.state || '').trim().toUpperCase(),
        };
        checkoutCepMemoryCache.set(digits, normalized);
        return normalized;
      }
    }
  } catch {
    // Segue para fallback ViaCEP
  }

  // 2) Fallback: ViaCEP (logradouro, bairro, localidade, uf; "erro": true => não encontrado)
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error('CEP não encontrado. Preencha o endereço manualmente.');
    }

    const data = (await res.json()) as {
      logradouro?: string;
      bairro?: string;
      localidade?: string;
      uf?: string;
      erro?: boolean | string;
    };

    if (data.erro === true || data.erro === 'true' || (!data.localidade && !data.uf)) {
      throw new Error('CEP não encontrado. Preencha o endereço manualmente.');
    }

    const normalized: CheckoutCepAddress = {
      rua: (data.logradouro || '').trim(),
      bairro: (data.bairro || '').trim(),
      cidade: (data.localidade || '').trim(),
      uf: (data.uf || '').trim().toUpperCase(),
    };
    checkoutCepMemoryCache.set(digits, normalized);
    return normalized;
  } catch {
    throw new Error('CEP não encontrado. Preencha o endereço manualmente.');
  }
}

const ADDRESS_ABBREVIATIONS: Record<string, string> = {
  jd: 'jardim',
  vl: 'vila',
  pq: 'parque',
  res: 'residencial',
  cj: 'conjunto',
  sto: 'santo',
  sta: 'santa',
  av: 'avenida',
  r: 'rua',
};

export function normalizeAddressComparisonText(raw?: string | null): string {
  const cleaned = (raw || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]|_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return '';

  return cleaned
    .split(' ')
    .map((token) => ADDRESS_ABBREVIATIONS[token] || token)
    .join(' ');
}

export function matchDeliveryArea(
  areas: BairroEntrega[],
  bairro?: string | null,
  cidade?: string | null
): BairroEntrega | null {
  if (areas.length === 0) return null;

  const normBairro = normalizeAddressComparisonText(bairro);
  const normCidade = normalizeAddressComparisonText(cidade);

  // 1º: área cujo bairro_nome e cidade coincidam com o bairro e a cidade do endereço
  if (normBairro && normCidade) {
    const exactNeighborhood = areas.find((area) => {
      const areaBairro = normalizeAddressComparisonText(area.bairro_nome);
      const areaCidade = normalizeAddressComparisonText(area.cidade);
      return Boolean(areaBairro && areaCidade && areaBairro === normBairro && areaCidade === normCidade);
    });
    if (exactNeighborhood) return exactNeighborhood;
  }

  // 2º: área de "cidade inteira" (bairro_nome vazio) cuja cidade coincida com a do endereço
  if (normCidade) {
    const wholeCity = areas.find((area) => {
      const areaBairro = (area.bairro_nome || '').trim();
      const areaCidade = normalizeAddressComparisonText(area.cidade);
      return !areaBairro && Boolean(areaCidade && areaCidade === normCidade);
    });
    if (wholeCity) return wholeCity;
  }

  // 3º: áreas antigas sem bairro_nome/cidade, comparar o rótulo (coluna bairro) normalizado com o bairro
  if (normBairro) {
    const legacyMatch = areas.find((area) => {
      const hasStructuredCols = Boolean((area.bairro_nome || '').trim() || (area.cidade || '').trim());
      if (hasStructuredCols) return false;
      const areaLabel = normalizeAddressComparisonText(area.bairro);
      return Boolean(areaLabel && areaLabel === normBairro);
    });
    if (legacyMatch) return legacyMatch;
  }

  return null;
}

export interface CepLookupResult {
  cep: string;
  logradouro: string;
  bairro: string;
  cidade: string;
  uf: string;
  latitude: number | null;
  longitude: number | null;
  source: 'brasilapi' | 'viacep';
}

function parseCoordinate(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  const num = Number(val);
  if (!Number.isFinite(num) || num === 0) return null;
  return num;
}

export async function lookupCep(cepRaw: string): Promise<CepLookupResult> {
  const digits = cleanCepDigits(cepRaw);
  if (digits.length !== 8) {
    throw new Error('CEP inválido. Informe os 8 dígitos do CEP.');
  }

  // 1) Tenta BrasilAPI v2 primeiro (pode incluir location.coordinates)
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`https://brasilapi.com.br/api/cep/v2/${digits}`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = (await res.json()) as {
        cep?: string;
        state?: string;
        city?: string;
        neighborhood?: string;
        street?: string;
        location?: {
          coordinates?: {
            latitude?: string | number;
            longitude?: string | number;
          };
        };
      };

      if (data && (data.city || data.state)) {
        const lat = parseCoordinate(data.location?.coordinates?.latitude);
        const lon = parseCoordinate(data.location?.coordinates?.longitude);

        return {
          cep: cleanCepDigits(data.cep) || digits,
          logradouro: (data.street || '').trim(),
          bairro: (data.neighborhood || '').trim(),
          cidade: (data.city || '').trim(),
          uf: (data.state || '').trim().toUpperCase(),
          latitude: lat !== null && lon !== null ? lat : null,
          longitude: lat !== null && lon !== null ? lon : null,
          source: 'brasilapi',
        };
      }
    }
  } catch {
    // Segue para fallback ViaCEP
  }

  // 2) Fallback: ViaCEP
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error('Não foi possível consultar o CEP no momento.');
    }

    const data = (await res.json()) as {
      cep?: string;
      logradouro?: string;
      bairro?: string;
      localidade?: string;
      uf?: string;
      erro?: boolean | string;
    };

    if (data.erro === true || data.erro === 'true' || (!data.localidade && !data.uf)) {
      throw new Error('CEP não encontrado. Preencha o endereço manualmente.');
    }

    return {
      cep: cleanCepDigits(data.cep) || digits,
      logradouro: (data.logradouro || '').trim(),
      bairro: (data.bairro || '').trim(),
      cidade: (data.localidade || '').trim(),
      uf: (data.uf || '').trim().toUpperCase(),
      latitude: null,
      longitude: null,
      source: 'viacep',
    };
  } catch (err) {
    if (err instanceof Error && err.message.includes('CEP não encontrado')) {
      throw err;
    }
    throw new Error('CEP inválido ou serviço indisponível. Preencha o endereço manualmente.');
  }
}

export async function geocodeAddressNominatim(params: {
  logradouro: string;
  numero?: string;
  cidade: string;
  uf: string;
}): Promise<{ latitude: number; longitude: number } | null> {
  const parts = [
    params.logradouro.trim(),
    (params.numero || '').trim(),
    params.cidade.trim(),
    params.uf.trim().toUpperCase(),
  ].filter(Boolean);

  if (parts.length < 2) {
    return null;
  }

  const query = parts.join(', ');
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=br&q=${encodeURIComponent(
    query
  )}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
    });
    clearTimeout(timeoutId);

    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ lat?: string; lon?: string }>;
    if (!Array.isArray(data) || data.length === 0) return null;

    const lat = Number(data[0].lat);
    const lon = Number(data[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    return { latitude: lat, longitude: lon };
  } catch {
    return null;
  }
}

export function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

function normalizePlaceName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export interface OverpassPlaceSuggestion {
  name: string;
  distanciaKm: number;
  placeType: string;
}

interface OverpassElement {
  lat?: number;
  lon?: number;
  center?: {
    lat?: number;
    lon?: number;
  };
  tags?: {
    name?: string;
    place?: string;
  };
}

const overpassMemoryCache = new Map<string, OverpassPlaceSuggestion[]>();

async function runOverpassQuery(query: string): Promise<OverpassElement[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 28000);

  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });

    if (!res.ok) {
      if (res.status === 429) {
        throw new Error('Muitas buscas seguidas no servidor do mapa. Aguarde alguns segundos e tente de novo.');
      }
      if (res.status === 504 || res.status === 408) {
        throw new Error('A consulta demorou demais para responder. Tente de novo ou cadastre manualmente.');
      }
      throw new Error('Não foi possível consultar regiões próximas no momento.');
    }

    const json = (await res.json()) as { elements?: OverpassElement[] };
    return Array.isArray(json.elements) ? json.elements : [];
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Tempo esgotado ao buscar regiões próximas. Tente de novo ou use o cadastro manual.');
    }
    if (err instanceof Error) throw err;
    throw new Error('Falha ao consultar regiões próximas no OpenStreetMap.');
  } finally {
    clearTimeout(timeoutId);
  }
}

function extractUniqueSortedPlaces(
  elements: OverpassElement[],
  originLat: number,
  originLon: number
): OverpassPlaceSuggestion[] {
  const deduped = new Map<string, OverpassPlaceSuggestion>();

  for (const el of elements) {
    const name = el.tags?.name?.trim();
    if (!name) continue;

    const elLat = el.center?.lat ?? el.lat;
    const elLon = el.center?.lon ?? el.lon;
    if (
      typeof elLat !== 'number' ||
      typeof elLon !== 'number' ||
      !Number.isFinite(elLat) ||
      !Number.isFinite(elLon)
    ) {
      continue;
    }

    const dist = haversineDistanceKm(originLat, originLon, elLat, elLon);
    const key = normalizePlaceName(name);
    const existing = deduped.get(key);
    if (!existing || dist < existing.distanciaKm) {
      deduped.set(key, {
        name,
        distanciaKm: dist,
        placeType: el.tags?.place || '',
      });
    }
  }

  return Array.from(deduped.values()).sort((a, b) => a.distanciaKm - b.distanciaKm);
}

export async function fetchNearbyNeighborhoodsOverpass(
  lat: number,
  lon: number,
  radiusKm: number,
  options: { bypassCache?: boolean } = {}
): Promise<OverpassPlaceSuggestion[]> {
  const cacheKey = `bairros:${lat.toFixed(4)}:${lon.toFixed(4)}:${radiusKm}`;
  if (!options.bypassCache && overpassMemoryCache.has(cacheKey)) {
    return overpassMemoryCache.get(cacheKey)!;
  }

  const radiusMeters = Math.round(radiusKm * 1000);
  const query = `[out:json][timeout:25];\nnwr(around:${radiusMeters},${lat},${lon})["place"~"^(suburb|neighbourhood|quarter)$"]["name"];\nout center tags;`;

  const elements = await runOverpassQuery(query);
  const results = extractUniqueSortedPlaces(elements, lat, lon);
  overpassMemoryCache.set(cacheKey, results);
  return results;
}

export async function fetchNearbyCitiesOverpass(
  lat: number,
  lon: number,
  radiusKm = 30,
  options: { bypassCache?: boolean } = {}
): Promise<OverpassPlaceSuggestion[]> {
  const cacheKey = `cidades:${lat.toFixed(4)}:${lon.toFixed(4)}:${radiusKm}`;
  if (!options.bypassCache && overpassMemoryCache.has(cacheKey)) {
    return overpassMemoryCache.get(cacheKey)!;
  }

  const radiusMeters = Math.round(radiusKm * 1000);
  const query = `[out:json][timeout:25];\nnwr(around:${radiusMeters},${lat},${lon})["place"~"^(city|town|village)$"]["name"];\nout center tags;`;

  const elements = await runOverpassQuery(query);
  const results = extractUniqueSortedPlaces(elements, lat, lon);
  overpassMemoryCache.set(cacheKey, results);
  return results;
}
