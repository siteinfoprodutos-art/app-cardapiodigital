import { useRef, type ClipboardEvent, type InputHTMLAttributes, type KeyboardEvent } from 'react';
import { formatCentsToBRL } from '../types/menu';

const MAX_DIGITS = 10; // Até R$ 99.999.999,99

export interface CurrencyInputProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'type' | 'inputMode' | 'value' | 'onChange' | 'defaultValue'
  > {
  valueCents: number | null;
  onChangeCents: (cents: number | null) => void;
  allowEmpty?: boolean;
}

function digitsToCents(rawDigits: string): number {
  const limited = rawDigits.slice(0, MAX_DIGITS);
  if (!limited) return 0;
  const parsed = Number.parseInt(limited, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

export function CurrencyInput({
  valueCents,
  onChangeCents,
  allowEmpty = false,
  onFocus,
  onClick,
  onPaste,
  onKeyDown,
  ...rest
}: CurrencyInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const displayValue =
    valueCents === null || valueCents === undefined || !Number.isFinite(valueCents)
      ? allowEmpty
        ? ''
        : formatCentsToBRL(0)
      : formatCentsToBRL(valueCents);

  const moveCaretToEnd = () => {
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el || document.activeElement !== el) return;
      const len = el.value.length;
      try {
        el.setSelectionRange(len, len);
      } catch {
        // Ignorar em inputs que não suportam seleção
      }
    });
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawDigits = e.target.value.replace(/\D/g, '');
    if (!rawDigits) {
      onChangeCents(allowEmpty ? null : 0);
      moveCaretToEnd();
      return;
    }

    const nextCents = digitsToCents(rawDigits);
    onChangeCents(nextCents);
    moveCaretToEnd();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;

    if ((e.key === 'Backspace' || e.key === 'Delete') && allowEmpty && valueCents === 0) {
      e.preventDefault();
      onChangeCents(null);
      return;
    }

    // Impede digitar sinais negativos/positivos ou letras
    if (
      e.key.length === 1 &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !/^\d$/.test(e.key)
    ) {
      e.preventDefault();
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    onPaste?.(e);
    if (e.defaultPrevented) return;

    e.preventDefault();
    const pastedText = e.clipboardData?.getData('text') || '';
    const digits = pastedText.replace(/\D/g, '');
    if (!digits) {
      return;
    }
    onChangeCents(digitsToCents(digits));
    moveCaretToEnd();
  };

  return (
    <input
      {...rest}
      ref={inputRef}
      type="text"
      inputMode="numeric"
      value={displayValue}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      onFocus={(e) => {
        onFocus?.(e);
        moveCaretToEnd();
      }}
      onClick={(e) => {
        onClick?.(e);
        const el = inputRef.current;
        if (el && el.selectionStart === el.selectionEnd) {
          moveCaretToEnd();
        }
      }}
    />
  );
}
