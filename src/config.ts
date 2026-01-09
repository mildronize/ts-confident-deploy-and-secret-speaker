// -------------------------
// 1) Inputs / constants
// -------------------------
export const location = "southeastasia";

export const resourceGroupName = "rg-northern-tech-workshop";
export const containerEnvName = "env-ntotr-shared";
export const sharedKeyVaultName = "kv-ntotr-shared";

// Audience list as const (array of objects)
export const audiences = [
  { email: "alice@example.com", displayName: "Alice" },
  { email: "bob@example.com", displayName: "Bob W." },
  // { email: "charlie@example.com", displayName: "Charlie-DevOps" },
] as const;
