export function generatedAvatar(name: string | null | undefined, email = "") {
  const label = name?.trim() || email.split("@")[0] || "T";
  const initials = label.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "T";
  let hash = 0;
  for (const char of `${label}|${email}`) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return { initials, color: `hsl(${hash % 360} 42% 42%)` };
}
