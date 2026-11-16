#!/usr/bin/env pwsh
<#
  桌宠改枪台 · 发布脚本

  用法（在你自己的 PowerShell 里跑，不要在我的沙箱里跑）：
    .\tools\publish.ps1                          只做发布前检查，不动 npm
    .\tools\publish.ps1 -Go                      检查全过就真的 npm publish
    .\tools\publish.ps1 -Cache E:\tmp\npmcache   受限环境里 npm 报 EPERM 时指定缓存目录

  为什么本机不能直接发：
    - C:\Users\<你>\.npmrc 里的 registry 指向 npmmirror（镜像站不能发布），
      所以下面所有 npm 命令都显式带 --registry=https://registry.npmjs.org/
    - 发布需要登录：先 npm login --registry=https://registry.npmjs.org/
#>
param(
  [switch]$Go,
  [string]$Registry = 'https://registry.npmjs.org/',
  [string]$Cache = ''
)

$ErrorActionPreference = 'Stop'
$cacheArgs = if ($Cache) { @('--cache', $Cache, '--logs-dir', (Join-Path $Cache '_logs')) } else { @() }

Push-Location (Split-Path $PSScriptRoot -Parent)
try {
  $pkg = Get-Content package.json -Raw -Encoding UTF8 | ConvertFrom-Json
  Write-Host "包: $($pkg.name)@$($pkg.version)" -ForegroundColor Cyan
  Write-Host "契约: kind=$($pkg.cortico.kind) api=$($pkg.cortico.api) 标签=$($pkg.cortico.tags -join ',')"
  Write-Host ""

  Write-Host '[1/4] 重生成 describe.json（工具或事件改过就必须跑）' -ForegroundColor Yellow
  node tools/write-describe.mjs

  Write-Host "`n[2/4] 自检：离线全项 + 联网 3 项" -ForegroundColor Yellow
  node tools/selfcheck.mjs --net
  if ($LASTEXITCODE -ne 0) { throw '自检没过，停止发布' }

  Write-Host "`n[3/4] 检查打包边界（不能带 secret / 缓存 / 本地库）" -ForegroundColor Yellow
  # npm 的 notice 全走 stderr，在 $ErrorActionPreference='Stop' 下会被当成错误，这里临时放开
  $eap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $dryOut = (& npm pack --dry-run --registry=$Registry @cacheArgs 2>&1 | Out-String)
    Write-Host $dryOut
    # 只解析文件清单行（形如 "npm notice 6.7kB src/site.js"），别对整段输出做子串匹配
    $files = [regex]::Matches($dryOut, 'npm notice\s+[\d.]+k?B\s+(\S+)') |
      ForEach-Object { $_.Groups[1].Value }
    if (-not $files.Count) { throw 'npm pack 没吐出文件清单' }
    $bad = $files | Where-Object { $_ -match 'node_modules|^\.npm-cache|^gunsmith-(codes|taste|cache)' }
    if ($bad) { throw "打包里出现不该发的文件: $($bad -join ', ')" }
    Write-Host "`n  边界 OK：$($files.Count) 个文件，无依赖 / 无缓存 / 无本地库" -ForegroundColor Green
  } catch {
    $first = ($_.Exception.Message -split "`n")[0]
    Write-Host "  npm pack 没跑成功（$first）" -ForegroundColor DarkYellow
    Write-Host '  受限环境常见是 EPERM：加 -Cache E:\tmp\npmcache 再试。'
    Write-Host '  这步只确认文件边界，不影响发布本身。'
  } finally {
    $ErrorActionPreference = $eap
  }

  if (-not $Go) {
    Write-Host "`n前两步全过。要真的发布，跑：" -ForegroundColor Green
    Write-Host "  npm login --registry=$Registry        # 只需一次"
    Write-Host "  .\tools\publish.ps1 -Go"
    return
  }

  Write-Host "`n[4/4] 发布到 npm" -ForegroundColor Yellow
  $who = (& npm whoami --registry=$Registry @cacheArgs 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0) { throw "没登录：先跑 npm login --registry=$Registry" }
  Write-Host "已登录为: $($who.Trim())"

  & npm publish --access public --registry=$Registry @cacheArgs
  if ($LASTEXITCODE -ne 0) { throw 'npm publish 失败' }

  Write-Host "`n发布完成。" -ForegroundColor Green
  Write-Host '接下来：'
  Write-Host "  1. 确认：npm view $($pkg.name) version --registry=$Registry"
  Write-Host '  2. 扩展市场里搜「桌宠改枪台」或关键字 cortico-world 就能看到'
  Write-Host '  3. 标签 / 评分 / 摘要由索引仓 Action 定时扫 npm 生成，通常当天出现'
} finally {
  Pop-Location
}
