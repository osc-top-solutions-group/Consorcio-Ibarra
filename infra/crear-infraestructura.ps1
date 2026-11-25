# INFRAESTRUCTURA del Gestor Documental — se ejecuta una vez por proyecto.
# Idempotente: lo que ya existe avisa y sigue.
#
#   .\infra\crear-infraestructura.ps1
#   .\infra\crear-infraestructura.ps1 -Proyecto otro-id -CuentaFacturacion XXXXXX-XXXXXX-XXXXXX
#
# Crea: facturación (si se indica), APIs, Firestore (default) Native, bucket de
# archivos, cuenta de servicio del backend y sus permisos mínimos. Todo dentro
# de la capa gratuita de GCP; NO crea balanceador, Cloud Armor, KMS ni crons.
#
# Vincular la facturación exige el rol Usuario de cuenta de facturación sobre
# la cuenta: si falla, lo hace un administrador desde la consola y se vuelve a
# correr este script.

param(
  [string] $Proyecto = 'gad-ibarra-documental',
  [string] $Region = 'us-central1',
  [string] $CuentaFacturacion = ''
)

$ErrorActionPreference = 'Continue'
$SA     = "sa-documental@$Proyecto.iam.gserviceaccount.com"
$BUCKET = "$Proyecto-archivos"

function Paso($n, $texto) { Write-Host "`n[$n] $texto" -ForegroundColor Cyan }
function Ya($texto)    { Write-Host "   = $texto" -ForegroundColor DarkGray }
function Hecho($texto) { Write-Host "   + $texto" -ForegroundColor Green }
function Aviso($texto) { Write-Host "   ! $texto" -ForegroundColor Yellow }
function Existe([string[]] $cmd) {
  & gcloud @cmd --project $Proyecto --format=none 2>$null
  return ($LASTEXITCODE -eq 0)
}

Paso 1 'Facturación'
$fact = gcloud billing projects describe $Proyecto --format 'value(billingEnabled)' 2>$null
if ($fact -eq 'True') { Ya 'el proyecto ya tiene facturación' }
elseif ($CuentaFacturacion) {
  gcloud billing projects link $Proyecto --billing-account $CuentaFacturacion --format=none
  if ($LASTEXITCODE -eq 0) { Hecho "vinculada $CuentaFacturacion" } else { Aviso 'no se pudo vincular: pídalo a un administrador de facturación' }
} else { Aviso 'sin facturación: Cloud Run, Cloud Build y el bucket no se pueden crear hasta vincularla (-CuentaFacturacion)' }

Paso 2 'APIs'
gcloud services enable firestore.googleapis.com iam.googleapis.com --project $Proyecto --format=none
gcloud services enable run.googleapis.com cloudbuild.googleapis.com storage.googleapis.com artifactregistry.googleapis.com --project $Proyecto --format=none
if ($LASTEXITCODE -eq 0) { Hecho 'APIs habilitadas' } else { Aviso 'las APIs de Cloud Run/Build/Storage requieren facturación' }

Paso 3 'Firestore (default), Native, en la región'
if (Existe @('firestore', 'databases', 'describe', '--database=(default)')) { Ya 'ya existe' }
else {
  gcloud firestore databases create --database='(default)' --location $Region --type firestore-native --project $Proyecto --quiet --format=none
  if ($LASTEXITCODE -eq 0) { Hecho 'creada' }
}

Paso 4 "Bucket de archivos gs://$BUCKET"
if (Existe @('storage', 'buckets', 'describe', "gs://$BUCKET")) { Ya 'ya existe' }
else {
  gcloud storage buckets create "gs://$BUCKET" --location $Region --uniform-bucket-level-access --project $Proyecto
  if ($LASTEXITCODE -eq 0) { Hecho 'creado' } else { Aviso 'requiere facturación' }
}

Paso 5 'Cuenta de servicio del backend y permisos mínimos'
if (Existe @('iam', 'service-accounts', 'describe', $SA)) { Ya "$SA ya existe" }
else {
  gcloud iam service-accounts create sa-documental --display-name 'Backend Gestor Documental' --project $Proyecto --format=none
  if ($LASTEXITCODE -eq 0) { Hecho 'creada' }
}
gcloud projects add-iam-policy-binding $Proyecto --member "serviceAccount:$SA" --role roles/datastore.user --condition=None --format=none 2>$null
if ($LASTEXITCODE -eq 0) { Hecho 'roles/datastore.user (Firestore)' }
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member "serviceAccount:$SA" --role roles/storage.objectAdmin --format=none 2>$null
if ($LASTEXITCODE -eq 0) { Hecho 'roles/storage.objectAdmin sobre el bucket' } else { Aviso 'el bucket no existe todavía' }

Paso 6 'Cloud Build: la cuenta de Compute construye las imágenes (sin permisos automáticos en proyectos nuevos)'
$numero = gcloud projects describe $Proyecto --format 'value(projectNumber)'
gcloud projects add-iam-policy-binding $Proyecto --member "serviceAccount:$numero-compute@developer.gserviceaccount.com" --role roles/cloudbuild.builds.builder --condition=None --format=none 2>$null
if ($LASTEXITCODE -eq 0) { Hecho 'roles/cloudbuild.builds.builder' }

Write-Host "`nListo. Siguiente: .\deploy.ps1 -Proyecto $Proyecto" -ForegroundColor Green
