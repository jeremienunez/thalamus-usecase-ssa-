import { useEffect, useState } from "react";

type Props = {
  value: unknown;
  onChange: (v: unknown) => void;
};

export function JsonTextarea({ value, onChange }: Props) {
  const [raw, setRaw] = useState(() => JSON.stringify(value, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);

  useEffect(() => {
    setRaw(JSON.stringify(value, null, 2));
    setParseError(null);
  }, [value]);

  function commit(text: string) {
    try {
      const parsed = text.trim() === "" ? {} : JSON.parse(text);
      setParseError(null);
      onChange(parsed);
    } catch (err) {
      setParseError((err as Error).message);
    }
  }

  return (
    <div className="space-y-1">
      <textarea
        className="w-full min-h-[100px] bg-black/40 border border-hairline px-2 py-1 mono text-caption text-primary focus:border-cyan focus:outline-none resize-y"
        value={raw}
        spellCheck={false}
        onChange={(e) => {
          setRaw(e.target.value);
          commit(e.target.value);
        }}
      />
      {parseError && (
        <div className="text-caption text-hot">JSON: {parseError}</div>
      )}
    </div>
  );
}
