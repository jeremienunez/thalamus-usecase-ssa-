import React from "react";
import { Box } from "ink";
interface Props { children: React.ReactNode }
export function ScrollView({ children }: Props): React.JSX.Element {
  return <Box flexDirection="column" flexGrow={1}>{children}</Box>;
}
