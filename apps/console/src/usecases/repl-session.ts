export function createReplSessionId(): string {
  return `sess-${Math.random().toString(36).slice(2, 9)}`;
}

export function createReplTurnId(): string {
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function followUpRequestKey(turnId: string, followupId: string): string {
  return `${turnId}:${followupId}`;
}

export function belongsToTurnRequest(key: string, turnId: string): boolean {
  return key === turnId || key.startsWith(`${turnId}:`);
}
