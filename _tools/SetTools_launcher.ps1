# SetTools_launcher.ps1 — Set Tools Desktop Launcher
# Double-click "Launch Set Tools.vbs" to start this.
# ─────────────────────────────────────────────────────────────────────────────

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Drawing.Imaging

$ToolsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir  = Split-Path -Parent $ToolsDir
$IconPath = Join-Path $ToolsDir "SetTools.ico"
$Port     = 8282
$script:ServerProcess = $null

# ── Generate Icon ─────────────────────────────────────────────────────────────
function New-SetToolsIcon {
    param($Path, $Size = 64)

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint  = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
    $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

    $bg      = [System.Drawing.Color]::FromArgb(14,  14,  15)
    $gold    = [System.Drawing.Color]::FromArgb(240, 192, 64)
    $darkGold= [System.Drawing.Color]::FromArgb(60,  48,  16)
    $border  = [System.Drawing.Color]::FromArgb(50,  50,  58)

    $g.Clear($bg)

    # Rounded background card
    $radius = [int]($Size * 0.22)
    $rect   = New-Object System.Drawing.Rectangle(1, 1, $Size - 2, $Size - 2)
    $path   = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc($rect.X, $rect.Y, $radius*2, $radius*2, 180, 90)
    $path.AddArc($rect.Right - $radius*2, $rect.Y, $radius*2, $radius*2, 270, 90)
    $path.AddArc($rect.Right - $radius*2, $rect.Bottom - $radius*2, $radius*2, $radius*2, 0, 90)
    $path.AddArc($rect.X, $rect.Bottom - $radius*2, $radius*2, $radius*2, 90, 90)
    $path.CloseFigure()

    $bgBrush = New-Object System.Drawing.SolidBrush($bg)
    $g.FillPath($bgBrush, $path)
    $pen = New-Object System.Drawing.Pen($border, 1.5)
    $g.DrawPath($pen, $path)

    # Clapperboard stripes (top band)
    $bandH = [int]($Size * 0.28)
    $clip  = New-Object System.Drawing.Region($path)
    $g.SetClip($clip)

    $stripeW = [int]($Size * 0.22)
    $brushG  = New-Object System.Drawing.SolidBrush($gold)
    $brushD  = New-Object System.Drawing.SolidBrush($darkGold)
    for ($i = -2; $i -lt 7; $i++) {
        $x = $i * $stripeW
        $pts = [System.Drawing.Point[]]@(
            [System.Drawing.Point]::new($x,              0),
            [System.Drawing.Point]::new($x + $stripeW,   0),
            [System.Drawing.Point]::new($x + [int]($stripeW * 0.6), $bandH),
            [System.Drawing.Point]::new($x - [int]($stripeW * 0.4), $bandH)
        )
        if ($i % 2 -eq 0) { $g.FillPolygon($brushG, $pts) }
        else               { $g.FillPolygon($brushD, $pts) }
    }

    # Divider line
    $divY = $bandH
    $lineB = New-Object System.Drawing.SolidBrush($gold)
    $g.FillRectangle($lineB, 0, $divY, $Size, [int]($Size * 0.05))

    # Dark body below stripe
    $bodyY = $divY + [int]($Size * 0.05)
    $bodyH = $Size - $bodyY
    $g.FillRectangle($bgBrush, 0, $bodyY, $Size, $bodyH)

    $g.ResetClip()

    # "ST" monogram
    $textY   = $bodyY + [int]($bodyH * 0.08)
    $textH   = $bodyH - [int]($bodyH * 0.16)
    $fontSize = [int]($Size * 0.36)
    $font    = New-Object System.Drawing.Font("Segoe UI", $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $sf      = New-Object System.Drawing.StringFormat
    $sf.Alignment     = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $textRect = New-Object System.Drawing.RectangleF(0, $textY, $Size, $textH)
    $brushText = New-Object System.Drawing.SolidBrush($gold)
    $g.DrawString("ST", $font, $brushText, $textRect, $sf)

    # Cleanup
    foreach ($obj in @($g, $font, $sf, $brushG, $brushD, $bgBrush, $brushText, $pen, $path, $clip)) {
        try { $obj.Dispose() } catch {}
    }

    # Save PNG then wrap into ICO
    $pngPath = [System.IO.Path]::ChangeExtension($Path, ".png")
    $bmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()

    # Build ICO wrapper around PNG (modern ICO supports embedded PNG)
    $pngBytes = [System.IO.File]::ReadAllBytes($pngPath)
    $fs  = [System.IO.File]::Open($Path, [System.IO.FileMode]::Create)
    $w   = New-Object System.IO.BinaryWriter($fs)
    $w.Write([uint16]0)                        # reserved
    $w.Write([uint16]1)                        # type: 1 = ICO
    $w.Write([uint16]1)                        # image count
    $w.Write([byte]0)                          # width  (0 = 256, fine for 64)
    $w.Write([byte]0)                          # height (0 = 256)
    $w.Write([byte]0)                          # color count
    $w.Write([byte]0)                          # reserved
    $w.Write([uint16]1)                        # color planes
    $w.Write([uint16]32)                       # bits per pixel
    $w.Write([uint32]$pngBytes.Length)         # image data size
    $w.Write([uint32]22)                       # offset (6+16)
    $w.Write($pngBytes)
    $w.Close(); $fs.Close()
    Remove-Item $pngPath -ErrorAction SilentlyContinue
}

if (-not (Test-Path $IconPath)) {
    New-SetToolsIcon -Path $IconPath -Size 64
}

# ── Server helpers ────────────────────────────────────────────────────────────
function Test-Port {
    try {
        $t = New-Object System.Net.Sockets.TcpClient
        $t.Connect("127.0.0.1", $Port)
        $t.Close()
        return $true
    } catch { return $false }
}

function Start-Server {
    if (Test-Port) { return $true }
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName         = "python"
    $psi.Arguments        = "-m http.server $Port --bind 127.0.0.1"
    $psi.WorkingDirectory = $RootDir
    $psi.WindowStyle      = [System.Diagnostics.ProcessWindowStyle]::Hidden
    $psi.CreateNoWindow   = $true
    $psi.UseShellExecute  = $false
    try {
        $script:ServerProcess = [System.Diagnostics.Process]::Start($psi)
    } catch {
        return $false
    }
    for ($i = 0; $i -lt 14; $i++) {
        Start-Sleep -Milliseconds 400
        if (Test-Port) { return $true }
    }
    return $false
}

function Stop-Server {
    if ($script:ServerProcess -and -not $script:ServerProcess.HasExited) {
        $script:ServerProcess.Kill()
    }
    $script:ServerProcess = $null
}

# ── Colour palette ────────────────────────────────────────────────────────────
$clrBg     = [System.Drawing.Color]::FromArgb(14,  14,  15)
$clrPanel  = [System.Drawing.Color]::FromArgb(22,  22,  24)
$clrBorder = [System.Drawing.Color]::FromArgb(42,  42,  50)
$clrGold   = [System.Drawing.Color]::FromArgb(240, 192, 64)
$clrText   = [System.Drawing.Color]::FromArgb(232, 232, 236)
$clrMuted  = [System.Drawing.Color]::FromArgb(92,  92,  110)
$clrGreen  = [System.Drawing.Color]::FromArgb(52,  211, 153)
$clrRed    = [System.Drawing.Color]::FromArgb(224, 90,  90)

# ── Build form ────────────────────────────────────────────────────────────────
$form = New-Object System.Windows.Forms.Form
$form.Text            = "Set Tools"
$form.ClientSize      = New-Object System.Drawing.Size(320, 196)
$form.MinimumSize     = New-Object System.Drawing.Size(320, 236)
$form.MaximumSize     = New-Object System.Drawing.Size(320, 236)
$form.BackColor       = $clrBg
$form.ForeColor       = $clrText
$form.StartPosition   = [System.Windows.Forms.FormStartPosition]::CenterScreen
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedSingle
$form.MaximizeBox     = $false
if (Test-Path $IconPath) {
    $form.Icon = New-Object System.Drawing.Icon($IconPath)
}

# Title
$lblTitle = New-Object System.Windows.Forms.Label
$lblTitle.Text      = "SET TOOLS"
$lblTitle.Font      = New-Object System.Drawing.Font("Segoe UI", 18, [System.Drawing.FontStyle]::Bold)
$lblTitle.ForeColor = $clrGold
$lblTitle.AutoSize  = $true
$lblTitle.Location  = New-Object System.Drawing.Point(20, 16)
$form.Controls.Add($lblTitle)

$lblSub = New-Object System.Windows.Forms.Label
$lblSub.Text      = "Film Production Dashboard"
$lblSub.Font      = New-Object System.Drawing.Font("Segoe UI", 8)
$lblSub.ForeColor = $clrMuted
$lblSub.AutoSize  = $true
$lblSub.Location  = New-Object System.Drawing.Point(22, 50)
$form.Controls.Add($lblSub)

# Separator
$sep = New-Object System.Windows.Forms.Panel
$sep.BackColor = $clrBorder
$sep.Size      = New-Object System.Drawing.Size(280, 1)
$sep.Location  = New-Object System.Drawing.Point(20, 72)
$form.Controls.Add($sep)

# Status row
$lblDot = New-Object System.Windows.Forms.Label
$lblDot.Text      = "●"
$lblDot.Font      = New-Object System.Drawing.Font("Segoe UI", 9)
$lblDot.ForeColor = $clrMuted
$lblDot.AutoSize  = $true
$lblDot.Location  = New-Object System.Drawing.Point(20, 84)
$form.Controls.Add($lblDot)

$lblStatus = New-Object System.Windows.Forms.Label
$lblStatus.Text      = "Idle"
$lblStatus.Font      = New-Object System.Drawing.Font("Segoe UI", 9)
$lblStatus.ForeColor = $clrMuted
$lblStatus.AutoSize  = $false
$lblStatus.Size      = New-Object System.Drawing.Size(248, 20)
$lblStatus.Location  = New-Object System.Drawing.Point(36, 84)
$form.Controls.Add($lblStatus)

# URL link
$lnkUrl = New-Object System.Windows.Forms.LinkLabel
$lnkUrl.Text            = "http://localhost:$Port"
$lnkUrl.Font            = New-Object System.Drawing.Font("Consolas", 8)
$lnkUrl.ForeColor       = $clrMuted
$lnkUrl.LinkColor       = $clrMuted
$lnkUrl.ActiveLinkColor = $clrGold
$lnkUrl.VisitedLinkColor= $clrMuted
$lnkUrl.AutoSize        = $true
$lnkUrl.Location        = New-Object System.Drawing.Point(22, 109)
$lnkUrl.Add_LinkClicked({ Start-Process "http://127.0.0.1:$Port/index.html" })
$form.Controls.Add($lnkUrl)

# ── Buttons ───────────────────────────────────────────────────────────────────
function New-Button($text, $x, $primary) {
    $b = New-Object System.Windows.Forms.Button
    $b.Text      = $text
    $b.Size      = New-Object System.Drawing.Size(130, 38)
    $b.Location  = New-Object System.Drawing.Point($x, 140)
    $b.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
    $b.Cursor    = [System.Windows.Forms.Cursors]::Hand
    $b.Font      = New-Object System.Drawing.Font("Segoe UI", 9)
    $b.FlatAppearance.BorderSize = 1
    if ($primary) {
        $b.BackColor = [System.Drawing.Color]::FromArgb(28, 24, 8)
        $b.ForeColor = $clrGold
        $b.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(80, 64, 16)
        $b.FlatAppearance.MouseOverBackColor = [System.Drawing.Color]::FromArgb(40, 34, 10)
    } else {
        $b.BackColor = $clrPanel
        $b.ForeColor = $clrText
        $b.FlatAppearance.BorderColor = $clrBorder
        $b.FlatAppearance.MouseOverBackColor = [System.Drawing.Color]::FromArgb(32, 32, 36)
    }
    $form.Controls.Add($b)
    return $b
}

$btnOpen = New-Button "⬡  Open Browser" 20 $true
$btnStop = New-Button "◼  Stop Server"  162 $false
$btnStop.Enabled = $false

# ── Status helper ─────────────────────────────────────────────────────────────
function Set-Status($color, $msg) {
    $lblDot.ForeColor    = $color
    $lblStatus.Text      = $msg
    $lblStatus.ForeColor = $color
    $form.Refresh()
}

# ── On load: start server + open browser ─────────────────────────────────────
$form.Add_Shown({
    if (Test-Port) {
        Set-Status $clrGreen "Server already running"
        $btnStop.Enabled = $true
    } else {
        Set-Status $clrMuted "Starting server…"
        if (Start-Server) {
            Set-Status $clrGreen "Server running"
            $btnStop.Enabled = $true
        } else {
            Set-Status $clrRed "Could not start — is Python installed?"
            return
        }
    }
    Start-Process "http://127.0.0.1:$Port/index.html"
})

$btnOpen.Add_Click({
    if (-not (Test-Port)) {
        Set-Status $clrMuted "Restarting server…"
        if (Start-Server) {
            Set-Status $clrGreen "Server running"
            $btnStop.Enabled = $true
        } else {
            Set-Status $clrRed "Could not start — is Python installed?"
            return
        }
    }
    Start-Process "http://127.0.0.1:$Port/index.html"
})

$btnStop.Add_Click({
    Stop-Server
    Set-Status $clrMuted "Server stopped"
    $btnStop.Enabled = $false
})

$form.Add_FormClosing({ Stop-Server })

# ── Create desktop shortcut on first run ─────────────────────────────────────
$shortcut = [System.Environment]::GetFolderPath("Desktop") + "\Set Tools.lnk"
if (-not (Test-Path $shortcut)) {
    try {
        $ws = New-Object -ComObject WScript.Shell
        $sc = $ws.CreateShortcut($shortcut)
        $vbsPath = Join-Path $RootDir "Launch Set Tools.vbs"
        $sc.TargetPath       = (Get-Command wscript.exe -ErrorAction SilentlyContinue).Source
        $sc.Arguments        = "`"$vbsPath`""
        $sc.WorkingDirectory = $RootDir
        $sc.Description      = "Set Tools — Film Production Dashboard"
        if (Test-Path $IconPath) { $sc.IconLocation = "$IconPath,0" }
        $sc.Save()
    } catch {}
}

[System.Windows.Forms.Application]::Run($form)
