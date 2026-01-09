for shared key vault access

```bash
az ad sp create-for-rbac --name "sp-ntotr-keyvault-secret" --role 'Key Vault Administrator' --scopes /subscriptions/0c249ac1-38ac-4cb4-a429-8b1448de6d8e/resourceGroups/rg-northern-tech-workshop/providers/Microsoft.KeyVault/vaults/kv-ntotr-shared --sdk-auth
```