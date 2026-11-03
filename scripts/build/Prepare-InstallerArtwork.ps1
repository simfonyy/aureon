$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$installerDirectory = Join-Path $projectRoot 'src-tauri/installer'
$icon = [System.Drawing.Image]::FromFile((Join-Path $projectRoot 'src-tauri/icons/256x256.png'))

function New-InstallerBitmap([int]$Width, [int]$Height, [scriptblock]$Draw, [string]$Name) {
    $bitmap = New-Object System.Drawing.Bitmap($Width, $Height, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb))
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.Clear([System.Drawing.Color]::White)
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
        & $Draw $graphics
        $bitmap.Save((Join-Path $installerDirectory $Name), [System.Drawing.Imaging.ImageFormat]::Bmp)
    } finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

try {
    New-InstallerBitmap 493 312 {
        param($graphics)
        $background = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(18, 19, 23))
        $foreground = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(245, 245, 247))
        $muted = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(166, 168, 176))
        $title = New-Object System.Drawing.Font('Segoe UI', 19, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel))
        $caption = New-Object System.Drawing.Font('Segoe UI', 11, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel))
        try {
            $graphics.FillRectangle($background, 0, 0, 165, 312)
            $graphics.DrawImage($icon, 34, 60, 96, 96)
            $graphics.DrawString('Aureon', $title, $foreground, 28, 203)
            $graphics.DrawString('nightlezz.ru', $caption, $muted, 29, 232)
        } finally {
            $background.Dispose(); $foreground.Dispose(); $muted.Dispose()
            $title.Dispose(); $caption.Dispose()
        }
    } 'dialog.bmp'
    New-InstallerBitmap 493 58 {
        param($graphics)
        $graphics.DrawImage($icon, 443, 10, 38, 38)
    } 'banner.bmp'
} finally {
    $icon.Dispose()
}
