/**
 * Encode a collision-free identity for one feed assembly context.
 * @param kind - definition identity.
 * @param id - definition-local identity.
 * @returns the stable context key.
 */
export function conversationContextKey(kind: string, id: string): string {
  return `${kind.length}:${kind}${id}`
}
