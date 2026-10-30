# Encodes every <id>.wav from -In into <id>.mp3 in -Out with the built-in Windows
# MediaTranscoder (MP3 44.1 kHz mono 48 kbit/s). Used by make_voices_silero.py.
# Prints "id<TAB>bytes" per file. No Cyrillic in this script.
#   powershell -ExecutionPolicy Bypass -File ar\tools\wav_to_mp3.ps1 -In <dir> -Out <dir>
param([Parameter(Mandatory = $true)][string]$In, [Parameter(Mandatory = $true)][string]$Out)
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Media.Transcoding.MediaTranscoder, Windows.Media.Transcoding, ContentType = WindowsRuntime]
$null = [Windows.Media.Transcoding.PrepareTranscodeResult, Windows.Media.Transcoding, ContentType = WindowsRuntime]
$null = [Windows.Media.MediaProperties.MediaEncodingProfile, Windows.Media.MediaProperties, ContentType = WindowsRuntime]
$null = [Windows.Media.MediaProperties.AudioEncodingProperties, Windows.Media.MediaProperties, ContentType = WindowsRuntime]
$asTaskOp = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
$asTaskProg = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncActionWithProgress`1' } | Select-Object -First 1
function Await($op, [Type]$ResultType) { $task = $asTaskOp.MakeGenericMethod($ResultType).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
function AwaitProgress($op) { $task = $asTaskProg.MakeGenericMethod([double]).Invoke($null, @($op)); $task.Wait(-1) | Out-Null }

function Read-Stream($ras) {
  $ras.Seek(0)
  $s = [System.IO.WindowsRuntimeStreamExtensions]::AsStream($ras)
  $ms = New-Object System.IO.MemoryStream
  $s.CopyTo($ms)
  , $ms.ToArray()
}

$transcoder = New-Object Windows.Media.Transcoding.MediaTranscoder
function Encode([byte[]]$wav) {
  $src = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
  $w = [System.IO.WindowsRuntimeStreamExtensions]::AsStream($src)
  $w.Write($wav, 0, $wav.Length); $w.Flush()
  $src.Seek(0)
  $dst = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
  $p = [Windows.Media.MediaProperties.MediaEncodingProfile]::CreateMp3([Windows.Media.MediaProperties.AudioEncodingQuality]::Low)
  $p.Audio = [Windows.Media.MediaProperties.AudioEncodingProperties]::CreateMp3(44100, 1, 48000)
  $prep = Await ($transcoder.PrepareStreamTranscodeAsync($src, $dst, $p)) ([Windows.Media.Transcoding.PrepareTranscodeResult])
  if (-not $prep.CanTranscode) { throw "transcode is not possible: $($prep.FailureReason)" }
  AwaitProgress ($prep.TranscodeAsync())
  $bytes = Read-Stream $dst
  $src.Dispose(); $dst.Dispose()
  if ($bytes.Length -lt 200) { throw "transcode produced $($bytes.Length) bytes" }
  , $bytes
}

New-Item -ItemType Directory -Force -Path $Out | Out-Null
foreach ($f in Get-ChildItem -LiteralPath $In -Filter *.wav) {
  $bytes = Encode ([IO.File]::ReadAllBytes($f.FullName))
  $id = [IO.Path]::GetFileNameWithoutExtension($f.Name)
  [IO.File]::WriteAllBytes((Join-Path $Out "$id.mp3"), $bytes)
  Write-Output ("{0}`t{1}" -f $id, $bytes.Length)
}
