const memoryStore = new Map<string, number>();
export async function checkCooldown(symbol: string) { const last = memoryStore.get(symbol); return !!last && Date.now() - last < 4 * 60 * 60 * 1000; }
export async function recordAlert(symbol: string) { memoryStore.set(symbol, Date.now()); }
