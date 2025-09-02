Param(
  [string]$RepoUrl = "https://github.com/thomad99/VinValue.git",
  [string]$Branch = "main",
  [int]$IntervalSeconds = 60,
  [switch]$SkipEmptyCommits
)

if (!(Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Error "git is not installed or not on PATH. Install Git for Windows first: https://git-scm.com/download/win"
  exit 1
}

if (!(Test-Path .git)) { git init }

if (!(Test-Path .gitignore)) {
  @(
    "node_modules/",
    ".DS_Store",
    "npm-debug.log*",
    "yarn-debug.log*",
    "yarn-error.log*",
    ".env",
    ".playwright/",
    "playwright-report/",
    "test-results/"
  ) | Out-File -Encoding utf8 .gitignore
}

# Ensure branch and remote
git branch -M $Branch
if (git remote get-url origin 2>$null) {
  git remote set-url origin $RepoUrl
} else {
  git remote add origin $RepoUrl
}

Write-Host "Auto-sync enabled. Pushing to $RepoUrl ($Branch) every $IntervalSeconds seconds." -ForegroundColor Cyan

while ($true) {
  try {
    git add -A

    $hasHead = $true
    git rev-parse --verify HEAD 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { $hasHead = $false }

    $changes = git status --porcelain
    if (-not $hasHead) {
      git commit -m "Initial commit"
    } elseif ($SkipEmptyCommits -and [string]::IsNullOrWhiteSpace($changes)) {
      # Skip commit
    } else {
      $msg = if ([string]::IsNullOrWhiteSpace($changes)) { "Sync (no changes)" } else { "Sync" }
      git commit -m $msg --allow-empty | Out-Null
    }

    git push -u origin $Branch
    Write-Host ("[{0}] Pushed to {1} {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $RepoUrl, $Branch) -ForegroundColor Green
  } catch {
    Write-Warning ("Push failed: {0}" -f $_.Exception.Message)
  }

  for ($i = $IntervalSeconds; $i -gt 0; $i--) {
    Write-Host ("Sleeping {0}s ... Press Ctrl+C to stop" -f $i) -NoNewline
    Start-Sleep -Seconds 1
    Write-Host "`r" -NoNewline
  }
  Write-Host "" # move to new line after countdown
}

