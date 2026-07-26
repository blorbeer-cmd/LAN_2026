Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$RepoRoot = "C:\Users\BOB\LAN_2026"
$ServerDir = Join-Path $RepoRoot "server"
$LogDir = Join-Path $RepoRoot "logs"
$AccessToken = "NudelGehtImmer"   # nur im Legacy-Modus genutzt; in "required" ignoriert
$TunnelName = "lan2026"

# --- Vorgaben fuer die GUI-Felder (koennen im Fenster ueberschrieben werden) ---
$DefaultAuthRequired = $true       # Checkbox-Vorgabe: $true = required, $false = legacy
$DefaultAdmin1Name   = "Bob"
$DefaultAdmin1Pass   = ""          # leer lassen und im Fenster eintragen
$DefaultAdmin2Name   = ""
$DefaultAdmin2Pass   = ""

# --- Optionale Extras (nur bei Bedarf, kein GUI-Feld) ---
$AdminRecoveryCode = ""            # optional; lokal ohne NODE_ENV=production nicht zwingend
$KioskToken        = ""            # optional; leer = Kiosk im required-Modus gesperrt
# $env:COOKIE_SECURE bewusst NICHT gesetzt: Auslieferung laeuft ueber den HTTPS-Tunnel,
# sichere Cookies funktionieren dort. Nur fuer nacktes http://<LAN-IP> auf "0" setzen.

if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$ServerOutLog = Join-Path $LogDir "server.out.log"
$ServerErrLog = Join-Path $LogDir "server.err.log"
$TunnelOutLog = Join-Path $LogDir "tunnel.out.log"
$TunnelErrLog = Join-Path $LogDir "tunnel.err.log"

$script:ServerProcess = $null
$script:TunnelProcess = $null
$script:reallyExit = $false

# GUI-Referenzen (werden weiter unten befuellt; Start-ServerProc liest sie zur Laufzeit)
$script:chkRequired   = $null
$script:txtAdmin1Name = $null
$script:txtAdmin1Pass = $null
$script:txtAdmin2Name = $null
$script:txtAdmin2Pass = $null

function Stop-All {
    Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Get-Process -Name cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    $script:ServerProcess = $null
    $script:TunnelProcess = $null
}

function Start-ServerProc {
    # Auth-Modus aus der Checkbox (Fallback: Vorgabe oben)
    $requiredOn = $DefaultAuthRequired
    if ($script:chkRequired) { $requiredOn = $script:chkRequired.Checked }
    $env:AUTH_MODE    = if ($requiredOn) { "required" } else { "legacy" }
    $env:ACCESS_TOKEN = $AccessToken

    if ($AdminRecoveryCode) { $env:ADMIN_RECOVERY_CODE = $AdminRecoveryCode }
    else { Remove-Item Env:ADMIN_RECOVERY_CODE -ErrorAction SilentlyContinue }
    if ($KioskToken) { $env:KIOSK_TOKEN = $KioskToken }
    else { Remove-Item Env:KIOSK_TOKEN -ErrorAction SilentlyContinue }

    # Stale Bootstrap-Werte immer erst entfernen, dann frisch aus der GUI setzen
    Remove-Item Env:BOOTSTRAP_ADMIN_1_NAME     -ErrorAction SilentlyContinue
    Remove-Item Env:BOOTSTRAP_ADMIN_1_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:BOOTSTRAP_ADMIN_2_NAME     -ErrorAction SilentlyContinue
    Remove-Item Env:BOOTSTRAP_ADMIN_2_PASSWORD -ErrorAction SilentlyContinue

    if ($requiredOn) {
        $n1 = if ($script:txtAdmin1Name) { $script:txtAdmin1Name.Text.Trim() } else { $DefaultAdmin1Name }
        $p1 = if ($script:txtAdmin1Pass) { $script:txtAdmin1Pass.Text }        else { $DefaultAdmin1Pass }
        $n2 = if ($script:txtAdmin2Name) { $script:txtAdmin2Name.Text.Trim() } else { $DefaultAdmin2Name }
        $p2 = if ($script:txtAdmin2Pass) { $script:txtAdmin2Pass.Text }        else { $DefaultAdmin2Pass }
        if ($n1 -and $p1) { $env:BOOTSTRAP_ADMIN_1_NAME = $n1; $env:BOOTSTRAP_ADMIN_1_PASSWORD = $p1 }
        if ($n2 -and $p2) { $env:BOOTSTRAP_ADMIN_2_NAME = $n2; $env:BOOTSTRAP_ADMIN_2_PASSWORD = $p2 }
    }

    $script:ServerProcess = Start-Process -FilePath "node" -ArgumentList @("dist/index.js") -WorkingDirectory $ServerDir -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $ServerOutLog -RedirectStandardError $ServerErrLog
}

function Start-TunnelProc {
    $script:TunnelProcess = Start-Process -FilePath "cloudflared" -ArgumentList @("tunnel","run",$TunnelName) -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $TunnelOutLog -RedirectStandardError $TunnelErrLog
}

function Test-ServerHealthy {
    try { (Invoke-WebRequest -Uri "http://localhost:3000/api/health" -Headers @{ "x-access-token" = $AccessToken } -TimeoutSec 3 -UseBasicParsing).StatusCode -eq 200 }
    catch { $false }
}

function Test-TunnelHealthy {
    try { (Invoke-WebRequest -Uri "http://127.0.0.1:20241/ready" -TimeoutSec 3 -UseBasicParsing).StatusCode -eq 200 }
    catch { $false }
}

function Get-CurrentBranch {
    (& git -C $RepoRoot rev-parse --abbrev-ref HEAD 2>&1 | Out-String).Trim()
}

$form = New-Object System.Windows.Forms.Form
$form.Text = "RespawnHQ Kontrolle"
$form.Size = New-Object System.Drawing.Size(380,500)
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.StartPosition = "CenterScreen"

$panelServer = New-Object System.Windows.Forms.Panel
$panelServer.Size = New-Object System.Drawing.Size(14,14)
$panelServer.Location = New-Object System.Drawing.Point(20,25)
$panelServer.BackColor = 'Gray'
$form.Controls.Add($panelServer)

$lblServer = New-Object System.Windows.Forms.Label
$lblServer.Text = "Server: prueft..."
$lblServer.Location = New-Object System.Drawing.Point(42,20)
$lblServer.Size = New-Object System.Drawing.Size(300,25)
$lblServer.Font = New-Object System.Drawing.Font("Segoe UI", 11)
$form.Controls.Add($lblServer)

$panelTunnel = New-Object System.Windows.Forms.Panel
$panelTunnel.Size = New-Object System.Drawing.Size(14,14)
$panelTunnel.Location = New-Object System.Drawing.Point(20,60)
$panelTunnel.BackColor = 'Gray'
$form.Controls.Add($panelTunnel)

$lblTunnel = New-Object System.Windows.Forms.Label
$lblTunnel.Text = "Tunnel: prueft..."
$lblTunnel.Location = New-Object System.Drawing.Point(42,55)
$lblTunnel.Size = New-Object System.Drawing.Size(300,25)
$lblTunnel.Font = New-Object System.Drawing.Font("Segoe UI", 11)
$form.Controls.Add($lblTunnel)

$lblBranchCaption = New-Object System.Windows.Forms.Label
$lblBranchCaption.Text = "Branch:"
$lblBranchCaption.Location = New-Object System.Drawing.Point(20,90)
$lblBranchCaption.Size = New-Object System.Drawing.Size(50,20)
$lblBranchCaption.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$form.Controls.Add($lblBranchCaption)

$txtBranch = New-Object System.Windows.Forms.TextBox
$txtBranch.Location = New-Object System.Drawing.Point(75,88)
$txtBranch.Size = New-Object System.Drawing.Size(280,22)
$txtBranch.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$form.Controls.Add($txtBranch)

# --- Login-Einstellungen (Auth-Modus + Start-Admins) ---
$grpLogin = New-Object System.Windows.Forms.GroupBox
$grpLogin.Text = "Login-Einstellungen"
$grpLogin.Location = New-Object System.Drawing.Point(20,118)
$grpLogin.Size = New-Object System.Drawing.Size(340,150)
$form.Controls.Add($grpLogin)

$chkRequired = New-Object System.Windows.Forms.CheckBox
$chkRequired.Text = "Persoenliche Logins (aus = Legacy)"
$chkRequired.Location = New-Object System.Drawing.Point(14,22)
$chkRequired.Size = New-Object System.Drawing.Size(315,22)
$chkRequired.Checked = $DefaultAuthRequired
$grpLogin.Controls.Add($chkRequired)
$script:chkRequired = $chkRequired

$lblAdmins = New-Object System.Windows.Forms.Label
$lblAdmins.Text = "Erste Admins (Name / Passwort) - nur beim ersten Start noetig:"
$lblAdmins.Location = New-Object System.Drawing.Point(14,50)
$lblAdmins.Size = New-Object System.Drawing.Size(315,18)
$lblAdmins.Font = New-Object System.Drawing.Font("Segoe UI", 8)
$grpLogin.Controls.Add($lblAdmins)

$txtAdmin1Name = New-Object System.Windows.Forms.TextBox
$txtAdmin1Name.Location = New-Object System.Drawing.Point(14,72)
$txtAdmin1Name.Size = New-Object System.Drawing.Size(150,22)
$txtAdmin1Name.Text = $DefaultAdmin1Name
$grpLogin.Controls.Add($txtAdmin1Name)
$script:txtAdmin1Name = $txtAdmin1Name

$txtAdmin1Pass = New-Object System.Windows.Forms.TextBox
$txtAdmin1Pass.Location = New-Object System.Drawing.Point(174,72)
$txtAdmin1Pass.Size = New-Object System.Drawing.Size(150,22)
$txtAdmin1Pass.UseSystemPasswordChar = $true
$txtAdmin1Pass.Text = $DefaultAdmin1Pass
$grpLogin.Controls.Add($txtAdmin1Pass)
$script:txtAdmin1Pass = $txtAdmin1Pass

$txtAdmin2Name = New-Object System.Windows.Forms.TextBox
$txtAdmin2Name.Location = New-Object System.Drawing.Point(14,100)
$txtAdmin2Name.Size = New-Object System.Drawing.Size(150,22)
$txtAdmin2Name.Text = $DefaultAdmin2Name
$grpLogin.Controls.Add($txtAdmin2Name)
$script:txtAdmin2Name = $txtAdmin2Name

$txtAdmin2Pass = New-Object System.Windows.Forms.TextBox
$txtAdmin2Pass.Location = New-Object System.Drawing.Point(174,100)
$txtAdmin2Pass.Size = New-Object System.Drawing.Size(150,22)
$txtAdmin2Pass.UseSystemPasswordChar = $true
$txtAdmin2Pass.Text = $DefaultAdmin2Pass
$grpLogin.Controls.Add($txtAdmin2Pass)
$script:txtAdmin2Pass = $txtAdmin2Pass

$logBox = New-Object System.Windows.Forms.TextBox
$logBox.Multiline = $true
$logBox.ScrollBars = "Vertical"
$logBox.ReadOnly = $true
$logBox.Location = New-Object System.Drawing.Point(20,278)
$logBox.Size = New-Object System.Drawing.Size(340,80)
$form.Controls.Add($logBox)

function Write-Log($msg) {
    $logBox.AppendText("$(Get-Date -Format 'HH:mm:ss') $msg`r`n")
}

$btnUpdate = New-Object System.Windows.Forms.Button
$btnUpdate.Text = "Update && Neustart"
$btnUpdate.Location = New-Object System.Drawing.Point(20,368)
$btnUpdate.Size = New-Object System.Drawing.Size(165,32)
$form.Controls.Add($btnUpdate)

$btnRestart = New-Object System.Windows.Forms.Button
$btnRestart.Text = "Nur Neustart"
$btnRestart.Location = New-Object System.Drawing.Point(195,368)
$btnRestart.Size = New-Object System.Drawing.Size(165,32)
$form.Controls.Add($btnRestart)

$btnServerLog = New-Object System.Windows.Forms.Button
$btnServerLog.Text = "Server-Log"
$btnServerLog.Location = New-Object System.Drawing.Point(20,406)
$btnServerLog.Size = New-Object System.Drawing.Size(165,32)
$form.Controls.Add($btnServerLog)

$btnTunnelLog = New-Object System.Windows.Forms.Button
$btnTunnelLog.Text = "Tunnel-Log"
$btnTunnelLog.Location = New-Object System.Drawing.Point(195,406)
$btnTunnelLog.Size = New-Object System.Drawing.Size(165,32)
$form.Controls.Add($btnTunnelLog)

$btnUpdate.Add_Click({
    $branch = $txtBranch.Text.Trim()
    if (-not $branch) {
        Write-Log "Bitte zuerst einen Branch-Namen eintragen."
        return
    }
    $btnUpdate.Enabled = $false; $btnRestart.Enabled = $false
    Write-Log "Stoppe Server und Tunnel..."
    Stop-All
    Start-Sleep -Seconds 2

    Write-Log "Hole '$branch' vom Remote..."
    Write-Log ((& git -C $RepoRoot fetch origin $branch 2>&1 | Out-String).Trim())

    # Wirft absichtlich jede lokale Abweichung in diesem Checkout weg: dieser
    # Klon dient nur der Vorschau von Branches, nicht als Arbeitskopie mit
    # eigenen Aenderungen. So zeigt "Update" immer garantiert exakt den
    # aktuellen Remote-Stand, nie einen alten/lokal abgewichenen Zwischenstand.
    Write-Log ((& git -C $RepoRoot reset --hard HEAD 2>&1 | Out-String).Trim())
    Write-Log ((& git -C $RepoRoot checkout -B $branch "origin/$branch" 2>&1 | Out-String).Trim())

    if ((Get-CurrentBranch) -ne $branch) {
        Write-Log "FEHLER: Branch '$branch' wurde nicht gefunden (Tippfehler? noch nicht gepusht?). Abgebrochen."
        $btnUpdate.Enabled = $true; $btnRestart.Enabled = $true
        return
    }

    $form.Text = "RespawnHQ Kontrolle - $branch"
    Write-Log "npm install..."
    & npm --prefix $ServerDir install 2>&1 | Out-Null
    Write-Log "npm run build..."
    & npm --prefix $ServerDir run build 2>&1 | Out-Null
    Write-Log "Starte neu (Modus: $(if ($chkRequired.Checked) { 'required' } else { 'legacy' }))..."
    Start-ServerProc
    Start-TunnelProc
    Write-Log "Fertig: '$branch' laeuft jetzt."
    $btnUpdate.Enabled = $true; $btnRestart.Enabled = $true
})

$btnRestart.Add_Click({
    Write-Log "Starte neu (Modus: $(if ($chkRequired.Checked) { 'required' } else { 'legacy' }))..."
    Stop-All
    Start-Sleep -Seconds 2
    Start-ServerProc
    Start-TunnelProc
    Write-Log "Neu gestartet."
})

$btnServerLog.Add_Click({ Start-Process notepad $ServerErrLog })
$btnTunnelLog.Add_Click({ Start-Process notepad $TunnelErrLog })

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 4000
$timer.Add_Tick({
    if (Test-ServerHealthy) { $lblServer.Text = "Server: laeuft"; $panelServer.BackColor = 'Green' }
    else { $lblServer.Text = "Server: offline"; $panelServer.BackColor = 'Red' }
    if (Test-TunnelHealthy) { $lblTunnel.Text = "Tunnel: verbunden"; $panelTunnel.BackColor = 'Green' }
    else { $lblTunnel.Text = "Tunnel: offline"; $panelTunnel.BackColor = 'Red' }
})
$timer.Start()

$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
$notifyIcon.Text = "RespawnHQ Kontrolle"
$notifyIcon.Visible = $true

$contextMenu = New-Object System.Windows.Forms.ContextMenuStrip
$menuShow = $contextMenu.Items.Add("Anzeigen")
$menuExit = $contextMenu.Items.Add("Beenden (stoppt Server + Tunnel)")
$notifyIcon.ContextMenuStrip = $contextMenu

$menuShow.Add_Click({ $form.Show(); $form.WindowState = 'Normal'; $form.Activate() })
$notifyIcon.Add_DoubleClick({ $form.Show(); $form.WindowState = 'Normal'; $form.Activate() })
$menuExit.Add_Click({
    $script:reallyExit = $true
    $notifyIcon.Visible = $false
    $form.Close()
})

$form.Add_Resize({
    if ($form.WindowState -eq 'Minimized') { $form.Hide() }
})

$form.Add_FormClosing({
    param($sender, $e)
    if (-not $script:reallyExit) {
        $e.Cancel = $true
        $form.Hide()
    } else {
        Stop-All
    }
})

$form.Add_Shown({
    $txtBranch.Text = Get-CurrentBranch
    $form.Text = "RespawnHQ Kontrolle - $($txtBranch.Text)"
    Write-Log "Raeume alte Prozesse auf..."
    Stop-All
    Start-Sleep -Seconds 1
    Write-Log "Starte Server und Tunnel (Modus: $(if ($chkRequired.Checked) { 'required' } else { 'legacy' }))..."
    Start-ServerProc
    Start-TunnelProc
})

[System.Windows.Forms.Application]::Run($form)