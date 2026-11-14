import type { CurrencyCode, QuickParseResult } from '@shared/types/domain';

const KNOWN_WALLET_HINTS = [
  'bca',
  'mandiri',
  'bni',
  'bri',
  'bsi',
  'jago',
  'seabank',
  'jenius',
  'gopay',
  'ovo',
  'dana',
  'shopeepay',
  'linkaja',
  'qris',
  'tunai',
  'cash',
  'kas',
  'paypal',
  'wise',
];

const INCOME_PREFIXES = ['+', 'masuk ', 'terima ', 'gaji ', 'omzet ', 'dp ', 'bayaran '];

const MULTIPLIER_MAP: Record<string, number> = {
  rb: 1_000,
  ribu: 1_000,
  k: 1_000,
  jt: 1_000_000,
  juta: 1_000_000,
  m: 1_000_000,
};

function detectType(text: string): { type: 'income' | 'expense'; cleaned: string } {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  if (trimmed.startsWith('+')) {
    return { type: 'income', cleaned: trimmed.slice(1).trim() };
  }

  const matchedIncome = INCOME_PREFIXES.some((prefix) => prefix !== '+' && lower.startsWith(prefix));
  if (matchedIncome) {
    return { type: 'income', cleaned: trimmed };
  }

  return { type: 'expense', cleaned: trimmed };
}

function parseNumericToken(token: string): { amount: number; currency: CurrencyCode } | null {
  let currency: CurrencyCode = 'IDR';
  let body = token.trim();

  if (body.startsWith('$') || body.toLowerCase().startsWith('usd')) {
    currency = 'USD';
    body = body.replace(/^(\$|usd)/i, '');
  } else if (body.toLowerCase().startsWith('rp')) {
    currency = 'IDR';
    body = body.replace(/^rp/i, '');
  }

  const match = body.match(/^(\d+(?:[.,]\d+)?)(rb|ribu|k|jt|juta|m)?$/i);
  if (!match || !match[1]) {
    return null;
  }

  const rawNumber = match[1];
  const suffix = match[2]?.toLowerCase();
  const multiplier = suffix ? (MULTIPLIER_MAP[suffix] ?? 1) : 1;

  // Normalisasi pemisah ribuan Indonesia (contoh: 350.000 -> 350000) vs desimal (5.5jt / 12.50 USD)
  let normalizedNumber: number;
  if (!suffix && /^\d{1,3}(\.\d{3})+$/.test(rawNumber)) {
    normalizedNumber = Number(rawNumber.replace(/\./g, ''));
  } else {
    normalizedNumber = Number(rawNumber.replace(',', '.'));
  }

  if (!Number.isFinite(normalizedNumber) || normalizedNumber <= 0) {
    return null;
  }

  return {
    amount: Math.round(normalizedNumber * multiplier * 100) / 100,
    currency,
  };
}

/**
 * Mengurai input transaksi cepat satu baris menjadi komponen terstruktur.
 * Contoh: "makan siang 25rb gopay" -> expense Rp25.000, dompet "gopay".
 */
export function parseQuickInput(rawInput: string): QuickParseResult {
  const { type, cleaned } = detectType(rawInput);
  const tokens = cleaned.split(/\s+/).filter(Boolean);

  let amount: number | null = null;
  let currency: CurrencyCode = 'IDR';
  let walletHint: string | null = null;
  const descriptionTokens: string[] = [];

  for (const token of tokens) {
    if (token.startsWith('@') && token.length > 1 && !walletHint) {
      walletHint = token.slice(1).toLowerCase();
      continue;
    }

    if (amount === null) {
      const parsedAmount = parseNumericToken(token);
      if (parsedAmount) {
        amount = parsedAmount.amount;
        currency = parsedAmount.currency;
        continue;
      }
    }

    const lowerToken = token.toLowerCase();
    if (!walletHint && KNOWN_WALLET_HINTS.includes(lowerToken)) {
      walletHint = lowerToken;
      continue;
    }

    descriptionTokens.push(token);
  }

  return {
    raw: rawInput,
    type,
    amount,
    currency,
    description: descriptionTokens.join(' '),
    walletHint,
  };
}
