import { useEffect, useState } from "react";

export type UtcClock = {
  now: Date;
  utc: string;
  date: string;
};

export function useUtcClock(): UtcClock {
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const iso = now.toISOString();
  return { now, utc: iso.slice(11, 19), date: iso.slice(0, 10) };
}
