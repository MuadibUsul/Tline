import type { MacroProvider } from "../types";
import { createBeaProvider } from "./bea";
import { createBlsProvider } from "./bls";
import { createEiaProvider } from "./eia";
import { createEcbProvider } from "./ecb";
import { createEurostatProvider } from "./eurostat";
import { createFomcStatementProvider } from "./fomc";
import { createFredProvider } from "./fred";
import { createWpsrProvider } from "./wpsr";

export const macroProviderFactories: Record<string, () => MacroProvider> = {
  bls: createBlsProvider,
  bea: createBeaProvider,
  eia: createEiaProvider,
  ecb: createEcbProvider,
  eurostat: createEurostatProvider,
  fred: createFredProvider,
  "eia-wpsr": createWpsrProvider,
  "fomc-statement": createFomcStatementProvider,
};

export function createMacroProvider(name: string): MacroProvider {
  const factory = macroProviderFactories[name.toLowerCase()];
  if (!factory) throw new Error(`Unknown macro provider: ${name}.`);
  return factory();
}
