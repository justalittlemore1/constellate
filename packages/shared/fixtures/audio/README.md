# Synthetic audio (git-ignored)

`scripts/render-tts.ts` (A2) renders each script in `transcripts/` to a 16 kHz mono WAV here using `MODELS.tts`, one voice per speaker, with 0.3–1.2 s gaps and optional cafe noise at −20 dB. The STT runner (A5) streams these through the gateway at real time and reports word error rate.
