# Export every slide of a .pptx to PNG through desktop PowerPoint (COM), for visual review.
#
#   powershell -ExecutionPolicy Bypass -File docs/deck/export_slides.ps1 -Deck tmp/deck/out/IskAI_Defense_Deck.pptx -OutDir tmp/deck/out/png
#
# Also prints the transition of each slide as PowerPoint reads it, so "Morph" can be confirmed
# without opening the Transitions tab by hand. Requires Microsoft 365 or PowerPoint 2019+.

param(
    [string]$Deck = "tmp/deck/out/IskAI_Defense_Deck.pptx",
    [string]$OutDir = "tmp/deck/out/png",
    [int]$Width = 1920
)

$deckPath = (Resolve-Path $Deck).Path
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$outPath = (Resolve-Path $OutDir).Path

$app = New-Object -ComObject PowerPoint.Application
try {
    # msoTrue = -1, msoFalse = 0; open read-only, untitled, without a window
    $pres = $app.Presentations.Open($deckPath, -1, 0, 0)
    $i = 0
    foreach ($slide in $pres.Slides) {
        $i++
        $png = Join-Path $outPath ("slide-{0:00}.png" -f $i)
        $slide.Export($png, "PNG", $Width, [int]($Width * 9 / 16))
        $effect = $slide.SlideShowTransition.EntryEffect
        $dur = $slide.SlideShowTransition.Duration
        # Observed from PowerPoint 365 16.0.20326 on 2026-09-14: Morph by object = 3954, by word = 3955,
        # by character = 3956; ppEffectFade = 1793; 0 = none.
        $name = switch ($effect) { 3954 { "Morph (objects)" } 3955 { "Morph (words)" } 3956 { "Morph (chars)" } 1793 { "Fade" } 0 { "none" } default { "effect $effect" } }
        Write-Output ("slide {0:00}  {1,-16}  {2,5:0.00}s  {3}" -f $i, $name, $dur, $png)
    }
    $pres.Close()
} finally {
    $app.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($app) | Out-Null
}
