import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
interface Props { onSubmit: (s: string) => void; busy: boolean }
export function Prompt({ onSubmit, busy }: Props): React.JSX.Element {
  const [value, setValue] = useState("");
  useInput((input, key) => {
    if (busy) return;
    if (key.return) { onSubmit(value); setValue(""); return; }
    if (key.backspace || key.delete) { setValue((v) => v.slice(0, -1)); return; }
    if (!key.ctrl && !key.meta) setValue((v) => v + input);
  });
  return (
    <Box>
      <Text color="cyan">{busy ? "… " : "› "}</Text>
      <Text>{value}</Text>
    </Box>
  );
}
