import pc from "picocolors";

export type SourceClass = "FIELD" | "OSINT" | "SIM";

export const colorFor = (c: SourceClass): ((s: string) => string) => {
  switch (c) {
    case "FIELD":
      return pc.green;
    case "OSINT":
      return pc.yellow;
    case "SIM":
      return pc.gray;
  }
};

export const bar = (level: number): string => {
  const chars = "▁▂▃▄▅▆▇█";
  const idx = Math.max(0, Math.min(chars.length - 1, Math.round(level * (chars.length - 1))));
  return chars[idx];
};
