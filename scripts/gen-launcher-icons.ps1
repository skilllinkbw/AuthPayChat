# PayChat launcher-icon generator.
# Source of truth: apps/web/public/favicon.png (the real PayChat brand mark).
# Regenerates ALL Android launcher icon densities (legacy + adaptive) for the
# authoritative android/ project. Brand background: #0B3B8C (PayChat blue).
Add-Type -AssemblyName System.Drawing

$srcPath = 'apps\web\public\favicon.png'
$resDir  = 'android\app\src\main\res'
$blue    = [System.Drawing.Color]::FromArgb(255, 11, 59, 140)   # #0B3B8C

$src = New-Object System.Drawing.Bitmap($srcPath)
$sw = $src.Width; $sh = $src.Height

# Visual (alpha) bounding box of the mark.
$minX = $sw; $minY = $sh; $maxX = 0; $maxY = 0
for ($y = 0; $y -lt $sh; $y++) {
  for ($x = 0; $x -lt $sw; $x++) {
    if ($src.GetPixel($x, $y).A -gt 16) {
      if ($x -lt $minX) { $minX = $x }; if ($x -gt $maxX) { $maxX = $x }
      if ($y -lt $minY) { $minY = $y }; if ($y -gt $maxY) { $maxY = $y }
    }
  }
}
$bw = $maxX - $minX + 1; $bh = $maxY - $minY + 1
Write-Output "mark bbox: x[$minX..$maxX] y[$minY..$maxY] size ${bw}x${bh}"

$cropW = $bw; $cropH = $bh
$crop = New-Object System.Drawing.Bitmap($cropW, $cropH, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($crop)
$g.DrawImage($src, (New-Object System.Drawing.Rectangle(0, 0, $cropW, $cropH)),
  $minX, $minY, $cropW, $cropH, [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose()

function New-HighQualityGraphics([System.Drawing.Bitmap]$bmp) {
  $gr = [System.Drawing.Graphics]::FromImage($bmp)
  $gr.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $gr.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $gr.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  return $gr
}

function Save-Png([System.Drawing.Bitmap]$bmp, [string]$path) {
  $enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/png' }
  $bmp.Save($path, $enc, $null)
  $bmp.Dispose()
}

# ── Legacy launcher + round icons (mark on brand-blue tile) ──────────────────
$legacy = @{ mdpi = 48; hdpi = 72; xhdpi = 96; xxhdpi = 144; xxxhdpi = 192 }
foreach ($d in $legacy.GetEnumerator()) {
  $size = $d.Value; $dir = Join-Path $resDir ("mipmap-" + $d.Key)
  $content = [int]($size * 0.80)          # mark fills 80% of the tile
  $scale = [Math]::Min($content / $cropW, $content / $cropH)
  $drawW = [int]($cropW * $scale); $drawH = [int]($cropH * $scale)
  $offX = [int](($size - $drawW) / 2); $offY = [int](($size - $drawH) / 2)

  foreach ($kind in @('ic_launcher.png', 'ic_launcher_round.png')) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $gr = New-HighQualityGraphics $bmp
    $bg = New-Object System.Drawing.SolidBrush $blue
    $gr.FillRectangle($bg, 0, 0, $size, $size)
    $gr.DrawImage($crop, $offX, $offY, $drawW, $drawH)
    $gr.Dispose()
    if ($kind -like '*round*') {
      # Circle mask (pre-API-26 round icon must be a real circle).
      $cx = $size / 2; $cy = $size / 2; $r = $size / 2
      for ($y = 0; $y -lt $size; $y++) {
        for ($x = 0; $x -lt $size; $x++) {
          if ([Math]::Sqrt((($x + 0.5 - $cx) * ($x + 0.5 - $cx)) + (($y + 0.5 - $cy) * ($y + 0.5 - $cy))) -gt $r) {
            $bmp.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(0, 0, 0, 0))
          }
        }
      }
    }
    Save-Png $bmp (Join-Path $dir $kind)
    Write-Output "wrote $dir\$kind (${size}x${size})"
  }
}

# ── Adaptive foregrounds (mark centred in the safe zone, transparent bg) ─────
$adaptive = @{ mdpi = 108; hdpi = 162; xhdpi = 216; xxhdpi = 324; xxxhdpi = 432 }
foreach ($d in $adaptive.GetEnumerator()) {
  $size = $d.Value; $dir = Join-Path $resDir ("mipmap-" + $d.Key)
  $content = [int]($size * 0.55)          # stay inside the 66/108 safe zone
  $scale = [Math]::Min($content / $cropW, $content / $cropH)
  $drawW = [int]($cropW * $scale); $drawH = [int]($cropH * $scale)
  $offX = [int](($size - $drawW) / 2); $offY = [int](($size - $drawH) / 2)

  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $gr = New-HighQualityGraphics $bmp
  $gr.DrawImage($crop, $offX, $offY, $drawW, $drawH)
  $gr.Dispose()
  Save-Png $bmp (Join-Path $dir 'ic_launcher_foreground.png')
  Write-Output "wrote $dir\ic_launcher_foreground.png (${size}x${size})"
}

$crop.Dispose(); $src.Dispose()
Write-Output "done"