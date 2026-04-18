export interface InjectResultDto {
  simTurnId: string;
}

export function toInjectResultDto(r: { simTurnId: bigint }): InjectResultDto {
  return { simTurnId: r.simTurnId.toString() };
}
