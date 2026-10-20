$ErrorActionPreference = 'Stop'
$qdiiRoot = Split-Path -Parent $PSScriptRoot
$qdiiCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (!(Test-Path -LiteralPath $qdiiCompiler)) {
    $qdiiCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (!(Test-Path -LiteralPath $qdiiCompiler)) { throw '需要 Windows .NET Framework 4.x 编译器。' }
Add-Type -AssemblyName System.Drawing
$qdiiIconFile = Join-Path $PSScriptRoot 'QdiiHelp.ico'
$qdiiSizes = @(16,24,32,48,64,128,256)
$qdiiImages = @()
foreach($qdiiSize in $qdiiSizes) {
    $qdiiScale = $qdiiSize * 4
    $qdiiBitmap = New-Object System.Drawing.Bitmap $qdiiScale,$qdiiScale
    $qdiiGraphics = [System.Drawing.Graphics]::FromImage($qdiiBitmap)
    $qdiiGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $qdiiGraphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $qdiiBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(0,128,128))
    $qdiiFont = New-Object System.Drawing.Font 'Segoe UI',($qdiiScale*0.66),([System.Drawing.FontStyle]::Bold),([System.Drawing.GraphicsUnit]::Pixel)
    $qdiiGraphics.FillEllipse($qdiiBrush,($qdiiScale*0.025),($qdiiScale*0.025),($qdiiScale*0.95),($qdiiScale*0.95))
    $qdiiFormat = New-Object System.Drawing.StringFormat
    $qdiiFormat.Alignment = [System.Drawing.StringAlignment]::Center
    $qdiiFormat.LineAlignment = [System.Drawing.StringAlignment]::Center
    $qdiiRect = New-Object System.Drawing.RectangleF 0,(-$qdiiScale*0.025),$qdiiScale,$qdiiScale
    $qdiiGraphics.DrawString('Q',$qdiiFont,[System.Drawing.Brushes]::White,$qdiiRect,$qdiiFormat)
    $qdiiSmall = New-Object System.Drawing.Bitmap $qdiiSize,$qdiiSize
    $qdiiSmallGraphics = [System.Drawing.Graphics]::FromImage($qdiiSmall)
    $qdiiSmallGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $qdiiSmallGraphics.DrawImage($qdiiBitmap,0,0,$qdiiSize,$qdiiSize)
    $qdiiPng = New-Object System.IO.MemoryStream
    $qdiiSmall.Save($qdiiPng,[System.Drawing.Imaging.ImageFormat]::Png)
    $qdiiImages += ,$qdiiPng.ToArray()
    $qdiiPng.Dispose(); $qdiiSmallGraphics.Dispose(); $qdiiSmall.Dispose(); $qdiiFormat.Dispose(); $qdiiFont.Dispose(); $qdiiBrush.Dispose(); $qdiiGraphics.Dispose(); $qdiiBitmap.Dispose()
}
$qdiiWriter = New-Object System.IO.BinaryWriter ([System.IO.File]::Create($qdiiIconFile))
try {
    $qdiiWriter.Write([uint16]0); $qdiiWriter.Write([uint16]1); $qdiiWriter.Write([uint16]$qdiiSizes.Length)
    $qdiiOffset = 6 + 16 * $qdiiSizes.Length
    for($qdiiI=0; $qdiiI -lt $qdiiSizes.Length; $qdiiI++) {
        $qdiiDimension = if($qdiiSizes[$qdiiI] -eq 256){0}else{$qdiiSizes[$qdiiI]}
        $qdiiWriter.Write([byte]$qdiiDimension); $qdiiWriter.Write([byte]$qdiiDimension); $qdiiWriter.Write([byte]0); $qdiiWriter.Write([byte]0)
        $qdiiWriter.Write([uint16]1); $qdiiWriter.Write([uint16]32); $qdiiWriter.Write([uint32]$qdiiImages[$qdiiI].Length); $qdiiWriter.Write([uint32]$qdiiOffset)
        $qdiiOffset += $qdiiImages[$qdiiI].Length
    }
    foreach($qdiiImage in $qdiiImages){$qdiiWriter.Write([byte[]]$qdiiImage)}
} finally { $qdiiWriter.Dispose() }
$qdiiOutput = Join-Path $qdiiRoot 'QdiiHelp.exe'
& $qdiiCompiler /nologo /target:winexe /optimize+ /platform:anycpu "/win32icon:$qdiiIconFile" "/out:$qdiiOutput" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Net.Http.dll /reference:System.Web.Extensions.dll (Join-Path $PSScriptRoot 'TrayApp.cs')
if ($LASTEXITCODE -ne 0) { throw '托盘程序编译失败。' }
Write-Output "已生成 $qdiiOutput"
