# Synthetic audio (git-ignored)

`scripts/render-tts.ts` (A2) renders six transcript fixtures to 16 kHz mono WAV here with `MODELS.tts`: one voice per speaker, one clip per utterance, seeded 0.3–1.2 s gaps, and with `--noise` a second copy with steady background noise 20 dB below the speech. It needs `GEMINI_API_KEY`:

```bash
pnpm tsx --env-file-if-exists=.env scripts/render-tts.ts --noise
```

Each `<id>.wav` gets a `<id>.json` sidecar with the script text and every clip's rendered `startMs`/`endMs`. The STT runner (A5) streams the WAVs through the gateway at real time and compares captions against the sidecar (word error rate, time to first final caption). Audio processing is plain TypeScript (`packages/interpreter/src/tts/audio.ts`), so no ffmpeg is needed.
