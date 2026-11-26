import { useEffect, useState } from 'react';
import { UtensilsCrossed } from 'lucide-react';

interface ImageWithFallbackProps {
  src?: string | null;
  alt: string;
  className?: string;
  fallbackClassName?: string;
  showLabel?: boolean;
}

export function ImageWithFallback({
  src,
  alt,
  className = 'w-full h-full object-cover',
  fallbackClassName = '',
  showLabel = true,
}: ImageWithFallbackProps) {
  const [hasError, setHasError] = useState(false);

  const safeSrc = typeof src === 'string' && src.trim().length > 0 ? src.trim() : '';

  useEffect(() => {
    setHasError(false);
  }, [safeSrc]);

  if (!safeSrc || hasError) {
    return (
      <div
        className={`w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 text-slate-400 p-4 text-center select-none ${fallbackClassName}`}
        role="img"
        aria-label={alt}
      >
        <UtensilsCrossed className="w-7 h-7 opacity-55" strokeWidth={1.5} />
        {showLabel && (
          <span className="mt-2 text-xs font-medium text-slate-500 line-clamp-2 max-w-[160px]">
            {alt}
          </span>
        )}
      </div>
    );
  }

  return (
    <img
      src={safeSrc}
      alt={alt}
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={() => setHasError(true)}
      className={className}
    />
  );
}
