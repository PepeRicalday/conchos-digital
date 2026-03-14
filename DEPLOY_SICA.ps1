# SICA 005: Cloud Deployment Assistant (SICA v1.3.4 -> Next)
# =========================================================

function Show-Header {
    Write-Host "=========================================================" -ForegroundColor Cyan
    Write-Host "         SICA 005: ASISTENTE DE DESPLIEGUE EN LA NUBE    " -ForegroundColor Cyan
    Write-Host "=========================================================" -ForegroundColor Cyan
}

Show-Header

# Fase 1: Limpieza Estricta
Write-Host ">>> FASE 1: Limpieza de Codigo (Linting & Build)" -ForegroundColor Yellow
Write-Host "Ejecutando verificacion de errores..."
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] El build fallo. Repara los errores antes de subir a la nube." -ForegroundColor Red
    exit
}
Write-Host "[OK] Codigo limpio y compilado con exito." -ForegroundColor Green

# Fase 2: Version Semantica
$package = Get-Content package.json | ConvertFrom-Json
$currentVersion = $package.version
Write-Host "`n>>> FASE 2: Salto de Version (Actual: $currentVersion)" -ForegroundColor Yellow
$newVersion = Read-Host "Ingresa la NUEVA version (Ej. 1.3.5)"
if (-not $newVersion) { $newVersion = $currentVersion }

# Actualizar package.json
(Get-Content package.json) -replace "`"version`": `"$currentVersion`"", "`"version`": `"$newVersion`"" | Set-Content package.json
Write-Host "[OK] Version actualizada en package.json." -ForegroundColor Green

# Fase 3: GitHub Push
Write-Host "`n>>> FASE 3: Envio a GitHub (Vercel automatico)" -ForegroundColor Yellow
$commitMsg = Read-Host "Ingresa descripcion de cambios"
git add .
git commit -m "feat/fix: $commitMsg - v$newVersion"
git push origin main
Write-Host "[OK] Cambios enviados. Vercel estara desplegando en 2 minutos." -ForegroundColor Green

# Fase 4: Supabase SQL
Write-Host "`n>>> FASE 4: Comando OBLIGATORIO para Supabase (Forzar actualizacion)" -ForegroundColor Yellow
Write-Host "Copia y pega este comando en el editor SQL de Supabase:" -ForegroundColor Cyan
Write-Host "---------------------------------------------------------"
Write-Host "UPDATE app_versions "
Write-Host "SET version = '$newVersion', actualizado_en = now() "
Write-Host "WHERE app_id = 'control-digital';"  # O 'capture' segun el proyecto
Write-Host "---------------------------------------------------------"

Write-Host "`nProceso Finalizado con Exito." -ForegroundColor Green
pause
