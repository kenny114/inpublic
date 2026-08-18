# Deterministic Visual Re-entry Cause/Effect V1 capability fixture.
# The first two thoughts form one explicit chain. The later temporal statement
# explicitly denies causal knowledge and must remain text-only.

Add-Type -AssemblyName System.Speech

$artifactDir = Join-Path $PSScriptRoot "..\artifacts\visual-reentry-cause-effect-v1"
if (-not (Test-Path -LiteralPath $artifactDir)) {
  New-Item -ItemType Directory -Path $artifactDir | Out-Null
}

$outputPath = Join-Path $artifactDir "cause-effect-capability.wav"
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
  48000,
  [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
  [System.Speech.AudioFormat.AudioChannel]::Mono
)
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice("Microsoft Zira Desktop")
$synth.Rate = -1
$synth.SetOutputToWaveFile($outputPath, $format)
$synth.SpeakSsml(@'
<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">
  <break time="800ms"/>
  Marketing creates traffic.<break time="450ms"/>
  And that traffic creates more signups.<break time="650ms"/>
  That gives the team a useful way to explain what happened.<break time="600ms"/>
  After we changed the website, signups increased, but I don't know if one caused the other.<break time="650ms"/>
  We will keep measuring before we make a stronger claim.<break time="2500ms"/>
</speak>
'@)
$synth.SetOutputToNull()
$synth.Dispose()

Get-Item -LiteralPath $outputPath | Select-Object FullName, Length
