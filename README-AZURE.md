---
description: Run and deploy the Foundry cost planner on Azure App Service.
---

# Deploy the Foundry cost calculator to Azure App Service

Verified against Microsoft documentation on 22 October 2026.

Use a **Linux App Service with a supported Node.js LTS runtime**. The supplied Node server serves the calculator's HTML, CSS, JavaScript, price JSON and images. The calculations continue to run in the browser. This deployment hosts the calculator; it does not provision the Azure Foundry models or the cloud and on-premises services represented by the architecture.

## Configured Azure target

| Setting | Value |
| --- | --- |
| Subscription | Visual Studio Enterprise Subscription |
| Resource group | `rg-foundry-cost-planner` |
| App | `foundry-cost-planner-kvenk` |
| URL | <https://foundry-cost-planner-kvenk.azurewebsites.net> |
| Region | Central US |
| Existing shared plan | `plan-wp-centralus-97549` (Linux B1) |
| Plan resource group | `rg-wp-webapp-centralus-97549` |
| Runtime and startup | Node 24 LTS; `node server.cjs` |
| Access | Public, HTTPS-only; no sign-in required |

The app reuses the existing plan rather than provisioning another paid plan.
It shares that plan's CPU and memory with the existing website. Always On is
enabled, TLS 1.2 is the minimum for both app and deployment endpoints, and FTP
and basic deployment authentication are disabled.

For updates, package the files as described below and use `az webapp deploy`
with the app and resource group above. The new-plan commands in section 3 are
examples for a separate deployment, not prerequisites for updating this app.

## 1. Prepare the deployment package

The ZIP must contain these paths directly at its root:

| ZIP path | Purpose |
| --- | --- |
| `server.cjs` | Dependency-free static server supplied with this guide |
| `package.json` | Node runtime and start command |
| `dist/index.html` | Calculator page |
| `dist/...` | All calculator JavaScript, CSS, JSON, images and other assets, preserving their existing relative paths |

Do not wrap these files in an extra project directory inside the ZIP. App Service extracts a Linux ZIP deployment into `/home/site/wwwroot`. The web server reads only its `dist/` directory. [1]

Use the supplied `server.cjs`. It binds to `0.0.0.0` and uses `process.env.PORT`, which App Service supplies. It accepts GET and HEAD, returns 404 for unknown paths, rejects directory traversal and does not expose the package or server source. [2]

Example `package.json`, for Node 24 LTS after verifying it in step 2:

```json
{
  "name": "foundry-cost-calculator",
  "version": "1.0.0",
  "private": true,
  "engines": { "node": "24.x" },
  "scripts": { "start": "node server.cjs" }
}
```

The host has no npm dependencies, so no npm install or remote build is needed. If you choose another supported Node LTS major, update `engines.node` to match before packaging.

From the directory containing `server.cjs`, `package.json` and `dist/`, create the ZIP:

```bash
zip -r ../foundry-cost-planner-app-service.zip server.cjs package.json dist
```

On PowerShell, the equivalent is:

```powershell
Compress-Archive -Path server.cjs,package.json,dist -DestinationPath ..\foundry-cost-planner-app-service.zip -Force
```

For a local smoke test, run `node server.cjs` and open `http://localhost:8080`. There is no build command.

## 2. Sign in and choose an available Node LTS runtime

Use a current Azure CLI in Bash, or Azure Cloud Shell in Bash. Upload the prepared ZIP if using Cloud Shell. Select the subscription in which you intend to pay for hosting:

```bash
az login
az account set --subscription "YOUR-SUBSCRIPTION-ID"
az version
az webapp list-runtimes --os-type linux --runtime node --support active --output table
```

Choose a currently supported Node LTS version shown by the command. Microsoft's Node configuration guide currently illustrates Node 24 LTS. Use `NODE:24-lts` below only if the runtime list confirms it; otherwise substitute the supported LTS version you selected. The create command uses `Framework:Version` syntax; the equivalent low-level Linux configuration uses a pipe, for example `NODE|24-lts`. [2][3]

Azure CLI 2.87 and later return structured objects from `list-runtimes`. Do not use older scripts that assume a flat string list. Separate `create` and `deploy` commands are the current recommended automation flow. [4]

## 3. Create the App Service resources

These are Bash variables. Replace the subscription above, choose a region, and choose an app name that is available. The example creates **one paid Basic B1 Linux App Service plan**. Confirm its regional price in the Azure portal or pricing calculator before running the create commands. B1 is an example starting size for this lightweight calculator, not a measured capacity guarantee. [5]

```bash
COSTING_RG="rg-foundry-calculator"
COSTING_REGION="eastus2"
COSTING_PLAN="asp-foundry-calculator"
COSTING_APP="YOUR-GLOBALLY-AVAILABLE-APP-NAME"
COSTING_RUNTIME="NODE:24-lts"
COSTING_ZIP="./foundry-cost-planner-app-service.zip"

az group create \
  --name "$COSTING_RG" \
  --location "$COSTING_REGION"

az appservice plan create \
  --resource-group "$COSTING_RG" \
  --name "$COSTING_PLAN" \
  --location "$COSTING_REGION" \
  --is-linux \
  --sku B1

az webapp create \
  --resource-group "$COSTING_RG" \
  --plan "$COSTING_PLAN" \
  --name "$COSTING_APP" \
  --runtime "$COSTING_RUNTIME" \
  --https-only true
```

The CLI plan and web-app references document these parameters. [3][6] If the chosen region has no B1 capacity or your subscription has a quota restriction, select an available region or plan shown by Azure rather than assuming all regions offer the same capacity.

## 4. Configure startup and deploy

```bash
az webapp config set \
  --resource-group "$COSTING_RG" \
  --name "$COSTING_APP" \
  --startup-file "node server.cjs" \
  --always-on true \
  --min-tls-version 1.2

az webapp config appsettings set \
  --resource-group "$COSTING_RG" \
  --name "$COSTING_APP" \
  --settings NODE_ENV=production SCM_DO_BUILD_DURING_DEPLOYMENT=false \
  --output none

az webapp deploy \
  --resource-group "$COSTING_RG" \
  --name "$COSTING_APP" \
  --src-path "$COSTING_ZIP" \
  --type zip

az webapp show \
  --resource-group "$COSTING_RG" \
  --name "$COSTING_APP" \
  --query defaultHostName \
  --output tsv
```

Open `https://` followed by the returned hostname. Read the actual hostname from Azure rather than constructing it from the app name. ZIP deployment restarts the app. An explicit startup command ensures that Azure starts `server.cjs`; build automation stays off because this ZIP is ready to run. [1][2][7]

Always On keeps this paid app loaded between visits. If you deliberately choose a tier that does not support Always On, omit that setting. [7]

## 5. Preserve the intended access level

**The current private ChatGPT Site's authentication does not transfer with the exported files.** Access control must be configured separately on the Azure app. This is a property of the hosting move, not a feature of the calculator's JavaScript.

For an internal calculator, configure this before sharing the new URL:

1. Open the App Service in Azure portal, then **Authentication**.
2. Add **Microsoft** as the identity provider and use your organization's Microsoft Entra tenant / app registration.
3. Select **Require authentication**, with **HTTP 302 redirect** for unauthenticated browser requests.
4. Restrict the allowed tenant and identities or app assignments to the intended audience.
5. Verify in a signed-out / private browser window that the app redirects to sign-in, then verify access using an allowed account. [8]

Authentication and authorization are different: signing in to an allowed tenant does not by itself mean only a selected project team can use the app. Configure the intended user / group assignment or identity restrictions.

The example enables HTTPS-only at creation; Azure performs the public HTTPS termination. The supplied Node host listens on Azure's internal assigned port. No API keys are needed to run this calculator.

## 6. Verify the deployed calculator

After deployment, check the page and its relative assets, the model list and price tables, every navigation tab, changing usage / routing / infrastructure inputs, and CSV / JSON exports. If authentication is enabled, also verify the sign-in and unauthorized-user behavior.

If Azure shows an application error:

```bash
az webapp log config \
  --resource-group "$COSTING_RG" \
  --name "$COSTING_APP" \
  --docker-container-logging filesystem

az webapp log tail \
  --resource-group "$COSTING_RG" \
  --name "$COSTING_APP"
```

Check that `server.cjs` is at the ZIP root, `dist/index.html` exists, the startup command is `node server.cjs`, and the selected Node runtime is still supported. A missing CSS / JS / JSON asset generally means that the ZIP did not preserve the asset's expected relative path. [2]

Recreate the ZIP and repeat `az webapp deploy` for future updates. The included public price snapshot remains a snapshot; deployment does not turn it into live Azure invoice data or automatically refresh rates.

## 7. If the calculator gains a backend

For future server-side calls to Foundry, AI Search, Storage or Key Vault, enable an App Service managed identity and grant the minimum service-specific data permissions. The identity represents the server, not the browser user, and it does not itself add any backend routes or grant permissions. Keep secrets and credentials out of the static `dist/` assets. [9]

```bash
az webapp identity assign \
  --resource-group "$COSTING_RG" \
  --name "$COSTING_APP"
```

App Service provides managed identity to server-side code. If a service requires a secret, use a protected server-side setting / Key Vault reference instead of putting it in browser JavaScript. The current static calculator does not require managed identity. [9][10]

## 8. Deploying the full hybrid AI platform is a separate project

App Service can host a web UI and a suitable cloud API / orchestration layer. The full architecture additionally requires model deployments, retrieval / embeddings, document storage, identity and secrets, logging, network connectivity and the separate on-premises execution environment. Those services are not created by publishing this ZIP.

An internet-hosted App Service cannot supply the local gateway, identity, model weights, embedding runtime or vector store during a site-wide internet outage. The offline branch must operate on local infrastructure, with approved synchronization when connected. Choose local serving software and capacity independently from this web hosting plan. A low-cost calculator host should not be interpreted as the cost of the AI platform.

## Microsoft references

1. [Deploy ZIP packages to App Service](https://learn.microsoft.com/en-us/azure/app-service/deploy-zip)
2. [Configure Node.js for App Service](https://learn.microsoft.com/en-us/azure/app-service/configure-language-nodejs)
3. [Azure CLI webapp reference: create, deploy, list-runtimes, show and update](https://learn.microsoft.com/en-us/cli/azure/webapp?view=azure-cli-latest)
4. [App Service team: Azure CLI 2.87 runtime discovery changes](https://azure.github.io/AppService/2026/06/02/azure-cli-2-87-app-service-updates.html)
5. [App Service plan tiers and billing](https://learn.microsoft.com/en-us/azure/app-service/overview-hosting-plans)
6. [Azure CLI appservice plan reference](https://learn.microsoft.com/en-us/cli/azure/appservice/plan?view=azure-cli-latest)
7. [Azure CLI webapp config reference](https://learn.microsoft.com/en-us/cli/azure/webapp/config?view=azure-cli-latest)
8. [Configure Microsoft Entra authentication in App Service](https://learn.microsoft.com/en-us/azure/app-service/configure-authentication-provider-aad)
9. [Managed identities for App Service](https://learn.microsoft.com/en-us/azure/app-service/overview-managed-identity)
10. [App Service settings and Key Vault references](https://learn.microsoft.com/en-us/azure/app-service/configure-common)
