# overlay.ps1 — borda de "computer use" (protótipo 16/10/2026, v4)
# Janela WPF borderless/topmost/click-through que desenha a marca de que o
# agente está mexendo na máquina.
# v3: o traço sólido virou um **degradê da borda para o centro**.
# v4 (ajustes pedidos pelo Felipe em 16/10):
#   1. sem cantos arredondados — moldura reta;
#   2. colada na borda REAL do alvo (inset 0), e no modo janela usando a
#      moldura visível do DWM (EXTENDED_FRAME_BOUNDS), senão a janela
#      maximizada deixa o vão da borda invisível de redimensionamento;
#   3. pulsação leve (opacidade 1.0 <-> 0.62) + rótulo no topo, no idioma da UI;
#      v4.2: sem pílula; texto sobre um retângulo preto bem transparente
#      (contraste no fundo claro, sem virar caixa).
#   4. a vida da moldura é comandada pelo plugin (agente agindo / pausado), e
#      -HoldMs fica só como rede de segurança.
# Dois modos:
#   -Mode desktop            : moldura em volta da tela inteira (controle do PC)
#   -Mode window -Pid <pid>  : moldura em volta da janela do processo, seguindo
#                              a posição da janela ao vivo (controle de janela)
# A janela nunca rouba foco (WS_EX_NOACTIVATE) nem recebe clique (WS_EX_TRANSPARENT).
param(
  [ValidateSet('desktop','window')] [string]$Mode = 'window',
  [int]$TargetPid = 0,
  [int]$WindowId = 0,
  [int]$HoldMs = 90000,
  [string]$Label = '',
  [string]$WriteHandle = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CuaBorderNative {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern uint GetDpiForSystem();
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW")] public static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attr, out RECT value, int size);
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
'@

[void][CuaBorderNative]::SetProcessDPIAware()
$script:scale = [CuaBorderNative]::GetDpiForSystem() / 96.0

# Estilo por modo. -inset 0 = encostado na borda real.
if ($Mode -eq 'desktop') {
  $script:inset     = 0    # px entre a moldura e a borda real da tela
  $script:fadeDepth = 80   # profundidade do degradê borda->centro (px)
} else {
  $script:inset     = 0
  $script:fadeDepth = 44
}
$script:pulseMin = 0.62      # opacidade mínima da pulsação
$script:pulseMs  = 1500      # meia-volta da pulsação (ms)

# Moldura VISÍVEL da janela: GetWindowRect inclui a borda invisível de
# redimensionamento (que numa janela maximizada sai da tela), e era isso que
# deixava o "vão" que o Felipe viu. DWMWA_EXTENDED_FRAME_BOUNDS (9) devolve o
# retângulo que se vê; GetWindowRect fica como plano B.
$DWMWA_EXTENDED_FRAME_BOUNDS = 9
function Get-VisibleRect {
  param([IntPtr]$Hwnd)
  $r = New-Object CuaBorderNative+RECT
  try {
    $hr = [CuaBorderNative]::DwmGetWindowAttribute($Hwnd, $DWMWA_EXTENDED_FRAME_BOUNDS, [ref]$r, 16)
    if ($hr -eq 0 -and ($r.Right - $r.Left) -gt 0 -and ($r.Bottom - $r.Top) -gt 0) { return $r }
  } catch { }
  $rr = New-Object CuaBorderNative+RECT
  [void][CuaBorderNative]::GetWindowRect($Hwnd, [ref]$rr)
  return $rr
}

# Encontra a primeira janela visivel do pid (quadro de "window").
$script:targetHwnd = [IntPtr]::Zero
if ($Mode -eq 'window') {
  if ($WindowId -ne 0) {
    $script:targetHwnd = [IntPtr]$WindowId
  } elseif ($TargetPid -gt 0) {
    # ponytail: MainWindowHandle pega so a janela principal do processo; quando o
    # tool souber o window_id, ele vem por -WindowId e cobre qualquer janela.
    $proc = Get-Process -Id $TargetPid -ErrorAction SilentlyContinue
    if ($null -ne $proc) { $script:targetHwnd = [IntPtr]$proc.MainWindowHandle }
  }
  if ($script:targetHwnd -eq [IntPtr]::Zero -or -not [CuaBorderNative]::IsWindow($script:targetHwnd)) {
    exit 0 # nada para emoldurar
  }
}

# --- Janela WPF ---
$w = New-Object System.Windows.Window
$w.WindowStyle = [System.Windows.WindowStyle]::None
$w.AllowsTransparency = $true
$w.Background = [System.Windows.Media.Brushes]::Transparent
$w.Topmost = $true
$w.ShowInTaskbar = $false
$w.ResizeMode = [System.Windows.ResizeMode]::NoResize

# Degradê da borda para o centro: 4 faixas (topo/base/esq/dir) com a cor cheia
# no contorno e alfa 0 no fim da faixa. v4: sem clip — canto reto.
$script:baseColor = [System.Windows.Media.Color]'#2DD4BF'

function New-FadeRect {
  param([string]$Edge, [double]$Depth, [System.Windows.Media.Color]$Color)
  $r = New-Object System.Windows.Shapes.Rectangle
  $b = New-Object System.Windows.Media.LinearGradientBrush
  $b.StartPoint = New-Object System.Windows.Point(0, 0)
  $b.EndPoint = New-Object System.Windows.Point(0, 1)
  switch ($Edge) {
    'top'    { $r.VerticalAlignment = 'Top';    $r.Height = $Depth }
    'bottom' { $b.StartPoint = New-Object System.Windows.Point(0, 1); $b.EndPoint = New-Object System.Windows.Point(0, 0)
               $r.VerticalAlignment = 'Bottom'; $r.Height = $Depth }
    'left'   { $b.StartPoint = New-Object System.Windows.Point(0, 0); $b.EndPoint = New-Object System.Windows.Point(1, 0)
               $r.HorizontalAlignment = 'Left'; $r.Width = $Depth }
    'right'  { $b.StartPoint = New-Object System.Windows.Point(1, 0); $b.EndPoint = New-Object System.Windows.Point(0, 0)
               $r.HorizontalAlignment = 'Right'; $r.Width = $Depth }
  }
  foreach ($spec in @(@(0.0, 240), @(0.18, 150), @(0.50, 55), @(1.0, 0))) {
    $c = [System.Windows.Media.Color]::FromArgb([byte]$spec[1], $Color.R, $Color.G, $Color.B)
    [void]$b.GradientStops.Add((New-Object System.Windows.Media.GradientStop($c, [double]$spec[0])))
  }
  $r.Fill = $b
  return $r
}

$grid = New-Object System.Windows.Controls.Grid
# As faixas do degradê ficam num Grid próprio: é ELE que pulsa. O rótulo fica
# de fora, com opacidade constante — se pulsasse junto, a letra perdia
# contraste justo no ponto mais fraco do pulso (visto em 16/10).
$bandGrid = New-Object System.Windows.Controls.Grid
$fadeDepthDip = $script:fadeDepth / $script:scale
foreach ($edge in @('left', 'right', 'top', 'bottom')) {
  $bandGrid.Children.Add((New-FadeRect -Edge $edge -Depth $fadeDepthDip -Color $script:baseColor)) | Out-Null
}
[void]$grid.Children.Add($bandGrid)

# Rótulo no topo, no idioma da UI. v4.2 (Felipe, 16/10): retângulo PRETO bem
# transparente atrás do texto, só para dar contraste (sem borda, sem canto
# arredondado, sem pílula). A sombra fina na letra é o que segura a leitura
# quando o fundo por baixo é claro, sem precisar escurecer mais o retângulo.
if ($Label -ne '') {
  $plate = New-Object System.Windows.Controls.Border
  $plate.Background = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.Color]::FromArgb(130, 0, 0, 0))
  $plate.Padding = New-Object System.Windows.Thickness(10, 4, 10, 4)
  $plate.HorizontalAlignment = 'Center'
  $plate.VerticalAlignment = 'Top'
  $plate.Margin = New-Object System.Windows.Thickness(0, 10, 0, 0)
  $text = New-Object System.Windows.Controls.TextBlock
  $text.Text = $Label
  $text.FontSize = 13
  $text.FontWeight = [System.Windows.FontWeights]::SemiBold
  $text.Foreground = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.Color]'#5EEAD4')
  $shadow = New-Object System.Windows.Media.Effects.DropShadowEffect
  $shadow.BlurRadius = 4
  $shadow.ShadowDepth = 0
  $shadow.Opacity = 0.85
  $shadow.Color = [System.Windows.Media.Colors]::Black
  $text.Effect = $shadow
  $plate.Child = $text
  [void]$grid.Children.Add($plate)
}

$w.Content = $grid

# Pulsação leve: opacidade 1.0 -> 0.62 -> 1.0, ida e volta contínua.
$pulse = New-Object System.Windows.Media.Animation.DoubleAnimation
$pulse.From = 1.0
$pulse.To = $script:pulseMin
$pulse.Duration = New-Object System.Windows.Duration -ArgumentList ([TimeSpan]::FromMilliseconds($script:pulseMs))
$pulse.AutoReverse = $true
$pulse.RepeatBehavior = [System.Windows.Media.Animation.RepeatBehavior]::Forever
$pulseEase = New-Object System.Windows.Media.Animation.SineEase
$pulseEase.EasingMode = [System.Windows.Media.Animation.EasingMode]::EaseInOut
$pulse.EasingFunction = $pulseEase
$bandGrid.BeginAnimation([System.Windows.UIElement]::OpacityProperty, $pulse)
# Click-through + sem foco + invisivel no Alt-Tab (a moldura nunca interage).
$w.Add_SourceInitialized({
  $hwnd = (New-Object System.Windows.Interop.WindowInteropHelper($w)).Handle
  $GWL_EXSTYLE = -20
  $WS_EX_TRANSPARENT = 0x20
  $WS_EX_TOOLWINDOW = 0x80
  $WS_EX_LAYERED = 0x80000
  $WS_EX_NOACTIVATE = 0x08000000
  $cur = [CuaBorderNative]::GetWindowLongPtr($hwnd, $GWL_EXSTYLE).ToInt64()
  $new = $cur -bor $WS_EX_TRANSPARENT -bor $WS_EX_TOOLWINDOW -bor $WS_EX_LAYERED -bor $WS_EX_NOACTIVATE
  [void][CuaBorderNative]::SetWindowLongPtr($hwnd, $GWL_EXSTYLE, [IntPtr]$new)
})

# Posiciona a moldura encostada na borda real do alvo.
function Set-Frame {
  param([int]$X, [int]$Y, [int]$Wpx, [int]$Hpx)
  $i = $script:inset
  $w.Left = ($X + $i) / $script:scale
  $w.Top = ($Y + $i) / $script:scale
  $w.Width = ($Wpx - 2 * $i) / $script:scale
  $w.Height = ($Hpx - 2 * $i) / $script:scale
}

if ($Mode -eq 'desktop') {
  $x0 = [CuaBorderNative]::GetSystemMetrics(76); $y0 = [CuaBorderNative]::GetSystemMetrics(77)
  $cx = [CuaBorderNative]::GetSystemMetrics(78); $cy = [CuaBorderNative]::GetSystemMetrics(79)
  Set-Frame $x0 $y0 $cx $cy
} else {
  $r = Get-VisibleRect $script:targetHwnd
  Set-Frame $r.Left $r.Top ($r.Right - $r.Left) ($r.Bottom - $r.Top)
  # Segue a janela ao vivo.
  $track = New-Object System.Windows.Threading.DispatcherTimer
  $track.Interval = [TimeSpan]::FromMilliseconds(150)
  $track.Add_Tick({
    $h = $script:targetHwnd
    if ($h -eq [IntPtr]::Zero -or -not [CuaBorderNative]::IsWindow($h)) { [Environment]::Exit(0); return }
    if ([CuaBorderNative]::IsIconic($h)) { $w.Visibility = [System.Windows.Visibility]::Hidden; return }
    $rr = Get-VisibleRect $h
    Set-Frame $rr.Left $rr.Top ($rr.Right - $rr.Left) ($rr.Bottom - $rr.Top)
    $w.Visibility = [System.Windows.Visibility]::Visible
  })
  $track.Start()
}

$script:deadline = [DateTime]::UtcNow.AddMilliseconds($HoldMs)
$hold = New-Object System.Windows.Threading.DispatcherTimer
$hold.Interval = [TimeSpan]::FromSeconds(2)
$hold.Add_Tick({ if ([DateTime]::UtcNow -gt $script:deadline) { [Environment]::Exit(0) } })
$hold.Start()

$w.Show()
# Expõe o HWND da moldura para capturas de verificação (a moldura é
# WS_EX_TOOLWINDOW, então não aparece em MainWindowHandle/list_windows).
if ($WriteHandle -ne '') {
  $hwnd = (New-Object System.Windows.Interop.WindowInteropHelper($w)).Handle
  [System.IO.File]::WriteAllText($WriteHandle, $hwnd.ToInt64().ToString())
}
[System.Windows.Threading.Dispatcher]::Run()
