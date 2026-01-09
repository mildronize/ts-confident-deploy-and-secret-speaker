import * as azure from "@pulumi/azure-native";
import * as azuread from "@pulumi/azuread";
import * as random from "@pulumi/random";

// Import from your infra file
import { audiencesList, sharedKeyVaultId, containerAppIdsByEmail, resourceGroupId, containerEnvId } from "./index";

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

// Cloud Application Administrator (Directory Role) assignment 
invitedUsers.forEach((u) => {
  new azuread.DirectoryRoleAssignment(`dirrole-${u.email.replace(/[^a-zA-Z0-9]/g, "-")}`, {
    roleId: "158c047a-c907-4556-b7ef-446551a6b5f7", // Cloud Application Administrator Role Object ID
    principalObjectId: u.invitedUserId,
  });
});

// -------------------------
// 2) RBAC: Everyone is Reader on the Resource Group
// roleDefinitionId: Reader
// -------------------------
invitedUsers.forEach((u) => {
  const guid = new random.RandomUuid(`rg-reader-${u.email.replace(/[^a-zA-Z0-9]/g, "-")}`).result;

  new azure.authorization.RoleAssignment(`rg-reader-${u.email.replace(/[^a-zA-Z0-9]/g, "-")}`, {
    roleAssignmentName: guid,
    principalId: u.invitedUserId,
    principalType: "User",
    roleDefinitionId: "/providers/Microsoft.Authorization/roleDefinitions/acdd72a7-3385-48ef-bd42-f606fba81ae7", // Reader
    scope: resourceGroupId,
  });
});

// -------------------------
// 3) RBAC: Give ALL users access to shared Key Vault (Key Vault Administrator) [unchanged]
// -------------------------
invitedUsers.forEach((u) => {
  const guid = new random.RandomUuid(`kv-ra-${u.email.replace(/[^a-zA-Z0-9]/g, "-")}`).result;

  new azure.authorization.RoleAssignment(`kv-ra-${u.email.replace(/[^a-zA-Z0-9]/g, "-")}`, {
    roleAssignmentName: guid,
    principalId: u.invitedUserId,
    principalType: "User",
    roleDefinitionId: "/providers/Microsoft.Authorization/roleDefinitions/00482a5a-887f-4fb3-b363-3b7fe8e74483", // Key Vault Administrator
    scope: sharedKeyVaultId,
  });
});

// -------------------------
// 4) RBAC: Give EACH user access to their own Container App [unchanged]
// -------------------------
invitedUsers.forEach((u) => {
  const appScope = containerAppIdsByEmail[u.email];
  if (!appScope) return;

  const guid = new random.RandomUuid(`app-ra-${u.email.replace(/[^a-zA-Z0-9]/g, "-")}`).result;

  new azure.authorization.RoleAssignment(`app-ra-${u.email.replace(/[^a-zA-Z0-9]/g, "-")}`, {
    roleAssignmentName: guid,
    principalId: u.invitedUserId,
    principalType: "User",
    roleDefinitionId: "/providers/Microsoft.Authorization/roleDefinitions/8e3af657-a8ff-443c-a75c-2fe8c4bcb635", // Owner (as you set)
    // roleDefinitionId: "/providers/Microsoft.Authorization/roleDefinitions/b24988ac-6180-42a0-ab88-20f7382dd24c", // Contributor
    scope: appScope,
  });
});

// -------------------------
// 5) RBAC: Everyone is Contributor on the Container App Environment
// (use id in code -> containerEnvId)
// -------------------------
invitedUsers.forEach((u) => {
  const guid = new random.RandomUuid(`env-contrib-${u.email.replace(/[^a-zA-Z0-9]/g, "-")}`).result;

  new azure.authorization.RoleAssignment(`env-contrib-${u.email.replace(/[^a-zA-Z0-9]/g, "-")}`, {
    roleAssignmentName: guid,
    principalId: u.invitedUserId,
    principalType: "User",
    roleDefinitionId: "/providers/Microsoft.Authorization/roleDefinitions/b24988ac-6180-42a0-ab88-20f7382dd24c", // Contributor
    scope: containerEnvId,
  });
});

// Optional outputs
export const invited = invitedUsers.map((u) => ({
  email: u.email,
  displayName: u.displayName,
  invitedUserId: u.invitedUserId,
}));