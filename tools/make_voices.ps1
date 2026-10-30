# Pre-recorded character voices for the AR construction site.
# Reads js/lines.json (UTF-8), synthesizes every line with Windows OneCore voices
# (Microsoft Pavel / Microsoft Irina, ru-RU) through WinRT SpeechSynthesizer,
# trims silence, normalizes, encodes (mp3 -> m4a -> wav fallback) with the built-in
# MediaTranscoder and writes assets/voice/<id>.<ext> + assets/voice/voice-manifest.json.
#
# Run (Windows PowerShell 5.1; Bypass applies to this process only):
#   powershell -ExecutionPolicy Bypass -File ar\tools\make_voices.ps1
#   ... -ListVoices | -Only a-brk-exc-1,c-wait-2 | -Force | -Format mp3|m4a|wav | -Out <dir>
# Nothing is written to the registry; voices are used as installed.
# The script itself contains no Cyrillic: all texts come from lines.json.

param(
  [switch]$ListVoices,
  [string[]]$Only = @(),
  [switch]$Force,
  [ValidateSet("mp3", "m4a", "wav")][string]$Format = "mp3",
  [string]$Out = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)   # ar/
if (-not $Out) { $Out = Join-Path $Root "assets\voice" }
$LinesPath = Join-Path $Root "js\lines.json"
$ManifestPath = Join-Path $Out "voice-manifest.json"
if ($Only.Count -eq 1 -and $Only[0].Contains(",")) { $Only = $Only[0].Split(",") }

# --- WinRT -------------------------------------------------------------------
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
$null = [Windows.Media.SpeechSynthesis.SpeechSynthesisStream, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
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

# --- WAV processing in C# (fast): mono, trim silence, peak normalize ----------
Add-Type -TypeDefinition @"
using System;
using System.IO;
public class WavResult { public byte[] Bytes; public double Dur; public int Rate; }
public static class WavTool {
  public static WavResult Process(byte[] wav, double thrDb, double keepSec, double peakDb) {
    int pos = 12, ch = 1, rate = 22050, bits = 16, dataOff = -1, dataLen = 0;
    while (pos + 8 <= wav.Length) {
      string id = System.Text.Encoding.ASCII.GetString(wav, pos, 4);
      int len = BitConverter.ToInt32(wav, pos + 4);
      if (id == "fmt ") { ch = BitConverter.ToInt16(wav, pos + 10); rate = BitConverter.ToInt32(wav, pos + 12); bits = BitConverter.ToInt16(wav, pos + 22); }
      else if (id == "data") { dataOff = pos + 8; dataLen = Math.Min(len, wav.Length - dataOff); break; }
      pos += 8 + len + (len & 1);
    }
    if (dataOff < 0 || bits != 16) throw new Exception("unsupported WAV (bits=" + bits + ")");
    int n = dataLen / (2 * ch);
    float[] x = new float[n];
    for (int i = 0; i < n; i++) {
      float s = 0;
      for (int c = 0; c < ch; c++) s += BitConverter.ToInt16(wav, dataOff + (i * ch + c) * 2);
      x[i] = s / ch / 32768f;
    }
    float thr = (float)Math.Pow(10, thrDb / 20);
    int a = 0, b = n - 1;
    while (a < n && Math.Abs(x[a]) < thr) a++;
    while (b > a && Math.Abs(x[b]) < thr) b--;
    int keep = (int)(keepSec * rate);
    a = Math.Max(0, a - keep); b = Math.Min(n - 1, b + keep);
    int m = Math.Max(1, b - a + 1);
    float peak = 1e-6f;
    for (int i = a; i <= b; i++) peak = Math.Max(peak, Math.Abs(x[i]));
    float g = (float)Math.Pow(10, peakDb / 20) / peak;
    int fade = Math.Min(m / 4, (int)(0.005 * rate));
    MemoryStream ms = new MemoryStream();
    BinaryWriter w = new BinaryWriter(ms);
    w.Write(System.Text.Encoding.ASCII.GetBytes("RIFF")); w.Write(36 + m * 2);
    w.Write(System.Text.Encoding.ASCII.GetBytes("WAVEfmt ")); w.Write(16); w.Write((short)1); w.Write((short)1);
    w.Write(rate); w.Write(rate * 2); w.Write((short)2); w.Write((short)16);
    w.Write(System.Text.Encoding.ASCII.GetBytes("data")); w.Write(m * 2);
    for (int i = 0; i < m; i++) {
      float env = 1f;
      if (i < fade) env = (float)i / fade; else if (m - 1 - i < fade) env = (float)(m - 1 - i) / fade;
      float v = x[a + i] * g * env;
      v = Math.Max(-1f, Math.Min(1f, v));
      w.Write((short)Math.Round(v * 32767));
    }
    w.Flush();
    WavResult r = new WavResult(); r.Bytes = ms.ToArray(); r.Dur = (double)m / rate; r.Rate = rate;
    return r;
  }
}
"@

# --- helpers -----------------------------------------------------------------
function Read-Stream($ras) {
  $ras.Seek(0)
  $s = [System.IO.WindowsRuntimeStreamExtensions]::AsStream($ras)
  $ms = New-Object System.IO.MemoryStream
  $s.CopyTo($ms)
  , $ms.ToArray()
}

function Escape-Ssml([string]$t) {
  $t = $t.Replace("+", "")                                         # Silero stress marks
  $t = $t.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;")
  $t = $t.Replace([string][char]0x2026, "<break time='200ms'/>")     # ellipsis
  $t = $t.Replace([string][char]0x2014, ",")                         # em dash -> pause
  $t
}

$synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
function Synthesize([string]$text, $voice, [double]$pitch, [double]$rate) {
  $synth.Voice = $voice
  $synth.Options.AudioPitch = $pitch
  $synth.Options.SpeakingRate = $rate
  $ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='ru-RU'>" + (Escape-Ssml $text) + "</speak>"
  $stream = Await ($synth.SynthesizeSsmlToStreamAsync($ssml)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
  $bytes = Read-Stream $stream
  $stream.Dispose()
  , $bytes
}

function Make-Profile([string]$fmt) {
  $MP = [Windows.Media.MediaProperties.MediaEncodingProfile]
  $AP = [Windows.Media.MediaProperties.AudioEncodingProperties]
  $Q = [Windows.Media.MediaProperties.AudioEncodingQuality]::Low
  if ($fmt -eq "mp3") { $p = $MP::CreateMp3($Q); $p.Audio = $AP::CreateMp3(44100, 1, 48000); return $p }
  if ($fmt -eq "m4a") { $p = $MP::CreateM4a($Q); $p.Audio = $AP::CreateAac(44100, 1, 96000); return $p }
  $null
}

$transcoder = New-Object Windows.Media.Transcoding.MediaTranscoder
function Encode([byte[]]$wav, [string]$fmt) {
  $src = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
  $w = [System.IO.WindowsRuntimeStreamExtensions]::AsStream($src)
  $w.Write($wav, 0, $wav.Length); $w.Flush()
  $src.Seek(0)
  $dst = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
  $prep = Await ($transcoder.PrepareStreamTranscodeAsync($src, $dst, (Make-Profile $fmt))) ([Windows.Media.Transcoding.PrepareTranscodeResult])
  if (-not $prep.CanTranscode) { throw "transcode to $fmt is not possible: $($prep.FailureReason)" }
  AwaitProgress ($prep.TranscodeAsync())
  $bytes = Read-Stream $dst
  $src.Dispose(); $dst.Dispose()
  if ($bytes.Length -lt 200) { throw "transcode to $fmt produced $($bytes.Length) bytes" }
  , $bytes
}

function Write-Utf8([string]$path, [string]$text) {
  [IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding $false))
}

# --- voices ------------------------------------------------------------------
$all = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices
if ($ListVoices) {
  $all | Select-Object DisplayName, Language, Gender | Format-Table -AutoSize | Out-String | Write-Host
  return
}
$ru = @($all | Where-Object { $_.Language -eq "ru-RU" })
$voices = @{}
foreach ($name in @("Pavel", "Irina")) {
  $v = $ru | Where-Object { $_.DisplayName -eq "Microsoft $name" } | Select-Object -First 1
  if (-not $v) { throw "Voice 'Microsoft $name' (ru-RU) is not installed. Settings > Time & language > Speech > Add voices > Russian." }
  $voices[$name] = $v
}

# --- lines -------------------------------------------------------------------
$data = Get-Content -Raw -Encoding UTF8 $LinesPath | ConvertFrom-Json
$items = @()
foreach ($set in @("classic", "adult")) {
  foreach ($cat in $data.$set.PSObject.Properties) {
    foreach ($ln in $cat.Value) {
      $role = $data.roles.($ln.who)
      if (-not $role) { throw "unknown role '$($ln.who)' in $($ln.id)" }
      $text = if ($ln.s) { $ln.s } else { $ln.t }
      $items += [pscustomobject]@{ id = $ln.id; role = $ln.who; text = $text; voice = $role.voice; pitch = [double]$role.pitch; rate = [double]$role.rate }
    }
  }
}
$ids = @{}
foreach ($it in $items) { if ($ids[$it.id]) { throw "duplicate id $($it.id)" }; $ids[$it.id] = 1 }

New-Item -ItemType Directory -Force -Path $Out | Out-Null
$old = $null
if (Test-Path $ManifestPath) { $old = Get-Content -Raw -Encoding UTF8 $ManifestPath | ConvertFrom-Json }

$fmt = $Format
$manifestItems = [ordered]@{}
$made = 0; $skipped = 0
foreach ($it in $items) {
  $prev = if ($old) { $old.items.($it.id) } else { $null }
  $want = $Only.Count -eq 0 -or $Only -contains $it.id
  $same = $prev -and $prev.text -eq $it.text -and $prev.role -eq $it.role -and [double]$prev.pitch -eq $it.pitch -and [double]$prev.rate -eq $it.rate -and $prev.voice -eq $it.voice -and (Test-Path (Join-Path $Out $prev.file))
  if (($same -and -not $Force) -or (-not $want -and $prev)) {
    $manifestItems[$it.id] = $prev; $skipped++
    continue
  }
  if (-not $want) { continue }
  $raw = Synthesize $it.text $voices[$it.voice] $it.pitch $it.rate
  $pr = [WavTool]::Process($raw, -45.0, 0.04, -1.0)
  $bytes = $null; $ext = $fmt
  while (-not $bytes) {
    if ($ext -eq "wav") { $bytes = $pr.Bytes; break }
    try { $bytes = Encode $pr.Bytes $ext }
    catch {
      $next = if ($ext -eq "mp3") { "m4a" } else { "wav" }
      Write-Warning "$($it.id): $ext failed ($($_.Exception.Message)); trying $next"
      $ext = $next; $fmt = $next
      if ($ext -eq "wav") { Write-Warning "falling back to WAV: files will be large" }
    }
  }
  if ($prev -and $prev.file -and $prev.file -ne "$($it.id).$ext") { Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $Out $prev.file) }
  $file = "$($it.id).$ext"
  [IO.File]::WriteAllBytes((Join-Path $Out $file), $bytes)
  $manifestItems[$it.id] = [ordered]@{ file = $file; role = $it.role; voice = $it.voice; text = $it.text; pitch = $it.pitch; rate = $it.rate; dur = [math]::Round($pr.Dur, 3); bytes = $bytes.Length }
  $made++
  Write-Host ("{0,-16} {1,5:N2} s {2,7} B  {3}" -f $it.id, $pr.Dur, $bytes.Length, $file)
}

# items removed from lines.json -> delete their files
if ($old) {
  foreach ($p in $old.items.PSObject.Properties) {
    if (-not $ids[$p.Name]) {
      Write-Host "removed: $($p.Name) ($($p.Value.file))"
      Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $Out $p.Value.file)
    }
  }
}

$formats = @($manifestItems.Values | ForEach-Object { [IO.Path]::GetExtension($_.file).TrimStart(".") } | Sort-Object -Unique)
$manifest = [ordered]@{
  format = ($formats -join ",")
  voices = [ordered]@{ Pavel = $voices["Pavel"].DisplayName; Irina = $voices["Irina"].DisplayName }
  items = $manifestItems
}
Write-Utf8 $ManifestPath ($manifest | ConvertTo-Json -Depth 6)

$total = 0; foreach ($v in $manifestItems.Values) { $total += [int64]$v.bytes }
$longest = $manifestItems.GetEnumerator() | Sort-Object { $_.Value.dur } -Descending | Select-Object -First 1
Write-Host ("made {0}, kept {1}, total {2} files, {3:N0} KB, format {4}; longest {5} ({6:N2} s)" -f $made, $skipped, $manifestItems.Count, ($total / 1KB), $manifest.format, $longest.Key, $longest.Value.dur)
