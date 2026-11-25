# Despliegue del Gestor Documental a Cloud Run: UN solo servicio, público, sin
# IAP y sin balanceador, dentro de la capa gratuita.
#
#   .\deploy.ps1                      # construye la imagen con Docker local, la sube y despliega
#   .\deploy.ps1 -Proyecto otro-id    # a otro proyecto (el cliente, por ejemplo)
#   .\deploy.ps1 -CloudBuild          # sin Docker local: construye en Cloud Build (--source)
#
# Requiere: gcloud autenticado, Docker Desktop (salvo -CloudBuild), el proyecto
# con facturación vinculada y la infraestructura creada
# (infra\crear-infraestructura.ps1). Ejecutar desde PowerShell en la raíz.
# La primera vez: gcloud auth configure-docker us-central1-docker.pkg.dev
#
# POR QUÉ --no-invoker-iam-check Y NO --allow-unauthenticated: la política de
# la organización (iam.allowedPolicyMemberDomains) prohíbe el binding a
# allUsers, así que --allow-unauthenticated falla. Con el chequeo de invocador
# desactivado Cloud Run no exige identidad y la URL *.run.app queda pública.
# La política run.managed.requireInvokerIam NO está aplicada (verificado el
# 2026-11-24). En un proyecto fuera de la organización se puede usar
# --allow-unauthenticated igual.

param(
  [string] $Proyecto = 'gad-ibarra-documental',
  [string] $Region = 'us-central1',
  [string] $Servicio = 'gestor-documental',
  [switch] $CloudBuild
)

$ErrorActionPreference = 'Stop'

$SA     = "sa-documental@$Proyecto.iam.gserviceaccount.com"
$BUCKET = "$Proyecto-archivos"

Push-Location $PSScriptRoot
try {
  $sha = 'sin-git'
  try { $ErrorActionPreference = 'Continue'; $s = (& git rev-parse --short HEAD 2>$null); if ($LASTEXITCODE -eq 0 -and $s) { $sha = [string]$s } } catch {} finally { $ErrorActionPreference = 'Stop' }

  # El secreto de la cookie se conserva entre despliegues para no cerrar las
  # sesiones abiertas; solo se genera uno nuevo la primera vez.
  $secreto = ''
  try {
    $json = gcloud run services describe $Servicio --region $Region --project $Proyecto --format json 2>$null | ConvertFrom-Json
    if ($json) {
      $fila = @($json.spec.template.spec.containers[0].env | Where-Object { $_.name -eq 'SESION_SECRETO' })[0]
      if ($fila -and $fila.value) { $secreto = [string]$fila.value }
    }
  } catch { $secreto = '' }
  if (-not $secreto) {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $secreto = ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
    Write-Host 'SESION_SECRETO nuevo (primer despliegue).' -ForegroundColor Yellow
  }

  # La URL pública solo se conoce tras el primer despliegue: se lee del
  # servicio y se vuelve a fijar como APP_BASE_URL en el siguiente.
  $url = ''
  try { $url = (gcloud run services describe $Servicio --region $Region --project $Proyecto --format 'value(status.url)' 2>$null) } catch { $url = '' }
  if (-not $url) { $url = 'http://localhost:8080' }

  $vars = @(
    "GCP_PROJECT_ID=$Proyecto",
    'SGC_ROOT=sgc',
    "STORAGE_BUCKET=$BUCKET",
    "SESION_SECRETO=$secreto",
    "APP_BASE_URL=$url"
  )

  Write-Host "Desplegando $Servicio en $Proyecto ($Region) · commit $sha" -ForegroundColor Cyan
  if ($CloudBuild) { $origen = @('--source', '.') }
  else {
    $imagen = "$Region-docker.pkg.dev/$Proyecto/cloud-run-source-deploy/${Servicio}:${sha}-$(Get-Date -Format 'yyyyMMddHHmm')"
    # docker escribe su progreso por stderr: sin esto PowerShell lo trata como error.
    $ErrorActionPreference = 'Continue'
    & docker build --platform linux/amd64 -t $imagen . 2>&1 | ForEach-Object { "$_" }
    if ($LASTEXITCODE -ne 0) { throw 'docker build falló' }
    & docker push $imagen 2>&1 | ForEach-Object { "$_" }
    if ($LASTEXITCODE -ne 0) { throw 'docker push falló (¿gcloud auth configure-docker?)' }
    $ErrorActionPreference = 'Stop'
    $origen = @('--image', $imagen)
  }
  gcloud run deploy $Servicio @origen `
    --region $Region --project $Proyecto `
    --port 8080 --cpu 1 --memory 512Mi `
    --concurrency 80 --min-instances 0 --max-instances 2 --timeout 300 --cpu-boost `
    --ingress all `
    --no-invoker-iam-check `
    --service-account $SA `
    --labels "app=gestor-documental,commit=$sha" `
    --set-env-vars ($vars -join ',')
  if ($LASTEXITCODE -ne 0) { throw "El despliegue falló con código $LASTEXITCODE" }

  $url = (gcloud run services describe $Servicio --region $Region --project $Proyecto --format 'value(status.url)')
  Write-Host "`nDesplegado: $url" -ForegroundColor Green
  Write-Host "Primera vez: siembre los catálogos con  cd backend; `$env:SGC_ROOT='sgc'; npm run seed" -ForegroundColor Yellow
  Write-Host 'Si APP_BASE_URL quedó en localhost (primer despliegue), vuelva a ejecutar este script una vez.' -ForegroundColor Yellow
}
finally {
  Pop-Location
}
