<#
  desplegar-limpio.ps1 — despliega a producción el commit HEAD desde un worktree limpio, sin publicar trabajo sin commit.

  Uso (desde conchos-digital):   powershell -File scripts\desplegar-limpio.ps1 [-SinDeploy]
    -SinDeploy   hace todo (worktree, pull, build, limpieza) pero NO publica: sirve para probar la receta.

  Por qué existe: el worktree comparte node_modules con el repo real mediante un junction. Tras `vercel build` esa
  carpeta del worktree puede dejar de ser un junction (rmdir falla con "el directorio no está vacío"); borrarla
  a ciegas con `git worktree remove --force` es peligroso si SÍ sigue siendo un junction. Aquí se comprueba el tipo
  antes de borrar y se verifica que node_modules del repo real siga intacto.
  Requisito: el autor del commit HEAD debe ser la cuenta Vercel (ver memoria "vercel-blocked-autor-commit").
#>
param([switch]$SinDeploy)
$ErrorActionPreference = 'Stop'

$repo = (git rev-parse --show-toplevel).Trim() -replace '/', '\'
$wt = Join-Path $env:TEMP ("deploy_wt_" + (Get-Date -Format 'yyyyMMdd_HHmmss'))
$nmReal = Join-Path $repo 'node_modules'
if (-not (Test-Path $nmReal)) { throw "No existe ${nmReal}: corre npm install primero." }
$antes = (Get-ChildItem $nmReal -Force -Name | Measure-Object).Count
$autor = (git log -1 --format=%ae).Trim()
Write-Host "Commit: $(git log -1 --format='%h %s')  · autor: $autor"

try {
    git worktree add $wt HEAD | Out-Null
    Copy-Item (Join-Path $repo '.vercel') (Join-Path $wt '.vercel') -Recurse
    Get-ChildItem $repo -Force -Filter '.env*' -File | ForEach-Object { Copy-Item $_.FullName $wt }
    New-Item -ItemType Junction -Path (Join-Path $wt 'node_modules') -Target $nmReal | Out-Null

    Push-Location $wt
    try {
        npx vercel pull --yes --environment=production | Out-Null
        npx vercel build --prod
        if ($SinDeploy) { Write-Host 'Build correcto. -SinDeploy: no se publica.' }
        else {
            npx vercel deploy --prebuilt --prod
            npx vercel ls | Select-String 'Production' | Select-Object -First 1
        }
    } finally { Pop-Location }
}
finally {
    $nmWt = Join-Path $wt 'node_modules'
    if (Test-Path $nmWt) {
        $esEnlace = ((Get-Item $nmWt -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
        if ($esEnlace) {
            # Quita SOLO el enlace (no recursivo): nunca toca el contenido del node_modules real.
            [IO.Directory]::Delete($nmWt, $false)
            Write-Host 'node_modules del worktree: era un junction, enlace retirado.'
        } else {
            Write-Host 'node_modules del worktree: ya es una carpeta real (el build lo reemplazó); git la borra sin tocar el repo.'
        }
    }
    if (Test-Path $wt) { git worktree remove --force $wt 2>&1 | Out-Null }
    git worktree prune
    $despues = (Get-ChildItem $nmReal -Force -Name | Measure-Object).Count
    if ($despues -lt $antes) { Write-Error "¡node_modules del repo perdió paquetes ($antes → $despues)! Corre npm install." }
    else { Write-Host "node_modules del repo intacto ($despues entradas)." }
}
