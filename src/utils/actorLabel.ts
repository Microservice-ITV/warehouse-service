/** In-process cache of userId -> display label (name or email). */
const actorLabels = new Map<string, string>();

const SEP = '\u001f';

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

export function rememberActor(userId: string | null | undefined, label: string | null | undefined) {
  const id = (userId ?? '').trim();
  const text = (label ?? '').trim().replace(/\u001f/g, ' ');
  if (!id || !text) return;
  actorLabels.set(id, text);
}

/** Persist id (+ optional label) into movement.createdBy without a schema change. */
export function encodeActor(
  userId: string | null | undefined,
  label?: string | null,
): string | null {
  const id = (userId ?? '').trim();
  if (!id) return null;
  const text = (label ?? '').trim().replace(/\u001f/g, ' ') || actorLabels.get(id) || '';
  if (text) {
    rememberActor(id, text);
    return `${id}${SEP}${text}`;
  }
  return id;
}

export function decodeActor(value?: string | null): { id: string | null; label: string } {
  const raw = (value ?? '').trim();
  if (!raw) return { id: null, label: 'system' };

  const sep = raw.indexOf(SEP);
  if (sep >= 0) {
    const id = raw.slice(0, sep).trim();
    const label = raw.slice(sep + 1).trim();
    if (id && label) rememberActor(id, label);
    return { id: id || null, label: label || actorLabels.get(id) || shortLabel(id) };
  }

  const cached = actorLabels.get(raw);
  if (cached) return { id: raw, label: cached };
  return { id: raw, label: isUuid(raw) ? shortLabel(raw) : raw };
}

function shortLabel(id: string) {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

export function withActorLabel<T extends { createdBy?: string | null }>(
  row: T,
): T & { createdBy: string | null; createdByName: string } {
  const decoded = decodeActor(row.createdBy);
  return {
    ...row,
    createdBy: decoded.id,
    createdByName: decoded.label,
  };
}
