# Generates the spoken audio for the three Standard Mode demo runs.
#
# These WAVs are fed into a real browser session as the microphone input
# (scripts/demo-capture.mjs explains how), so the demo runs exercise the
# genuine path: Deepgram ASR -> /api/beat -> /api/artist -> organizer -> canvas.
# Nothing downstream of the microphone is simulated.
#
#   powershell -File scripts/demo-speech.ps1
#
# Output lands in public/_demo-src/ (gitignored, deleted after capture).

Add-Type -AssemblyName System.Speech

$outDir = Join-Path $PSScriptRoot "..\public\_demo-src"
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

# Pauses matter: the beat only acts on a landed thought, so the gaps between
# lines are what let each idea reach the canvas as its own step.
$demos = @(
  @{
    id    = "demo-a"
    lines = @(
      "Our revenue increased after we launched the new plan, but churn increased too.",
      "Most of that churn came from new customers who cancelled after their first month.",
      "So our next priority is improving onboarding and retention."
    )
  },
  @{
    id    = "demo-b"
    lines = @(
      "Photosynthesis starts when a plant absorbs sunlight.",
      "The plant takes carbon dioxide from the air, and water from the soil.",
      "It uses that energy to create glucose, and releases oxygen."
    )
  },
  @{
    id    = "demo-c"
    lines = @(
      "Before we launch, we need to finish payments first.",
      "Then optimize latency and usage costs.",
      "After that, bring in ten testers, collect their feedback, and prepare the public launch."
    )
  }
)

foreach ($demo in $demos) {
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $synth.SelectVoice("Microsoft Zira Desktop")
  $synth.Rate = -1

  $path = Join-Path $outDir "$($demo.id).wav"
  $synth.SetOutputToWaveFile($path)

  # A beat of room tone before the first word: Deepgram's socket opens slightly
  # before playback starts, and a cold open clips the first syllable.
  $synth.Speak([System.Speech.Synthesis.PromptBuilder]::new())
  $synth.SpeakSsml('<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US"><break time="1200ms"/></speak>')

  foreach ($line in $demo.lines) {
    $escaped = [System.Security.SecurityElement]::Escape($line)
    $synth.SpeakSsml("<speak version=`"1.0`" xmlns=`"http://www.w3.org/2001/10/synthesis`" xml:lang=`"en-US`">$escaped<break time=`"1900ms`"/></speak>")
  }

  # Tail silence so the last thought finalizes and gets drawn before we stop.
  $synth.SpeakSsml('<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US"><break time="4000ms"/></speak>')

  $synth.SetOutputToNull()
  $synth.Dispose()

  $size = (Get-Item $path).Length
  Write-Output "$($demo.id).wav  $([math]::Round($size / 1KB)) KB"
}
