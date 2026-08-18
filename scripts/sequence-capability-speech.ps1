# Deterministic Visual Re-entry Sequence V2 capability fixture.
# Natural sentence pauses create separate V2 settled thoughts; there is no
# pause for model/render completion and the final sentence continues normally.

Add-Type -AssemblyName System.Speech

$artifactDir = Join-Path $PSScriptRoot "..\artifacts\visual-reentry-sequence-v2"
if (-not (Test-Path -LiteralPath $artifactDir)) {
  New-Item -ItemType Directory -Path $artifactDir | Out-Null
}

$outputPath = Join-Path $artifactDir "sequence-capability.wav"
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
  First, we collect the data.<break time="450ms"/>
  Then we clean the data.<break time="450ms"/>
  Finally, we train the model.<break time="450ms"/>
  Once that's finished, I can explain the result to the team.<break time="2500ms"/>
</speak>
'@)
$synth.SetOutputToNull()
$synth.Dispose()

Get-Item -LiteralPath $outputPath | Select-Object FullName, Length
