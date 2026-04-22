import type { SimGodInjectResultDto } from "@interview/shared/dto/sim-god-channel.dto";

export function toSimGodInjectResultDto(
  r: { simTurnId: bigint },
): SimGodInjectResultDto {
  return { simTurnId: r.simTurnId.toString() };
}
