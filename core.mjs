export function totals(rows) {
  let production = 0n, root = 0n;
  for (const row of rows) {
    const count = BigInt(row.count), roots = BigInt(row.rootCount);
    if (count < 0n || roots < 0n || roots > count) throw new Error('INVALID_COUNTER');
    production += count; root += roots;
  }
  return { production: String(production), root: String(root), nonRoot: String(production - root) };
}
export function difference(previous, current) {
  if (!previous) return { state: 'baseline', production: null, root: null };
  const next = new Map(current.map(r => [String(r.id), r]));
  for (const before of previous) {
    const after = next.get(String(before.id));
    if (!after || after.name !== before.name || after.workflowId !== before.workflowId ||
        BigInt(after.count) < BigInt(before.count) || BigInt(after.rootCount) < BigInt(before.rootCount)) {
      return { state: 'discontinuity', production: null, root: null };
    }
  }
  const a = totals(previous), b = totals(current);
  return { state: 'observed', production: String(BigInt(b.production) - BigInt(a.production)), root: String(BigInt(b.root) - BigInt(a.root)) };
}
export function identifier(value) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) throw new Error('INVALID_DB_IDENTIFIER');
  return '"' + value + '"';
}
