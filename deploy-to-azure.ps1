#!/usr/bin/env pwsh
#Requires -Version 7
<#
.SYNOPSIS
    Deploys the Ragdoll Playground application to Azure App Service.

.DESCRIPTION
    This script validates the application, creates a deployment package, and deploys it to an existing
    Linux Node.js Azure App Service. Dependencies are installed on App Service during deployment
    (SCM_DO_BUILD_DURING_DEPLOYMENT=true), so local node_modules are never uploaded.
    The scene designer chat requires GitHub Copilot, which is not available on App Service, so the
    script sets ENABLE_CHAT=false on the app.
    Requires Azure CLI to be installed and authenticated (az login).

.PARAMETER AppName
    The name of the Azure App Service to deploy to.

.PARAMETER ResourceGroup
    The name of the Azure Resource Group containing the App Service.

.PARAMETER SkipBuild
    Skip regenerating the preset scenes and running the tests.

.PARAMETER WhatIf
    Show what would be deployed without actually deploying.

.PARAMETER OpenBrowser
    Open the deployed application in the default browser after a successful deployment. Disabled by default.

.EXAMPLE
    .\deploy-to-azure.ps1 -AppName "ragdoll" -ResourceGroup "rg-app-services"

.EXAMPLE
    .\deploy-to-azure.ps1 -AppName "ragdoll-dev" -ResourceGroup "rg-dev" -SkipBuild

.EXAMPLE
    .\deploy-to-azure.ps1 -AppName "ragdoll" -ResourceGroup "rg-app-services" -WhatIf

.EXAMPLE
    .\deploy-to-azure.ps1 -OpenBrowser
#>

param(
    [Parameter(Mandatory = $false, HelpMessage = "Azure App Service name")]
    [string]$AppName = "ragdoll",

    [Parameter(Mandatory = $false, HelpMessage = "Azure Resource Group name")]
    [string]$ResourceGroup = "rg-app-services",

    [Parameter(Mandatory = $false)]
    [switch]$SkipBuild,

    [Parameter(Mandatory = $false)]
    [switch]$WhatIf,

    [Parameter(Mandatory = $false)]
    [switch]$OpenBrowser
)

$ErrorActionPreference = "Stop"

# Files and folders that make up the deployed application (node_modules is installed on App Service).
$PackageItems = @("server.js", "package.json", "package-lock.json", "lib", "public", "data")

function Write-Step {
    param([string]$Message)
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "✓ $Message" -ForegroundColor Green
}

function Write-Failure {
    param([string]$Message)
    Write-Host "✗ $Message" -ForegroundColor Red
}

function Write-Info {
    param([string]$Message)
    Write-Host "  $Message" -ForegroundColor Gray
}

Write-Host @"

╔══════════════════════════════════════════════════════════╗
║                                                          ║
║   Ragdoll Playground - Azure App Service Deployment      ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝

"@ -ForegroundColor Magenta

Write-Info "App Service: $AppName"
Write-Info "Resource Group: $ResourceGroup"
Write-Info "Skip Build: $SkipBuild"
Write-Info "WhatIf Mode: $WhatIf"
Write-Info "Open Browser: $OpenBrowser"
Write-Host ""

# Run everything relative to the repository root (the folder of this script).
Push-Location $PSScriptRoot
try {
    Write-Step "Checking prerequisites..."
    try {
        $azVersion = az version --output json 2>&1 | ConvertFrom-Json
        Write-Success "Azure CLI version $($azVersion.'azure-cli') found"
    } catch {
        Write-Failure "Azure CLI not found. Please install from: https://aka.ms/installazurecliwindows"
        exit 1
    }

    if (-not $SkipBuild) {
        if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm -ErrorAction SilentlyContinue)) {
            Write-Failure "Node.js and npm are required to build. Install Node.js or use -SkipBuild."
            exit 1
        }
        Write-Success "Node.js $(node --version) found"
    }

    Write-Step "Checking Azure authentication..."
    try {
        $account = az account show --output json 2>&1 | ConvertFrom-Json
        Write-Success "Logged in as: $($account.user.name)"
        Write-Info "Subscription: $($account.name) ($($account.id))"
    } catch {
        Write-Failure "Not logged in to Azure. Please run: az login"
        exit 1
    }

    Write-Step "Verifying App Service exists..."
    try {
        $appService = az webapp show --name $AppName --resource-group $ResourceGroup --output json 2>&1 | ConvertFrom-Json
        Write-Success "App Service found: $($appService.defaultHostName)"
        Write-Info "Location: $($appService.location)"
        Write-Info "Plan: $($appService.appServicePlanName)"
        $runtime = $appService.siteConfig.linuxFxVersion
        Write-Info "Runtime: $runtime"
        if ($runtime -notmatch '^NODE\|') {
            Write-Host "  ! Expected a Linux Node.js runtime (e.g. NODE|22-lts), found '$runtime'" -ForegroundColor Yellow
        }
    } catch {
        Write-Failure "App Service '$AppName' not found in resource group '$ResourceGroup'"
        Write-Info "Available app services:"
        az webapp list --resource-group $ResourceGroup --query "[].name" --output table
        exit 1
    }

    if ($WhatIf) {
        Write-Step "WhatIf Mode - Skipping deployment"
        Write-Info "Would deploy: $($PackageItems -join ', ')"
        Write-Info "Would set app settings: SCM_DO_BUILD_DURING_DEPLOYMENT=true, CUSTOM_BUILD_COMMAND=npm install --omit=dev, NODE_ENV=production, ENABLE_CHAT=false"
        Write-Info "Would deploy to: https://$($appService.defaultHostName)"
        exit 0
    }

    if (-not $SkipBuild) {
        Write-Step "Building application..."
        Write-Info "Regenerating preset scenes..."
        npm run build --silent
        if ($LASTEXITCODE -ne 0) {
            Write-Failure "Preset build failed"
            exit 1
        }
        Write-Success "Preset scenes generated"

        Write-Info "Running tests..."
        npm test --silent
        if ($LASTEXITCODE -ne 0) {
            Write-Failure "Tests failed"
            exit 1
        }
        Write-Success "Tests passed"
    } else {
        Write-Step "Skipping build (using existing files)..."
    }

    foreach ($item in $PackageItems) {
        if (-not (Test-Path $item)) {
            Write-Failure "Required file or folder not found: $item"
            exit 1
        }
    }

    Write-Step "Creating deployment package..."
    $stagingPath = Join-Path ([System.IO.Path]::GetTempPath()) "ragdoll-deploy-$([guid]::NewGuid().ToString('N'))"
    $zipFullPath = "$stagingPath.zip"
    New-Item -ItemType Directory -Path $stagingPath | Out-Null
    try {
        foreach ($item in $PackageItems) {
            Copy-Item -Path $item -Destination $stagingPath -Recurse -Force
        }
        Compress-Archive -Path (Join-Path $stagingPath "*") -DestinationPath $zipFullPath -Force
        Write-Success "Deployment package created: $zipFullPath"
    } catch {
        Write-Failure "Failed to create deployment package: $_"
        exit 1
    } finally {
        Remove-Item -Path $stagingPath -Recurse -Force -ErrorAction SilentlyContinue
    }

    $zipSize = (Get-Item $zipFullPath).Length / 1MB
    Write-Info "Package size: $([math]::Round($zipSize, 2)) MB"

    try {
        Write-Step "Configuring app settings..."
        # npm install runs on App Service; chat stays hidden because GitHub Copilot is not available there.
        az webapp config appsettings set `
            --resource-group $ResourceGroup `
            --name $AppName `
            --settings SCM_DO_BUILD_DURING_DEPLOYMENT=true "CUSTOM_BUILD_COMMAND=npm install --omit=dev" NODE_ENV=production ENABLE_CHAT=false `
            --output none
        if ($LASTEXITCODE -ne 0) {
            throw "Updating app settings failed"
        }
        Write-Success "App settings updated (SCM_DO_BUILD_DURING_DEPLOYMENT, CUSTOM_BUILD_COMMAND, NODE_ENV, ENABLE_CHAT=false)"

        Write-Step "Deploying to Azure App Service..."
        Write-Info "This may take a few minutes (npm install runs on App Service)..."
        az webapp deploy `
            --resource-group $ResourceGroup `
            --name $AppName `
            --src-path $zipFullPath `
            --type zip `
            --async true `
            --output none
        if ($LASTEXITCODE -ne 0) {
            throw "Deployment command failed"
        }
        Write-Success "Deployment initiated successfully"
    } catch {
        Write-Failure "Deployment failed: $_"
        Write-Info "Check deployment logs: az webapp log tail --name $AppName --resource-group $ResourceGroup"
        exit 1
    } finally {
        if (Test-Path $zipFullPath) {
            Remove-Item -Path $zipFullPath -Force
            Write-Info "Cleaned up deployment package"
        }
    }

    Write-Info "Waiting for deployment to process..."
    Start-Sleep -Seconds 5

    Write-Step "Checking deployment status..."
    try {
        $deployments = az webapp log deployment list `
            --resource-group $ResourceGroup `
            --name $AppName `
            --query "[0]" `
            --output json | ConvertFrom-Json

        if ($deployments) {
            Write-Info "Status: $($deployments.status)"
            Write-Info "Deployed: $($deployments.received_time)"
        }
    } catch {
        Write-Info "Unable to get deployment status (deployment may still be in progress)"
    }

    Write-Host @"

╔══════════════════════════════════════════════════════════╗
║                                                          ║
║              Deployment Completed! ✓                     ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝

"@ -ForegroundColor Green

    Write-Host "Application URL: " -NoNewline
    Write-Host "https://$($appService.defaultHostName)" -ForegroundColor Cyan
    foreach ($hostName in $appService.hostNames | Where-Object { $_ -ne $appService.defaultHostName }) {
        Write-Host "Custom domain:   " -NoNewline
        Write-Host "https://$hostName" -ForegroundColor Cyan
    }

    Write-Host "`nScene information:" -ForegroundColor Yellow
    Write-Host "  • Preset scenes and previously generated scenes (data/) are deployed with the app"
    Write-Host "  • The scene designer chat is hidden (ENABLE_CHAT=false, no GitHub Copilot on App Service)"

    Write-Host "`nUseful commands:"
    Write-Host "  View logs:        " -NoNewline
    Write-Host "az webapp log tail --name $AppName --resource-group $ResourceGroup" -ForegroundColor Yellow
    Write-Host "  Open in browser:  " -NoNewline
    Write-Host "az webapp browse --name $AppName --resource-group $ResourceGroup" -ForegroundColor Yellow
    Write-Host "  SSH to container: " -NoNewline
    Write-Host "az webapp ssh --name $AppName --resource-group $ResourceGroup" -ForegroundColor Yellow
    Write-Host ""

    if ($OpenBrowser) {
        az webapp browse --name $AppName --resource-group $ResourceGroup
    }

    Write-Success "Deployment script completed successfully!"
} finally {
    Pop-Location
}
