# Deterministic Visual Re-entry Comparison V1 capability fixture.
# Two subject thoughts form one explicit comparison; later co-occurrence is
# explicitly denied and must remain text-only.

Add-Type -AssemblyName System.Speech

$artifactDir = Join-Path $PSScriptRoot "..\artifacts\visual-reentry-comparison-v1"
if (-not (Test-Path -LiteralPath $artifactDir)) {
  New-Item -ItemType Directory -Path $artifactDir | Out-Null
}

$outputPath = Join-Path $artifactDir "comparison-capability-proof.wav"
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
  48000,
  [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
  [System.Speech.AudioFormat.AudioChannel]::Mono
)
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice("Microsoft Zira Desktop")
$synth.Rate = 1
$synth.SetOutputToWaveFile($outputPath, $format)
$synth.SpeakSsml(@'
<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">
  <break time="350ms"/>
  Option A is cheaper and faster to set up.<break time="250ms"/>
  Option B costs more, but it gives you more control.<break time="300ms"/>
  I'm still deciding which one I would actually choose.<break time="300ms"/>
  I've also been testing Claude and Gemini, but I'm not comparing them right now.<break time="300ms"/>
  That is a separate question for another day.<break time="900ms"/>
</speak>
'@)
$synth.SetOutputToNull()
$synth.Dispose()

Get-Item -LiteralPath $outputPath | Select-Object FullName, Length
