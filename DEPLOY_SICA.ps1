# SICA 005: Asistente de Despliegue en la Nube
# =========================================================
#
# Cadena completa: bump -> build -> git -> Vercel -> app_versions.
#
# Los dos pasos que antes eran manuales y rompian la cadena:
#   1. `git push` NO despliega: conchos-digital no tiene auto-deploy por Git.
#      Sin `vercel --prod` el codigo se sube a GitHub y nunca sale a produccion.
#   2. El UPDATE de app_versions se imprimia para pegarlo a mano en el editor
#      SQL. Si se omitia, VersionGuard seguia viendo la version vieja y NINGUN
#      dispositivo de la red se enteraba de la actualizacion.
# Ambos corren aqui automaticamente.
#
# El bump va ANTES del build a proposito: vite.config.ts lee package.json para
# el nombre del service worker y el <title>. Compilar antes de subir la version
# produce un bundle etiquetado con la version anterior.

$ErrorActionPreference = "Stop"
$raiz = $PSScriptRoot

function Show-Header {
    Write-Host "=========================================================" -ForegroundColor Cyan
    Write-Host "         SICA 005: ASISTENTE DE DESPLIEGUE EN LA NUBE    " -ForegroundColor Cyan
    Write-Host "=========================================================" -ForegroundColor Cyan
}

Show-Header

# --- FASE 1: Version -------------------------------------------------------
$package = Get-Content "$raiz\package.json" -Raw | ConvertFrom-Json
$currentVersion = $package.version
Write-Host "`n>>> FASE 1: Salto de Version (Actual: $currentVersion)" -ForegroundColor Yellow
$newVersion = Read-Host "Ingresa la NUEVA version (Enter = mantener $currentVersion)"
if (-not $newVersion) { $newVersion = $currentVersion }

if ($newVersion -notmatch '^\d+\.\d+\.\d+$') {
    Write-Host "[ERROR] Version invalida: '$newVersion'. Formato esperado: 2.10.3" -ForegroundColor Red
    exit 1
}

if ($newVersion -ne $currentVersion) {
    # Reemplazo dirigido al campo version de la raiz. Un -replace sobre el texto
    # completo tocaria tambien las versiones de las dependencias que coincidan.
    $package.version = $newVersion
    $package | ConvertTo-Json -Depth 100 | Set-Content "$raiz\package.json" -Encoding utf8
    Write-Host "[OK] package.json -> v$newVersion" -ForegroundColor Green
} else {
    Write-Host "[--] Version sin cambio ($currentVersion)." -ForegroundColor DarkGray
}

# --- FASE 2: Build ---------------------------------------------------------
Write-Host "`n>>> FASE 2: Compilacion (tsc + vite build)" -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] El build fallo. Repara los errores antes de desplegar." -ForegroundColor Red
    Write-Host "        package.json quedo en v$newVersion - revisalo si abortas aqui." -ForegroundColor DarkYellow
    exit 1
}
Write-Host "[OK] Compilado con exito." -ForegroundColor Green

# --- FASE 3: GitHub --------------------------------------------------------
Write-Host "`n>>> FASE 3: Envio a GitHub (respaldo del codigo)" -ForegroundColor Yellow
$commitMsg = Read-Host "Descripcion de cambios"
if (-not $commitMsg) { $commitMsg = "deploy v$newVersion" }

$rama = (git rev-parse --abbrev-ref HEAD).Trim()
git add -A
git commit -m "deploy: $commitMsg - v$newVersion"
if ($LASTEXITCODE -ne 0) {
    Write-Host "[--] Sin cambios que confirmar; se continua." -ForegroundColor DarkGray
}
git push origin $rama
if ($LASTEXITCODE -ne 0) {
    Write-Host "[AVISO] El push fallo. El despliegue continua (Vercel sube desde local)." -ForegroundColor DarkYellow
} else {
    Write-Host "[OK] Codigo respaldado en GitHub ($rama)." -ForegroundColor Green
}

# --- FASE 4: Vercel --------------------------------------------------------
# Este es el paso que realmente publica. Sin el, nada sale a produccion.
Write-Host "`n>>> FASE 4: Despliegue a produccion (Vercel)" -ForegroundColor Yellow
npx vercel --prod --yes
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] El despliegue a Vercel fallo." -ForegroundColor Red
    Write-Host "        NO se publicara la version: los dispositivos seguirian" -ForegroundColor Red
    Write-Host "        buscando un bundle que no existe en produccion." -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Publicado en produccion." -ForegroundColor Green

# --- FASE 5: Anuncio a la red ---------------------------------------------
# app_versions es el interruptor del refresco forzado: VersionGuard lo consulta
# y recarga los dispositivos. Va al final, cuando el bundle YA esta en linea.
Write-Host "`n>>> FASE 5: Anuncio a los dispositivos (app_versions)" -ForegroundColor Yellow
node "$raiz\sync_versions.mjs" control-digital --notas "$commitMsg"
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] No se pudo publicar la version en Supabase." -ForegroundColor Red
    Write-Host "        El codigo YA esta en produccion, pero los dispositivos NO" -ForegroundColor Red
    Write-Host "        se actualizaran solos. Corrige y reintenta:" -ForegroundColor Red
    Write-Host "        node sync_versions.mjs control-digital" -ForegroundColor Cyan
    exit 1
}

Write-Host "`n=========================================================" -ForegroundColor Green
Write-Host " DESPLIEGUE COMPLETO - v$newVersion en produccion" -ForegroundColor Green
Write-Host " Los dispositivos se actualizaran en <=10 min," -ForegroundColor Green
Write-Host " o al volver la app a primer plano." -ForegroundColor Green
Write-Host "=========================================================" -ForegroundColor Green
