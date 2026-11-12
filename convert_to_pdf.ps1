try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    Write-Host "Word COM is available"
    $docPath = (Resolve-Path ".\System_Implementation_Letter.docx").Path
    $pdfPath = [System.IO.Path]::Combine((Resolve-Path ".").Path, "System_Implementation_Letter.pdf")
    $doc = $word.Documents.Open($docPath)
    $wdFormatPDF = 17
    $doc.SaveAs([ref]$pdfPath, [ref]$wdFormatPDF)
    $doc.Close()
    $word.Quit()
    Write-Host "Successfully generated PDF: $pdfPath"
} catch {
    Write-Host "Word COM not available or failed: $($_.Exception.Message)"
}
