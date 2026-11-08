# Test audio (git-ignored)

**Supplied by the humans**, shared between laptops through Google Drive, never committed.

- **Name** each file after the transcript fixture it reads, e.g. `03-return-revisit.wav`, so the STT runner can score it against that script. Other audio (podcast clips) can have any name; it gets latency checks only.
- **Format:** mono 16 kHz WAV if possible: `ffmpeg -i input.mp3 -ac 1 -ar 16000 output.wav`. Other common formats usually work too.
- **Sources:** your own recordings of the scripts (most realistic), ElevenLabs renders, or podcast clips (never in the repo or the public demo).

`scripts/render-tts.ts` can render the scripts with Gemini TTS, but our key allows about 10 TTS requests a day and it makes one call per line, so **don't run it** (AGENTS.md → API budget).
