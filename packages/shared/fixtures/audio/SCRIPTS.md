# Spoken-test scripts (record these)

Six transcript fixtures for the speech tests (AGENTS.md › API budget: humans supply the audio). Two people read one speaker each. Speak naturally, as if chatting with a friend: small pauses between turns are fine; don't read the speaker names aloud. Each takes 1–3½ minutes.

Save each recording as **mono 16 kHz WAV** in `packages/shared/fixtures/audio/` (git-ignored; share via Google Drive), named exactly as below so the STT runner scores it against the right script:

| Fixture | Save as | Speakers | Approx. length |
| --- | --- | --- | --- |
| Simple shift: hockey to music | `01-simple-shift.wav` | Maya (A), Jordan (B) | ~1.1 min |
| Drill-down: religion to Christianity to the resurrection | `02-drill-down.wav` | Noor (A), Ethan (B) | ~3.2 min |
| Return: free will, then a job offer, then back to free will | `03-return.wav` | Lena (A), Marcus (B) | ~2.4 min |
| Deferred then discussed: the apartment | `05-deferred-resolved.wav` | Rosa (A), Kwame (B) | ~1.9 min |
| Ambiguity: Java the language and Java the island | `08-java.wav` | Mei (A), Arjun (B) | ~1.4 min |
| Promise: I'll send you the paper tonight | `09-promise.wav` | Grace (A), Omar (B) | ~1.4 min |

Convert other formats with: `ffmpeg -i input.m4a -ac 1 -ar 16000 01-simple-shift.wav`

## 01-simple-shift.wav: Simple shift: hockey to music

A = Maya, B = Jordan

1. **A:** Did you catch the Canucks game last night? That overtime was unreal.
2. **B:** I watched the third period at the pub. The goalie stole that game, honestly.
3. **A:** Thirty-eight saves. And the power play finally worked, two goals on three chances.
4. **B:** If they keep that up they might actually make the playoffs this year.
5. **A:** Don't jinx it. Every year we say that and every year it falls apart in March.
6. **B:** Fair. Okay, totally different thing, are you still going to the concert Friday?
7. **A:** Yes! I finally got floor tickets. The opener is that indie band from Victoria.
8. **B:** Oh I love them. Their new album is so much moodier than the last one.
9. **A:** Right? I think the producer changed. The synths sound way more like the eighties now.
10. **B:** I might try to get a resale ticket. Text me if anyone in your group drops out.

## 02-drill-down.wav: Drill-down: religion to Christianity to the resurrection

A = Noor, B = Ethan

1. **A:** Can I ask you something kind of personal? Do you actually still believe in God, or is church more of a family thing for you now?
2. **B:** Honestly it's both. I think most people believe because of where they grew up, and I'm not sure I'm different.
3. **A:** That's what gets me though. If you'd been born in Jakarta you'd probably be Muslim, so how can any one religion be the true one?
4. **B:** Sure, but that argument cuts both ways. If you'd been born in Copenhagen you'd probably be an atheist, and you wouldn't say that makes atheism false.
5. **A:** Okay, fair. I guess I just think belief is mostly comfort. People want something to hold onto when things go wrong.
6. **B:** Some of it is comfort, for sure. But a lot of the people I know at church believe because of specific stuff, not just a warm feeling.
7. **A:** Like what, though? What's the specific stuff for you, for Christianity in particular?
8. **B:** For me it's mostly Jesus. Like, the person. The way he treated people nobody else would touch, lepers, tax collectors, women in that culture.
9. **A:** I mean I'll give you that he was an impressive moral teacher. Plenty of atheists say that too.
10. **B:** Right, but C.S. Lewis has that line, that he didn't leave that option open. He claimed to forgive sins, he talked like he was God.
11. **A:** Or the gospel writers put those words in his mouth decades later. Mark was written what, forty years after?
12. **B:** Something like that, yeah. But Paul's letters are earlier, and he's already worshipping Jesus within twenty years.
13. **A:** Okay so what about the resurrection itself. Do you think that literally happened, like a dead body got up?
14. **B:** Yeah, I actually do. And it's the whole thing, Paul says if Christ isn't raised your faith is useless.
15. **A:** But what's the evidence beyond the Bible saying so? That's kind of circular.
16. **B:** The usual argument is the empty tomb plus the appearances. Women found the tomb, and in that culture women weren't credible witnesses, so why make that up?
17. **A:** Huh. I hadn't heard that one. That's actually a decent point about the women.
18. **B:** And then the disciples went from hiding to dying for it. People don't usually die for something they know they invented.
19. **A:** People die for false things all the time though. Heaven's Gate, whatever. Sincerity isn't evidence.
20. **B:** Sure, but they'd be the ones who knew whether they saw him. That's different from believing something secondhand.
21. **A:** Maybe it was grief hallucinations. You lose someone and you see them everywhere for months. My mom saw my grandpa in the kitchen.
22. **B:** That's the best skeptical explanation, I think. But it doesn't really explain five hundred people at once, or the empty tomb.
23. **A:** If the five hundred thing is even real. That's one line in one letter.
24. **B:** Fair. I'm not saying it proves it. I just think it's harder to explain away than people assume.

## 03-return.wav: Return: free will, then a job offer, then back to free will

A = Lena, B = Marcus

1. **A:** I watched this lecture last night that totally broke my brain. The guy argued free will basically doesn't exist.
2. **B:** Sapolsky? He's been everywhere lately. The whole thing about how every choice is just biology plus environment.
3. **A:** Yeah! He says if you trace any decision back far enough, it's neurons, hormones, childhood, genes. There's no point where "you" step in.
4. **B:** I kind of buy it, honestly. Like, I didn't choose to be the kind of person who likes running. I just am.
5. **A:** But then nobody's responsible for anything. That feels wrong. Should we stop punishing people?
6. **B:** He'd say yes to punishment as revenge, no to keeping dangerous people away from others. More like quarantine than blame.
7. **A:** That's bleak. But also kind of compassionate? I can't decide.
8. **B:** Totally. Okay, wait, I have to tell you, I got the offer from the design agency.
9. **A:** No way! The one in Gastown? Congrats! Are you taking it?
10. **B:** I don't know yet. It's more money, like fifteen percent more, but I'd be leaving my team right before our big launch.
11. **A:** How do you feel about your manager though? You've been complaining about her for months.
12. **B:** That's the thing. She's the main reason to leave. The new place said I'd get a senior title too.
13. **A:** Then it sounds like you already know. Do they want an answer soon?
14. **B:** By Friday. I'm going to negotiate for one more week of vacation first.
15. **A:** Smart. Ask for the vacation in writing.
16. **A:** Okay but going back to the free will thing, I keep thinking about it. If it's all determined, was your job decision ever really yours?
17. **B:** Ha, that's exactly what I was thinking. Like, I'm going to "decide" by Friday, but my brain probably already knows.
18. **A:** Right, and if it's predetermined, then all my agonising over stuff is just theatre.
19. **B:** Unless the agonising is part of the cause. The deliberating still matters, it's just not magic.
20. **A:** Huh, that's compatibilism, right? Free will is just acting on your own reasons without being forced.
21. **B:** Yeah, Dennett's take. I think that's where I land. It's free enough to be worth wanting.

## 05-deferred-resolved.wav: Deferred then discussed: the apartment

A = Rosa, B = Kwame

1. **A:** How did your presentation go? You were so nervous this morning.
2. **B:** It went fine, actually. The demo crashed once but I just made a joke and restarted it.
3. **A:** That's the best way to handle it. Did your boss say anything?
4. **B:** She said the slides were too dense. Which, fair, I had like forty bullet points.
5. **A:** Classic you. Next time do three slides and just talk.
6. **B:** Yeah. Oh, we should talk about the apartment later, the landlord emailed about renewing.
7. **A:** Oh no, okay. Is it bad?
8. **B:** Kind of, but let's do it properly after dinner. Did you finish the season finale?
9. **A:** Yes! I can't believe they killed off the sister. I actually yelled at the TV.
10. **B:** Right? I thought she was the main character for next season.
11. **A:** Apparently the actress wanted to leave to do movies. So they just wrote her out.
12. **B:** That explains why the last three episodes felt rushed.
13. **A:** Totally. The flashback episode was the best one though.
14. **B:** Agreed. Okay, so, the apartment. The landlord wants to raise the rent by eight percent if we sign another year.
15. **A:** Eight percent? That's like a hundred and sixty dollars more each month.
16. **B:** Yeah. Or we can go month to month, but then it's twelve percent.
17. **A:** That's ridiculous. Isn't there a legal cap on increases in BC?
18. **B:** There is, I think it's three point five this year. So eight is probably not even allowed.
19. **A:** Then we push back. Can you forward me the email? I want to check the exact numbers.
20. **B:** Already forwarded, it should be in your inbox.

## 08-java.wav: Ambiguity: Java the language and Java the island

A = Mei, B = Arjun

1. **A:** I have to learn Java for my data structures course and I hate it so much.
2. **B:** Oh no. Why Java? I thought everyone teaches Python now.
3. **A:** The prof says Java makes you think about types. Which, sure, but I spend half my time writing boilerplate.
4. **B:** Public static void main string args. I still have it memorised from high school.
5. **A:** Exactly! And the error messages are like a novel. A null pointer exception and forty lines of stack trace.
6. **B:** Do you have IntelliJ at least? It writes half the boilerplate for you.
7. **A:** Yeah, the student licence is free. It helps. I just miss how short Python is.
8. **B:** Ha, speaking of Java, my cousin just got back from Java, the island. She was in Indonesia for three weeks.
9. **A:** Oh nice! Where did she go?
10. **B:** Yogyakarta mostly. She did the sunrise at Borobudur, the huge Buddhist temple.
11. **A:** I've seen photos of that! With the mist and the volcano behind it?
12. **B:** Yes, that's Merapi. And then she hiked Mount Bromo at like three in the morning to see the crater.
13. **A:** That sounds incredible. Was it expensive?
14. **B:** Super cheap apparently, except the flights. She said the street food was the best part, the gudeg especially.
15. **A:** Okay, I'm adding Indonesia to my list. After I survive this course.

## 09-promise.wav: Promise: I'll send you the paper tonight

A = Grace, B = Omar

1. **A:** I've been sleeping like five hours a night during exams and honestly my memory is garbage.
2. **B:** That tracks. I read somewhere that sleep is when your brain actually saves stuff.
3. **A:** Yeah, there's this study I read for my psych class. People learned a list of words, and the ones who slept after remembered way more.
4. **B:** Even if they slept the same total amount overall?
5. **A:** That's the interesting part. It was the sleep right after learning that mattered most. Something about replaying the memories in deep sleep.
6. **B:** So all-nighters before an exam are basically pointless.
7. **A:** Worse than pointless. You learn it and then never consolidate it.
8. **B:** I really should read more of this stuff instead of just doom-scrolling.
9. **A:** I'll send you the paper tonight, it's actually pretty readable.
10. **B:** Thanks, that'd be great. Does it say anything about naps?
11. **A:** A little. A twenty-minute nap helped a bit, but a ninety-minute one with deep sleep helped a lot more.
12. **B:** Ninety minutes is not a nap, that's a lifestyle.
13. **A:** Ha, right. I'm trying to just get seven hours this week and see if it helps.
14. **B:** Let me know if it does. I could use an excuse to go to bed earlier.
