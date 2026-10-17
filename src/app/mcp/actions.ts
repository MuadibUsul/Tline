"use server";
import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { generateToken, hashToken, parseScopes, tokenPrefix } from "@/lib/apiKeys";
import { writeAudit } from "@/lib/audit";

/**
 * Self-service User MCP keys.
 *
 * The User MCP is open to registered accounts, so the key is issued here rather than by an
 * operator. A key is bound to the account that created it (`createdById`), carries only
 * `mcp:user`, and can be revoked by that account. The secret is returned once, exactly like
 * the console's key issuance.
 */
export interface McpKeyState {
  error?: string;
  token?: string;
  name?: string;
}

const MAX_ACTIVE_KEYS = 5;

export async function createMyMcpKey(_previous: McpKeyState, formData: FormData): Promise<McpKeyState> {
  const user = await getSessionUser();
  if (!user) return { error: "请先登录。" };
  const name = (formData.get("name")?.toString().trim() || "MCP client").slice(0, 80);

  const existing = await prisma.apiKey.findMany({
    where: { createdById: user.id, revokedAt: null },
    select: { scopes: true },
  });
  const active = existing.filter((key) => parseScopes(key.scopes).includes("mcp:user")).length;
  if (active >= MAX_ACTIVE_KEYS) return { error: `最多保留 ${MAX_ACTIVE_KEYS} 把 MCP 密钥，请先吊销不用的。` };

  const token = generateToken();
  const key = await prisma.apiKey.create({
    data: {
      name,
      prefix: tokenPrefix(token),
      tokenHash: hashToken(token),
      secret: token,
      scopes: JSON.stringify(["mcp:user"]),
      rateLimit: 60,
      createdById: user.id,
    },
    select: { id: true },
  });
  await writeAudit({
    actorId: user.id,
    action: "apikey.create",
    targetType: "apiKey",
    targetId: key.id,
    metadata: { name, scopes: ["mcp:user"], rateLimit: 60, selfService: "mcp" },
  });
  revalidatePath("/mcp");
  return { token, name };
}

export async function revokeMyMcpKey(formData: FormData) {
  const user = await getSessionUser();
  const id = formData.get("id")?.toString();
  if (!user || !id) return;
  const key = await prisma.apiKey.findFirst({
    where: { id, createdById: user.id, revokedAt: null },
    select: { id: true, name: true, scopes: true },
  });
  if (!key) return;
  const scopes = parseScopes(key.scopes);
  // Self-service covers the User MCP only; an operator-issued key with any other scope is
  // revoked in the console, not from here.
  if (scopes.length !== 1 || scopes[0] !== "mcp:user") return;
  await prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
  await writeAudit({ actorId: user.id, action: "apikey.revoke", targetType: "apiKey", targetId: id, metadata: { name: key.name, selfService: "mcp" } });
  revalidatePath("/mcp");
}
