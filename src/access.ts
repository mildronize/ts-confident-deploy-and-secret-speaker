import * as pulumi from "@pulumi/pulumi";
import * as azure from "@pulumi/azure-native";
import * as azuread from "@pulumi/azuread";
import * as random from "@pulumi/random";

// Import from your infra file (adjust path if needed)
import { audiencesList, sharedKeyVaultId, containerAppIdsByEmail } from "./index";

// -------------------------
// Role names you want
// -------------------------
const DIRECTORY_ROLE_NAME = "Cloud Application Administrator";
const KV_RBAC_ROLE_NAME = "Key Vault Contributor";
const APP_RBAC_ROLE_NAME = "Contributor";

// -------------------------
// Helpers
// -------------------------
function mustFindDirectoryRoleObjectId(
  roles: Array<{ displayName?: string; objectId?: string }>,
  displayName: string
): string {
  const role = roles.find((r) => (r.displayName ?? "").toLowerCase() === displayName.toLowerCase());
  const id = role?.objectId;
  if (!id) {
    throw new Error(
      `Directory role not found or missing objectId: "${displayName}". Make sure the role is enabled in Entra ID.`
    );
  }
  return id;
}

// function mustFindRoleDefinitionId(
//   defs: Array<{ roleName?: string; id?: string }>,
//   roleName: string
// ): string {
//   const def = defs.find((d) => (d.roleName ?? "").toLowerCase() === roleName.toLowerCase());
//   const id = def?.id;
//   if (!id) {
//     throw new Error(`RBAC role definition not found: "${roleName}".`);
//   }
//   return id;
// }

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

// -------------------------
// 2) Assign Directory Role (tenant-level): Cloud Application Administrator
//    NOTE: This requires Entra/Graph permissions.
// -------------------------
const directoryRoles = azuread.getDirectoryRolesOutput({});

const cloudAppAdminRoleObjectId = directoryRoles.roles.apply((roles) =>
  mustFindDirectoryRoleObjectId(roles, DIRECTORY_ROLE_NAME)
);

invitedUsers.forEach((u) => {
  new azuread.DirectoryRoleMember(`dirrole-${u.email.replace(/[^a-zA-Z0-9]/g, "-")}`, {
    roleObjectId: cloudAppAdminRoleObjectId,
    memberObjectId: u.invitedUserId,
  });
});

// -------------------------
// 3) RBAC: Give ALL users access to shared Key Vault (Key Vault Contributor)
// 4) RBAC: Give EACH user access to their own Container App (Contributor)
// -------------------------
const client = azure.authorization.getClientConfigOutput({});
const subscriptionScope = pulumi.interpolate`/subscriptions/${client.subscriptionId}`;

// Get role definition IDs by name (no hard-coded GUIDs)
// const kvRoleDefs = azure.authorization.getRoleDefinitionOutput({
//   scope: subscriptionScope,
//   roleDefinitionId: "00482a5a-887f-4fb3-b363-3b7fe8e74483", // Built-in Key Vault Administrator
//   // filter: `roleName eq '${KV_RBAC_ROLE_NAME}'`,
// });

// const appRoleDefs = azure.authorization.getRoleDefinitionOutput({
//   scope: subscriptionScope,
//   roleDefinitionId: "b24988ac-6180-42a0-ab88-20f7382dd24c", // Built-in Contributor role
//   // filter: `roleName eq '${APP_RBAC_ROLE_NAME}'`,
// });

// const kvRoleDefinitionId = kvRoleDefs..apply((defs) =>
//   mustFindRoleDefinitionId(defs, KV_RBAC_ROLE_NAME)
// );

// const appRoleDefinitionId = appRoleDefs.roleDefinitions.apply((defs) =>
//   mustFindRoleDefinitionId(defs, APP_RBAC_ROLE_NAME)
// );

// Key Vault role assignment for everyone
invitedUsers.forEach((u) => {
  const guid = new random.RandomUuid(`kv-ra-${u.email}`).result;

  new azure.authorization.RoleAssignment(`kv-ra-${u.email.replace(/[^a-zA-Z0-9]/g, "-")}`, {
    roleAssignmentName: guid,
    principalId: u.invitedUserId,
    principalType: "User",
    // roleDefinitionId: kvRoleDefinitionId,
    roleDefinitionId: "00482a5a-887f-4fb3-b363-3b7fe8e74483", // Built-in Key Vault Administrator
    scope: sharedKeyVaultId,
  });
});

// Container App role assignment per person
invitedUsers.forEach((u) => {
  const appScope = containerAppIdsByEmail[u.email];
  if (!appScope) return;

  const guid = new random.RandomUuid(`app-ra-${u.email}`).result;

  new azure.authorization.RoleAssignment(`app-ra-${u.email.replace(/[^a-zA-Z0-9]/g, "-")}`, {
    roleAssignmentName: guid,
    principalId: u.invitedUserId,
    principalType: "User",
    roleDefinitionId: "b24988ac-6180-42a0-ab88-20f7382dd24c", // Built-in Contributor role
    scope: appScope,
  });
});

// Optional outputs
export const invited = invitedUsers.map((u) => ({
  email: u.email,
  displayName: u.displayName,
  invitedUserId: u.invitedUserId,
}));
