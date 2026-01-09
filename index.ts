import * as pulumi from "@pulumi/pulumi";
import * as azure from "@pulumi/azure-native";

// -------------------------
// 1) Inputs / constants
// -------------------------
const location = "southeastasia";

const resourceGroupName = "rg-northern-tech-workshop";
const containerEnvName = "env-ntotr-shared";

// Audience list as const (array of objects)
const audiences = [
  { email: "alice@example.com", displayName: "Alice" },
  { email: "bob@example.com", displayName: "Bob W." },
  // { email: "charlie@example.com", displayName: "Charlie-DevOps" },
] as const;

// -------------------------
// 2) Helpers
// -------------------------
function toAzureSlug(input: string, maxLen: number): string {
  // Lowercase, replace non-alphanumeric with '-', collapse '-', trim '-'
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  // Ensure not empty
  const safe = slug.length ? slug : "user";

  // Trim to max length (Azure resources often have name length limits)
  return safe.slice(0, maxLen);
}

// Key Vault name rules: 3-24 chars, alphanumeric and '-' allowed, must start with letter,
// but in practice safest is: lowercase letters+numbers only (avoid hyphen to be safe across rules)
// We'll make a conservative kv slug: letters+numbers only, 3-24 chars
function toKeyVaultName(displayName: string): string {
  const base = `kv-ntotr-${displayName}`.toLowerCase();
  const cleaned = base.replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
  // Many orgs keep KV without '-' for maximum compatibility:
  const ultraSafe = cleaned.replace(/-/g, "");
  const trimmed = ultraSafe.slice(0, 24);
  // Ensure starts with a letter and at least 3 chars
  const startFixed = /^[a-z]/.test(trimmed) ? trimmed : `k${trimmed}`;
  return (startFixed.length < 3 ? (startFixed + "xxx").slice(0, 3) : startFixed) as string;
}

function toContainerAppName(displayName: string): string {
  // Container App name can include '-' and is fairly permissive, still keep it clean
  return toAzureSlug(`app-ntotr-${displayName}`, 32);
}

// -------------------------
// 3) Shared resources
// -------------------------
const rg = new azure.resources.ResourceGroup("rg", {
  resourceGroupName,
  location,
}, {
  protect: true, // prevent accidental deletion of workshop RG
});

// Shared Container App Environment (one for all audiences)
const logAnalytics = new azure.operationalinsights.Workspace("log", {
  resourceGroupName: rg.name,
  location: rg.location,
  sku: { name: "PerGB2018" },
  retentionInDays: 30,
});

// Container App Env needs a Log Analytics "customerId" + shared key
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

// -------------------------
// 4) Per-audience resources
// -------------------------
const tenantConfig = azure.authorization.getClientConfigOutput({});

type AudienceOutputs = {
  email: string;
  displayName: string;
  containerAppName: pulumi.Output<string>;
  keyVaultName: pulumi.Output<string>;
};

const results: AudienceOutputs[] = audiences.map((a) => {
  const slug = toAzureSlug(a.displayName, 24);

  const containerAppName = toContainerAppName(a.displayName);
  const keyVaultName = toKeyVaultName(a.displayName);

  // Key Vault
  const kv = new azure.keyvault.Vault(`kv-${slug}`, {
    resourceGroupName: rg.name,
    vaultName: keyVaultName,
    location: rg.location,
    properties: {
      tenantId: tenantConfig.tenantId,
      sku: { family: "A", name: "standard" },
      enableRbacAuthorization: true, // keep simple; RBAC-managed access
      publicNetworkAccess: "Enabled",
      // softDelete, purgeProtection defaults vary; keep defaults unless you need specifics
    },
  });

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
    keyVaultName: kv.name,
  };
});

// -------------------------
// 5) Stack outputs (for workshop visibility)
// -------------------------
export const shared = {
  resourceGroupName: rg.name,
  containerEnvName: caEnv.name,
  location: rg.location,
};

// Handy: map outputs by email
export const audienceResources = results.map((r) => ({
  email: r.email,
  displayName: r.displayName,
  containerAppName: r.containerAppName,
  keyVaultName: r.keyVaultName,
}));
