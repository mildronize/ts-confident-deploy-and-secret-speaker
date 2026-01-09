import * as pulumi from "@pulumi/pulumi";
import * as azure from "@pulumi/azure-native";
import * as azuread from "@pulumi/azuread";
import * as random from "@pulumi/random";

// Import from your infra file (adjust path if needed)
import { audiencesList, sharedKeyVaultId, containerAppIdsByEmail } from "./index";

// -------------------------
// 1) Invite each audience as guest user
// -------------------------
const invitedUsers = audiencesList.map((a) => {
  const inv = new azuread.Invitation(`invite-${a.email.replace(/[^a-zA-Z0-9]/g, "-")}`, {
    userEmailAddress: a.email,
    redirectUrl: "https://myapps.microsoft.com",
  });

  return { ...a, invitedUserId: inv.userId };
});

invitedUsers.forEach((u) => {
  new azuread.DirectoryRoleAssignment(`dirrole-${u.email.replace(/[^a-zA-Z0-9]/g, "-")}`, {
    roleId: '158c047a-c907-4556-b7ef-446551a6b5f7', // Cloud Application Administrator Role Object ID
    principalObjectId: u.invitedUserId,
  });
});

// -------------------------
// 3) RBAC: Give ALL users access to shared Key Vault (Key Vault Contributor)
// 4) RBAC: Give EACH user access to their own Container App (Contributor)
// -------------------------

// Key Vault role assignment for everyone
invitedUsers.forEach((u) => {
  const guid = new random.RandomUuid(`kv-ra-${u.email.replace(/[^a-zA-Z0-9]/g, "-")}`).result;

  new azure.authorization.RoleAssignment(`kv-ra-${u.email.replace(/[^a-zA-Z0-9]/g, "-")}`, {
    roleAssignmentName: guid,
    principalId: u.invitedUserId,
    principalType: "User",
    roleDefinitionId: "/providers/Microsoft.Authorization/roleDefinitions/00482a5a-887f-4fb3-b363-3b7fe8e74483", // Built-in Key Vault Administrator
    scope: sharedKeyVaultId,
  });
});

// Container App role assignment per person
invitedUsers.forEach((u) => {
  const appScope = containerAppIdsByEmail[u.email];
  if (!appScope) return;

  const guid = new random.RandomUuid(`app-ra-${u.email.replace(/[^a-zA-Z0-9]/g, "-")}`).result;

  new azure.authorization.RoleAssignment(`app-ra-${u.email.replace(/[^a-zA-Z0-9]/g, "-")}`, {
    roleAssignmentName: guid,
    principalId: u.invitedUserId,
    principalType: "User",
    roleDefinitionId: "/providers/Microsoft.Authorization/roleDefinitions/b24988ac-6180-42a0-ab88-20f7382dd24c", // Built-in Contributor role
    scope: appScope,
  });
});

// Optional outputs
export const invited = invitedUsers.map((u) => ({
  email: u.email,
  displayName: u.displayName,
  invitedUserId: u.invitedUserId,
}));
