export function withPaimonSenderName(sender: string): string {
  const addressStart = sender.indexOf("<");
  if (addressStart < 0) return sender;

  const displayName = sender.slice(0, addressStart);
  if (!/\bnireq\b/i.test(displayName)) return sender;

  return `${displayName.replace(/\bnireq\b/gi, "Paimon")}${sender.slice(addressStart)}`;
}
