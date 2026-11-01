/**
 * Server Naming Utility
 * Enforces authoritative uniqueness of server names per customer account.
 */

/**
 * Checks if a server name is already in use by another server on the same user account.
 * Comparison is trimmed and case-insensitive.
 */
export async function checkServerNameConflict(
  prisma: any,
  userId: string,
  targetName: string,
  excludeServerId?: string
): Promise<boolean> {
  const normalized = targetName.trim().toLowerCase();
  if (!normalized) return false;

  const existingServers = await prisma.serverInstance.findMany({
    where: {
      device: { userId },
      ...(excludeServerId ? { id: { not: excludeServerId } } : {})
    },
    select: { serverName: true }
  });

  return existingServers.some(
    (s: { serverName: string | null }) => (s.serverName || '').trim().toLowerCase() === normalized
  );
}

/**
 * Resolves a guaranteed unique server name for the given user account.
 * If the requested name already exists on another server of the user,
 * it generates an incremental suffix: "Name (2)", "Name (3)", etc.
 */
export async function resolveUniqueServerName(
  prisma: any,
  userId: string,
  desiredName: string,
  excludeServerId?: string
): Promise<string> {
  const trimmed = desiredName.trim() || 'Server Node';

  const existingServers = await prisma.serverInstance.findMany({
    where: {
      device: { userId },
      ...(excludeServerId ? { id: { not: excludeServerId } } : {})
    },
    select: { serverName: true }
  });

  const existingNames = new Set(
    existingServers
      .map((s: { serverName: string | null }) => (s.serverName || '').trim().toLowerCase())
      .filter(Boolean)
  );

  if (!existingNames.has(trimmed.toLowerCase())) {
    return trimmed;
  }

  // Extract base name if it already has a trailing (N)
  const match = trimmed.match(/^(.*?)\s*\((\d+)\)$/);
  const baseName = match ? match[1].trim() : trimmed;
  let counter = match ? parseInt(match[2], 10) + 1 : 2;

  while (existingNames.has(`${baseName} (${counter})`.toLowerCase())) {
    counter++;
  }

  return `${baseName} (${counter})`;
}
