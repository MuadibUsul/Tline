/** Server-side switches for the registration experiment. */
export function registrationGateEnabled() {
  return process.env.REG_GATE_ENABLED !== "false";
}

export function registrationNudgeEnabled() {
  return process.env.REG_NUDGE_ENABLED === "true";
}

/** Percentage of sessions that may see the in-flow prompt once the experiment is enabled. */
export function registrationNudgeRollout() {
  const value = Number(process.env.REG_NUDGE_ROLLOUT ?? "10");
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 10;
}
