/** Parts used to build or describe a stock variant key. */
export type VariantParts = {
  variantId?: string | null;
  colorId?: string | null;
  sizeId?: string | null;
  colorName?: string | null;
  sizeName?: string | null;
};

export type ParsedVariant = {
  colorId: string;
  sizeId: string;
  colorName: string;
  sizeName: string;
  /** Human-readable label, e.g. "Red / XL". */
  label: string;
};

const PREFIX = 'v1';

const clean = (value?: string | null) => (value ?? '').trim();

/**
 * Stable inventory key from color/size on a PO line, or an explicit variantId.
 * Prefer IDs (shorter). Names are kept when IDs are missing, and still parsed
 * from older keys: `v1::{colorId}::{sizeId}::{colorName}::{sizeName}`.
 */
export function resolveVariantId(parts: VariantParts): string {
  const existing = clean(parts.variantId);
  if (existing.startsWith(`${PREFIX}::`)) return existing;

  const colorId = clean(parts.colorId);
  const sizeId = clean(parts.sizeId);
  const colorName = clean(parts.colorName);
  const sizeName = clean(parts.sizeName);
  if (colorId || sizeId) {
    // Keep names in the key when present so inventory UI can label without joins.
    if (colorName || sizeName) {
      return [PREFIX, colorId, sizeId, colorName, sizeName].join('::');
    }
    return [PREFIX, colorId, sizeId].join('::');
  }
  if (colorName || sizeName) {
    return [PREFIX, '', '', colorName, sizeName].join('::');
  }
  // Bare product-variant UUIDs are not inventory keys — ignore them.
  return '';
}

export function parseVariantId(variantId?: string | null): ParsedVariant {
  const raw = clean(variantId);
  if (!raw) {
    return { colorId: '', sizeId: '', colorName: '', sizeName: '', label: '' };
  }
  if (raw.startsWith(`${PREFIX}::`)) {
    const parts = raw.split('::');
    const colorId = parts[1] ?? '';
    const sizeId = parts[2] ?? '';
    const colorName = parts[3] ?? '';
    const sizeName = parts[4] ?? '';
    const label = [colorName, sizeName].filter(Boolean).join(' / ');
    return {
      colorId,
      sizeId,
      colorName,
      sizeName,
      // Never surface raw color/size UUIDs as the human label.
      label,
    };
  }
  return { colorId: '', sizeId: '', colorName: '', sizeName: '', label: '' };
}

export function variantLabel(parts: VariantParts): string {
  const fromNames = [clean(parts.colorName), clean(parts.sizeName)].filter(Boolean).join(' / ');
  if (fromNames) return fromNames;
  return parseVariantId(resolveVariantId(parts)).label;
}

/** True when two inventory/PO variant keys refer to the same color×size (or both empty). */
export function variantsMatch(
  left?: string | null,
  right?: string | null,
): boolean {
  const a = clean(left);
  const b = clean(right);
  if (!a && !b) return true;
  if (a && b && a === b) return true;
  const pa = parseVariantId(a);
  const pb = parseVariantId(b);
  if (pa.colorId && pb.colorId && pa.sizeId && pb.sizeId) {
    return pa.colorId === pb.colorId && pa.sizeId === pb.sizeId;
  }
  if (pa.colorName && pb.colorName && pa.sizeName && pb.sizeName) {
    return (
      pa.colorName.toLowerCase() === pb.colorName.toLowerCase() &&
      pa.sizeName.toLowerCase() === pb.sizeName.toLowerCase()
    );
  }
  return false;
}

/** Read variant fields from a PO / receipt line without relying on generated Prisma types. */
export function resolveVariantIdFromLine(
  line: unknown,
  fallbackVariantId?: string | null,
): string {
  const source = (line ?? {}) as VariantParts;
  return resolveVariantId({
    variantId: fallbackVariantId || source.variantId,
    colorId: source.colorId,
    sizeId: source.sizeId,
    colorName: source.colorName,
    sizeName: source.sizeName,
  });
}
