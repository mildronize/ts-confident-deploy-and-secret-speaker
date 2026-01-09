import * as pulumi from "@pulumi/pulumi";
import * as azure from "@pulumi/azure-native";
import { location, audiences, containerEnvName, resourceGroupName, sharedKeyVaultName } from "./config";


// -------------------------
// 2) Helpers
// -------------------------
function toAzureSlug(input: string, maxLen: number): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  const safe = slug.length ? slug : "user";
  return safe.slice(0, maxLen);
}

function toContainerAppName(displayName: string): string {
  return toAzureSlug(`app-ntotr-${displayName}`, 32);
}

// -------------------------
// 3) Shared resources
// -------------------------
const rg = new azure.resources.ResourceGroup(
  "rg",
  { resourceGroupName, location },
  { protect: true } // prevent accidental deletion of workshop RG
);

// Shared Container App Environment
const logAnalytics = new azure.operationalinsights.Workspace("log", {
  resourceGroupName: rg.name,
  location: rg.location,
  sku: { name: "PerGB2018" },
  retentionInDays: 30,
});

const sharedKeys = azure.operationalinsights.getSharedKeysOutput({
  resourceGroupName: rg.name,
  workspaceName: logAnalytics.name,
});

if (!sharedKeys.primarySharedKey) {
  throw new Error("Log Analytics primarySharedKey is undefined. Check workspace keys/permissions.");
}

const logAnalyticsSharedKey = sharedKeys.primarySharedKey.apply((k) => {
  if (!k) throw new Error("Log Analytics primarySharedKey is undefined. Check workspace keys/permissions.");
  return k;
});

const caEnv = new azure.app.ManagedEnvironment("env", {
  resourceGroupName: rg.name,
  location: rg.location,
  environmentName: containerEnvName,
  appLogsConfiguration: {
    destination: "log-analytics",
    logAnalyticsConfiguration: {
      customerId: logAnalytics.customerId,
      sharedKey: logAnalyticsSharedKey,
    },
  },
});

// Shared Key Vault (one for all audiences)
const tenantConfig = azure.authorization.getClientConfigOutput({});

const sharedKv = new azure.keyvault.Vault("kv-shared", {
  resourceGroupName: rg.name,
  vaultName: sharedKeyVaultName,
  location: rg.location,
  properties: {
    tenantId: tenantConfig.tenantId,
    sku: { family: "A", name: "standard" },
    enableRbacAuthorization: true, // RBAC model
    publicNetworkAccess: "Enabled",
  },
});

// -------------------------
// 4) Per-audience resources
// -------------------------
type AudienceOutputs = {
  email: string;
  displayName: string;
  containerAppName: pulumi.Output<string>;
  keyVaultName: pulumi.Output<string>;
  appId: pulumi.Output<string>;
};

const results: AudienceOutputs[] = audiences.map((a) => {
  const slug = toAzureSlug(a.displayName, 24);
  const containerAppName = toContainerAppName(a.displayName);

  // Azure Container App (basic demo container)
  const app = new azure.app.ContainerApp(`app-${slug}`, {
    resourceGroupName: rg.name,
    containerAppName,
    location: rg.location,
    managedEnvironmentId: caEnv.id,
    configuration: {
      ingress: {
        external: true,
        targetPort: 80,
        transport: "auto",
      },
    },
    template: {
      containers: [
        {
          name: "web",
          image: "mcr.microsoft.com/azuredocs/containerapps-helloworld:latest",
          resources: { cpu: 0.25, memory: "0.5Gi" },
        },
      ],
      scale: { minReplicas: 0, maxReplicas: 1 },
    },
    tags: {
      audienceEmail: a.email,
      audienceName: a.displayName,
      workshop: "northern-tech",
    },
  });

  return {
    email: a.email,
    displayName: a.displayName,
    containerAppName: app.name,
    keyVaultName: sharedKv.name,
    appId: app.id,
  };
});

// -------------------------
// 5) Stack outputs (for workshop visibility)
// -------------------------
export const shared = {
  resourceGroupName: rg.name,
  containerEnvName: caEnv.name,
  keyVaultName: sharedKv.name,
  location: rg.location,
};

export const audienceResources = results.map((r) => ({
  email: r.email,
  displayName: r.displayName,
  containerAppName: r.containerAppName,
  keyVaultName: r.keyVaultName,
}));


// // export audiences for access control
// export const audiencesList = audiences;

// // export shared resources for access control
// export const sharedKeyVaultId = sharedKv.id;

// // Map each audience email -> Container App resource ID
// export const containerAppIdsByEmail = results.reduce(
//   (acc, r) => {
//     acc[r.email] = (r as any).appId; // we’ll set appId below
//     return acc;
//   },
//   {} as Record<string, pulumi.Output<string>>
// );

export const resourceGroupId = rg.id;
export const containerEnvId = caEnv.id;

export const audiencesList = audiences;
export const sharedKeyVaultId = sharedKv.id;

// email -> Container App resource id
export const containerAppIdsByEmail = results.reduce((acc, r) => {
  acc[r.email] = r.appId; // make sure results includes appId: app.id
  return acc;
}, {} as Record<string, pulumi.Output<string>>);
