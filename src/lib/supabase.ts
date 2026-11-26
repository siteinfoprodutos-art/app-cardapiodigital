import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || '';
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || '';

export const isSupabaseConfigured = Boolean(
  supabaseUrl && supabaseAnonKey && /^https?:\/\//i.test(supabaseUrl)
);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export const STORAGE_BUCKET = 'cardapio';

export interface ProcessImageOptions {
  maxWidth?: number;
  maxHeight?: number;
  maxBytes?: number;
  appendCacheBuster?: boolean;
}

function canvasToWebpBlob(
  canvas: HTMLCanvasElement,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Falha na conversão para WebP.'));
      },
      'image/webp',
      quality
    );
  });
}

/**
 * Redimensiona imagem no navegador respeitando largura/altura máxima,
 * comprime em WebP abaixo de maxBytes (padrão 450 KB) e faz upload no bucket 'cardapio'.
 */
export async function processAndUploadImage(
  file: File,
  storagePath: string,
  options: ProcessImageOptions = {}
): Promise<string> {
  if (!supabase) {
    throw new Error('Supabase não está configurado.');
  }

  if (!file.type.startsWith('image/')) {
    throw new Error('O arquivo enviado não é uma imagem válida.');
  }

  const maxWidth = options.maxWidth ?? 1000;
  const maxHeight = options.maxHeight ?? maxWidth;
  const maxBytes = options.maxBytes ?? 450 * 1024;
  const appendCacheBuster = options.appendCacheBuster ?? true;

  const loadedImg = await new Promise<HTMLImageElement>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Falha ao carregar a imagem.'));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo de imagem.'));
    reader.readAsDataURL(file);
  });

  let width = loadedImg.width;
  let height = loadedImg.height;

  if (width > maxWidth) {
    height = Math.round((height * maxWidth) / width);
    width = maxWidth;
  }
  if (height > maxHeight) {
    width = Math.round((width * maxHeight) / height);
    height = maxHeight;
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Falha ao processar contexto gráfico da imagem.');
  }
  ctx.drawImage(loadedImg, 0, 0, canvas.width, canvas.height);

  // Tenta comprimir progressivamente para garantir tamanho abaixo de 450 KB
  const qualities = [0.84, 0.72, 0.58, 0.45, 0.34];
  let webpBlob = await canvasToWebpBlob(canvas, qualities[0]);

  for (let i = 1; i < qualities.length && webpBlob.size > maxBytes; i++) {
    webpBlob = await canvasToWebpBlob(canvas, qualities[i]);
  }

  // Se ainda exceder maxBytes, reduz escala em 20%
  let scaleAttempts = 0;
  while (webpBlob.size > maxBytes && scaleAttempts < 2) {
    scaleAttempts++;
    const nextW = Math.max(120, Math.round(canvas.width * 0.8));
    const nextH = Math.max(120, Math.round(canvas.height * 0.8));
    canvas.width = nextW;
    canvas.height = nextH;
    const retryCtx = canvas.getContext('2d');
    if (!retryCtx) break;
    retryCtx.drawImage(loadedImg, 0, 0, nextW, nextH);
    webpBlob = await canvasToWebpBlob(canvas, 0.5);
  }

  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, webpBlob, {
      cacheControl: '3600',
      upsert: true,
      contentType: 'image/webp',
    });

  if (uploadError) {
    throw new Error(`Erro ao enviar foto: ${uploadError.message}`);
  }

  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
  if (!data?.publicUrl) {
    throw new Error('Não foi possível obter a URL pública da imagem.');
  }

  if (appendCacheBuster) {
    const separator = data.publicUrl.includes('?') ? '&' : '?';
    return `${data.publicUrl}${separator}v=${Date.now()}`;
  }

  return data.publicUrl;
}

export async function deleteStoragePhoto(publicUrl: string): Promise<void> {
  if (!supabase || !publicUrl) return;
  try {
    const cleanUrl = publicUrl.split('?')[0];
    const marker = `/storage/v1/object/public/${STORAGE_BUCKET}/`;
    const idx = cleanUrl.indexOf(marker);
    if (idx !== -1) {
      const filePath = cleanUrl.substring(idx + marker.length);
      if (filePath) {
        await supabase.storage.from(STORAGE_BUCKET).remove([filePath]);
      }
    }
  } catch {
    // Ignorar falhas de exclusão de storage se o arquivo não existir
  }
}

export function translateSupabaseError(
  err: unknown,
  fallback = 'Ocorreu um erro ao comunicar com o servidor. Tente novamente.'
): string {
  if (!err) return fallback;

  let rawMsg = '';
  let code = '';
  let details = '';

  if (typeof err === 'string') {
    rawMsg = err;
  } else if (typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    rawMsg = typeof obj.message === 'string' ? obj.message : '';
    code = typeof obj.code === 'string' ? obj.code : '';
    details = typeof obj.details === 'string' ? obj.details : '';
  }

  const combined = `${rawMsg} ${details} ${code}`.toLowerCase();

  if (
    combined.includes('failed to fetch') ||
    combined.includes('networkerror') ||
    combined.includes('network request failed') ||
    combined.includes('err_network')
  ) {
    return 'Falha de conexão com o servidor. Verifique sua internet e tente novamente.';
  }

  if (
    combined.includes('invalid login credentials') ||
    combined.includes('invalid_credentials')
  ) {
    return 'E-mail ou senha incorretos.';
  }

  if (combined.includes('email not confirmed')) {
    return 'Confirme seu e-mail antes de acessar o painel.';
  }

  if (
    combined.includes('user already registered') ||
    combined.includes('user_already_exists') ||
    combined.includes('already registered')
  ) {
    return 'Este e-mail já está cadastrado.';
  }

  if (
    combined.includes('password should be at least') ||
    combined.includes('weak_password')
  ) {
    return 'A senha deve ter pelo menos 6 caracteres.';
  }

  if (
    combined.includes('jwt expired') ||
    combined.includes('invalid jwt') ||
    combined.includes('refresh_token_not_found')
  ) {
    return 'Sua sessão expirou. Faça login novamente.';
  }

  if (
    code === '42501' ||
    combined.includes('row-level security') ||
    combined.includes('permission denied')
  ) {
    return 'Você não tem permissão para realizar esta ação.';
  }

  if (
    code === '23505' ||
    combined.includes('estabelecimentos_slug_key') ||
    (combined.includes('slug') && combined.includes('unique')) ||
    combined.includes('duplicate key')
  ) {
    if (combined.includes('slug')) {
      return 'Este slug já está em uso por outro estabelecimento.';
    }
    return 'Registro duplicado. Verifique os dados informados.';
  }

  if (combined.includes('100 produtos') || combined.includes('limite de 100')) {
    return 'Limite de 100 produtos atingido para esta loja.';
  }

  if (code === 'PGRST116' || combined.includes('json object requested, multiple (or no) rows')) {
    return 'Registro não encontrado no banco de dados.';
  }

  if (combined.includes('could not find the function') || code === 'PGRST202') {
    return 'Função do servidor não encontrada. Verifique a configuração do Supabase.';
  }

  if (rawMsg.trim()) {
    return rawMsg.trim();
  }

  return fallback;
}

