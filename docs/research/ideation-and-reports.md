# Original ideation and research reports

> Raw input from the team (ideation transcript) and two exploratory LLM reports. These are **suggestions, not decisions** — `docs/PLAN.md` supersedes anything here (several model names and libraries below were not chosen).

Develop a plan for an app that produces a node-based map of a natural free-flowing conversation. The app should listen in and record a conversation between a group of people and in real time generate a map that follows the flow of topics throughout the conversation. So visually, it should appear like as the conversation flows and grows and a topic moves on to a different topic, it should be generating visual nodes of each of those topics that are covered, connecting them, and alongside with them, it should be able to briefly describe the topics that were covered there. The app should also, as it's connecting nodes, detect when a previous topic is revisited and connect back to previous nodes and create branches if new topics are visited from previous nodes. It should also identify where topics are forgotten about or missed. For example, if a person in the conversation mentions they want to talk about soccer, however they never talk about soccer after that in the conversation, it should develop a disconnected node, which indicates a topic not touched. There should also be other features. For example, if a user wants to flag a portion of a conversation, they might be able to double-tap on their volume button. So this is a phone app, and a flag might appear. After the recording, the user should also be able to maybe highlight branches on the tree that they think are most interesting. And so that connects to a wider picture, where once you have multiple conversations, each with nodes of the many, many different topics that were covered, we might get a feature where you can generate a large brain, almost, where, say you have, like, say a common theme among many conversations, a topic that was brought up a lot was existentialism. Then you almost have, like, a brain map, where there's a single node called existentialism, and if you tap into it, you'll be able to see everything, every conversation where this topic was mentioned. And this topic of existentialism in the wider brain map might be able to relate to other key topics. So maybe philosophy or personal philosophy, and it'll connect to those, but maybe be more far away than things like career aspirations or gymming, for example, or nutrition and health. A big question is, when interpreting a conversation, how, what is a feasible way to, and how is it possible to have, like, an LLM actively interpret a conversation and... Decide on, like, the granularity of the conversation. Like, say, I had a conversation with a friend about religion. Well, the entire conversation is going to be about religion, but we might talk about, like, Jesus, or maybe the resurrection, for example, or some, like, specific stories. And it's all under the topic of Christianity, but we would want it to branch out further and be more fine-grained. So we would want to... So a big question is how would we figure that out? Along with acting as a conversation mapping and recording tool, we also want this app to almost act as a conversation diary, allowing the user to add information after conversations about who they were speaking with and when they were speaking, so the user has the ability to then look back on conversations and see, like, what they were talking about at the time, and maybe possibly even if they want to record themselves talking to have a solo conversation map about that as well. And a key differentiator from this app, and, like, a core objective that separates this app from, for example, if you just had, like, a meeting transcriber, is that this should really capture the organic and natural flow of conversations, where I guess, like, the structure of the conversation and how it developed matters a lot. Whereas in, like, a meeting, for example, all you care about is that single transcribed summary of, like, key bullet points and, like, action items, which this is very different from. And having this visual way of remembering and revisiting how a conversation developed is also very advantageous from a generic transcript or just a single audio file, where you might, to figure out how the conversation, you might have to listen through the entire thing again or read through the entire thing again to figure out where you went. Whereas here, it's almost organized how it happened, which is very relatable. Also, for key implementation details, we want this to be a mobile app. So we want to figure out, for the purpose of a hackathon setting, how we would be able to simulate a mobile app in this way, and to properly create an app structure where the data can be held, for example, and is not just a dummy website that might have the appearance of working. Also for the implementation, the app should include a user login and authentication and a database storage where conversations can be stored. Not locally. For example, cloud storage of conversations, so users can access them by logging in, not having to be on their specific device. And also, given the whole structure that we've now described of this application, we also want to think about applications that it might have to mental conditions, like ADHD, for example, and what useful features might be easy to add or might synergize well with this, that could improve the accessibility or offer useful service to people with those conditions. For example, that remembering and just the psychology of how to remember things that those people might struggle with and how this app might help. So it would be useful to do, potentially, literature review on key subjects like that and see if any synergistic strategies or complementary features could be added. The user interface of this app should be Pretty minimalistic, giving a, like, clean, very focused look to the, the design. So the maps of the...

The UI of this app should be pretty minimalistic and focused, highlighting the maps in particular. So the map should be the primary focus of this app. The nodes and connections between the nodes should be clearly visible, and also the direction of the connections should also be very nicely denoted. So forward-facing connections, but also backwards connections that go to previous topics should be clearly denoted in the UI of the app. The UI should be very clean and focused on the map. So we're envisioning, like, a dark, like galaxy background with stars, almost like an abstract metaphor for the connections between the conversations on the start screen. Also on the start screen there should be what says, Welcome, and then a microphone to begin recording conversations. As conversations are saved and stored, they should be visible on a sidebar where they can be grouped into folders or favorited. Also there should be a Generate Brain button, which generates the brain of topics with connections to different, all the different conversations that were mentioned previously. Also with the map and the nodes. In conversations and in the big brain, we'd like the focus to be mainly visual, with the nodes containing only a few words of text describing the main topics, so that it's not overwhelming or overly cluttered. And then, if nodes are hovered over, they can provide a little bit more of, like, a shorter description, or if the user clicks a node, it can expand and provide a more detailed description, or even play the audio segment of that conversation. Also the user, as conversations become long, should be able to zoom in and out of the map to focus on different parts. And a final feature is that, as was mentioned previously, perhaps if a user wants to remember portions of a conversation, or, like, really wants to save that as, like, a favorite part of a conversation, they can use a highlighter almost to highlight certain nodes, and that will appear in a saved or favorites tab. And it is also possible that they can, on the tree that is generated from every conversation, make their own annotations if they would like, to make it even more immersive. Maybe they're going through the conversation again, had a new thought that they just wanted to write down, and just maybe add, like, an interactive canvas text onto it. Finally, list any useful libraries, APIs, or models that you would use to create this app, and that would be feasible to implement in a 12-hour hackathon, if possible. So that no training is really needed and mostly orchestration of models to implement the features we desire.

 

Building a real-time conversational graph application—let's call it **Constellate**—in a 12-hour hackathon requires framing the core problem around **real-time state-machine orchestration** rather than model training. Unlike corporate meeting transcribers that collapse dialogue into flat bullet points and action items, Constellate preserves the **spatial and temporal topology** of organic human conversation: how tangents sprout, how speakers loop back to earlier themes, and where promised topics are accidentally abandoned.

## **1\. System Architecture & Real-Time Data Pipeline**

To achieve a live, growing node map without overwhelming the LLM or incurring high latency, the pipeline separates continuous audio capture from semantic graph mutation using a **sliding-window utterance buffer**.

1. **Client Audio Capture & Streaming:** The mobile client captures microphone audio via MediaRecorder in 250 ms chunks, simultaneously streaming raw audio bytes over a WebSocket to a real-time Speech-to-Text (STT) engine while recording a continuous .webm/.m4a file locally for cloud upload and timestamped playback.  
2.   
3. **Real-Time Diarized Transcription:** **Deepgram Streaming API (Nova-3 / Nova-2)** processes the stream with diarize=true and utterances=true, returning speaker-tagged transcript segments (Speaker 0, Speaker 1) with sub-300 ms latency and exact start\_time and end\_time offsets.  
4.   
5. **Utterance Buffer & Discourse Trigger:** Instead of calling the LLM on every word, a backend orchestrator buffers transcript segments until either **20 to 30 seconds of speech** accumulate, a **1.5-second conversational pause** occurs, or a speaker uses a strong discourse shift marker (*"Anyway," "Going back to," "Wait, remind me..."*).  
6.   
7. **Graph State Engine (LLM \+ Vector Router):** Each buffered chunk is evaluated against the current conversation graph state to emit deterministic JSON graph mutations (ADD\_NODE, UPDATE\_NODE, ADD\_REVISIT\_EDGE, SPAWN\_GHOST\_NODE, RESOLVE\_GHOST\_NODE) pushed immediately to the mobile UI via Supabase Realtime or WebSockets.  
8. 

## **2\. Solving the LLM Topic Granularity & Topology Problem**

The hardest conceptual challenge is **adaptive granularity**: if two friends spend 45 minutes discussing religion, a naive prompt will either lump the entire session into a single *"Religion"* node or spawn 80 hyper-fragmented micro-nodes. You solve this without fine-tuning by giving the LLM a **Dynamic Relative Baseline** and a **Hybrid Embedding \+ Structured-Output State Machine**.

### **Dynamic Relative Baseline (Zooming the Ontology)**

Maintain a lightweight session state object passed into every LLM call containing three tiers of context:

* **Macro Anchor (Session Root):** Automatically inferred after the first 2 minutes of conversation (e.g., *"Religion & Christian Theology"*).  
*   
* **Meso Trail (Last 5 Nodes):** The recent trajectory of sub-topics (e.g., *"Historical Jesus" → "Gospel Accounts" → "The Resurrection"*).  
*   
* **Active Node Window:** The currently open node's summary and start timestamp.  
* 

By instructing the LLM that **any new node must be at least one taxonomic level more specific than the Macro Anchor**, the model automatically recalibrates its zoom level. If the conversation stays within Christianity, *"Christianity"* becomes the background canvas, and the LLM shifts its segmentation boundary to meso- and micro-shifts (*"Pauline Epistles" → "Literal vs. Metaphorical Resurrection" → "Personal Doubts"*).

### **Detecting Forward Shifts, Backward Loops, and Ghost Nodes**

For every 25-second transcript window, run a two-step classification pipeline:

1. **Fast Vector Similarity Check (**text-embedding-3-small**):** Compute the embedding of the current transcript window and calculate cosine similarity against all existing nodes in the current conversation.  
2. 

   * **High similarity to the currently active node (greater than 0.82):** Append the transcript timestamp range and refine the node's hover summary (CONTINUE).  
   *   
   * **High similarity to an older, non-adjacent node (greater than 0.78):** Flag that older node ID as a candidate revisit target for the LLM (CANDIDATE\_LOOP).  
   *   
3. **Structured LLM Graph Mutation Call (**gpt-4o-mini **or** gemini-2.5-flash**):** Pass the current window, the active node, any candidate loop nodes, and the list of unresolved **Ghost Nodes** into a strict JSON Schema prompt that outputs:  
4. 

JSON

```

{
  "action": "NEW_SUBTOPIC_BRANCH | NEW_TOPIC_SHIFT | REVISIT_EXISTING | CONTINUE_ACTIVE",
  "target_node_id": "node_14",
  "new_node": {
    "short_label": "Resurrection Historicity",
    "hover_summary": "Debating historical evidence vs. faith-based interpretations of the empty tomb.",
    "detailed_notes": "Speaker 0 brought up textual criticism of Mark's ending; Speaker 1 connected it to personal faith.",
    "start_sec": 412.5,
    "end_sec": 448.0
  },
  "backward_links": ["node_03"],
  "spawned_ghost_topics": [
    {
      "short_label": "Intramural Soccer",
      "reason": "Speaker 1 said 'Remind me to tell you about soccer later' at 07:15 but kept discussing theology.",
      "mentioned_at_sec": 435.2
    }
  ],
  "resolved_ghost_ids": []
}

```

### **Handling "Missed / Forgotten" Topics (Ghost Nodes)**

* **Spawning:** When the LLM detects prospective conversational intentions (*"We should talk about X," "Hold that thought about soccer," "I have a story about Y after this"*) that are not immediately elaborated within the current or next window, it spawns a **Ghost Node** tethered by a dotted line to the node where the intention was voiced.  
*   
* **Auto-Promotion:** Every time a new active topic node is created later in the conversation, its embedding and label are compared against the active spawned\_ghost\_topics queue. If the speakers finally bring up soccer 20 minutes later, the Ghost Node transitions into a solid Active Node, preserving a backward link to the moment it was first promised.  
* 

## **3\. The "Galactic Brain" Macro-Map Architecture**

When the user taps **"Generate Brain"**, the app transitions from a single chronological conversation tree to a cross-conversation semantic knowledge graph stored in **Supabase (**pgvector**)**.

* **Cross-Conversation Node Merging (Hub Creation):** Every topic node saved across all conversations has a 1536-dimensional embedding in Postgres. A backend SQL/RPC function runs **agglomerative clustering (or cosine similarity thresholding greater than 0.84)** across all nodes belonging to the user. Nodes that cluster together (e.g., *"Camus & Absurdism"* from Tuesday's chat, *"Meaning of Life"* from Friday's solo voice journal, and *"Sartre's Existentialism"* from Sunday's coffee chat) merge under a unified **Macro Hub Node** labeled **Existentialism**.  
*   
* **Semantic Distance & Gravity Layout:** In the Galactic Brain view, edge weights between Hub Nodes are computed via a weighted formula combining **embedding cosine similarity (70%)** and **same-conversation co-occurrence frequency (30%)**. Using a d3-force physics layout, *Existentialism* naturally pulls close to *Philosophy*, *Religion*, and *Personal Ethics*, while drifting far away from *Gym & Fitness*, *Nutrition*, or *Career Planning*.  
*   
* **Tap-to-Drill-Down Drawer:** Tapping the *Existentialism* hub node opens a sleek glassmorphic bottom sheet listing every conversation where that theme surfaced, who participated, the date, and one-tap audio playback buttons for the exact timestamp slices across those different days.  
* 

## **4\. Mobile Delivery Strategy & Hardware Volume-Button Flagging**

In a 12-hour hackathon, building a pure native iOS/Android app from scratch in Swift/Kotlin slows down UI iteration, while a plain desktop website fails the mobile experience requirement.

### **Mobile Simulation & Packaging Strategy**

Build a **Mobile-First React \+ TypeScript application wrapped in Capacitor (or as an installable fullscreen PWA)** hosted on Vercel with a Supabase cloud backend:

* **Cloud Persistence & Auth:** Use **Supabase Auth** (Google OAuth \+ Magic Link) so any judge or user can log in on their own phone and immediately access their cloud-synced conversations, audio buckets, and Galactic Brain.  
*   
* **Native Mobile Feel:** Configure viewport-fit=cover, disable browser pinch-zoom outside the canvas, lock orientation to portrait, and use Capacitor (@capacitor/core) so you can run it both inside a native iOS/Android simulator on stage *and* let judges scan a QR code to open it as a full-screen standalone mobile web app.  
* 

### **Implementing the Double-Tap Volume Button Flag**

Capturing hardware volume buttons while a phone is in a user's pocket or resting face-down on a table has OS-level security nuances on mobile. Implement a **dual-layer hook** so it works reliably in any hackathon demo environment:

1. **Native Capacitor Wrapper Path:** Use @capacitor-community/volume-buttons (or a 15-line custom listener on Android KeyEvent.KEYCODE\_VOLUME\_UP / VOLUME\_DOWN). Track timestamps of consecutive presses; if two presses occur within 400 ms (t\_2 \- t\_1 less than 400 ms), fire createConversationFlag(currentAudioTimestamp) and trigger a brief haptic pulse (navigator.vibrate(100) or @capacitor/haptics).  
2.   
3. **Pure Mobile Browser (PWA) Fallback Path:** Because iOS Safari restricts raw keydown events for physical volume rockers in standard web pages, include two zero-permission web fallbacks:  
4. 

   * **MediaSession Hardware Hijack:** Play an inaudible looping silent audio buffer during recording and register navigator.mediaSession.setActionHandler('nexttrack', flagMoment). Double-tapping AirPods/headset buttons or lock-screen media buttons immediately drops a flag on the active node.  
   *   
   * **"Pocket Mode" Dimmed Overlay \+ Shake-to-Flag:** A toggle that dims the OLED screen to 5% brightness where **double-tapping anywhere on the black screen** or **double-tapping the back/side of the phone** (detected via a spike in window.addEventListener('devicemotion', ...) accelerometer magnitude) drops a timestamped flag with haptic feedback.  
   * 

## **5\. Cognitive Psychology Literature Review & ADHD Synergies**

Research on neurodivergent communication and executive function highlights three core cognitive bottlenecks in ADHD that directly validate Constellate's node-based design:

* **Working Memory Overload & Retroactive Interference:** Under Baddeley's working memory framework and cognitive load literature in ADHD, maintaining an unvoiced thought while processing rapid incoming speech quickly saturates the phonological loop and central executive workspace. When a conversation branches onto an exciting tangent, *retroactive interference* wipes out the earlier mental thread before it is consolidated—causing the classic *"Wait, how did we even get here?"* or *"I totally lost what I was about to say"* phenomenon.  
*   
* **Event-Based & Intention Prospective Memory Deficits:** Empirical studies on ADHD and prospective memory (e.g., Altgassen, Kretschmer, & Kliegel, 2019\) demonstrate that individuals with ADHD struggle significantly with holding a delayed intention in mind while monitoring ongoing social cues. Forming an intention mid-chat (*"I need to ask him about soccer once he finishes this story"* or *"I'll send you that paper tonight"*) frequently fails during the retention interval because attention is captured by immediate conversational stimuli.  
*   
* **External Cognitive Offloading & Visuospatial Anchoring:** Clinical interventions for ADHD emphasize externalizing working memory into visual, spatial cues rather than linear text. While a raw 40-minute audio file or wall-of-text transcript induces executive paralysis, a spatial 2D graph recruits intact **visuospatial episodic memory**, allowing users to recall *where* on the map an idea happened.  
* 

### **High-Impact ADHD Features to Add (Low Hackathon Effort)**

* **Ghost Nodes as an External Prospective Memory Prosthetic:** Your "Missed/Forgotten Topic" feature directly solves conversational prospective memory failure. Add a subtle **End-of-Chat Pulse Banner** that lists floating Ghost Nodes while the group is still sitting together (*"Unvisited threads from today: Intramural Soccer, Summer Trip"*), allowing speakers to close open loops before parting ways.  
*   
* **"How Did We Get Here?" Breadcrumb Path Tracer:** When a user taps any node during a live or recorded conversation, illuminate the shortest ancestral path from the Root Node to that node in bright cyan while dimming unrelated branches. This gives an instant 3-second visual recap of the tangent chain (*Coursework → Sleep Schedule → Melatonin → Lucid Dreaming*).  
*   
* **1-Tap "Thought Parking Lot" Button:** During live recording, people with ADHD often either blurt out an interruption (impulsivity) or forget their thought while waiting to speak (working memory decay). A small floating **"Park Thought"** input lets the user type 2 words (e.g., *"Ask about internship"*) that immediately spawns a personal manual Ghost Node on the canvas until they speak it aloud.  
*   
* **"Promise & Action Catcher" Pill:** Extend the LLM JSON schema with a single array commitments\_made: \["Send Eddie the Linear Algebra notes"\]. Surfacing verbal promises at the bottom of the Conversation Diary card prevents the social guilt of forgotten follow-throughs.  
*   
* **Dopamine Highlight-Reel Audio Player:** Instead of re-listening to a 45-minute recording, a **"Play Highlights Only"** button sequentially stitches and plays only the 20-second audio slices attached to Flagged or Highlighted nodes.  
* 

## **6\. Minimalist "Galactic" UI/UX & Interaction Design**

* **Visual Metaphor & Palette:** Deep obsidian background (\#060814) with a lightweight HTML5 Canvas starfield (tsparticles at 15% opacity). Individual conversations look like **Constellations**; the macro Brain looks like a **Galaxy**.  
*   
* **Start Screen:** Clean centered *"Welcome"* typography above a pulsing nebula **Microphone Orb**. A collapsible left glassmorphic **Sidebar** houses saved Conversation Constellations (organized into **Folders**, **Favorites**, and **Solo vs. Group** tags) alongside a prominent gradient **"Generate Brain"** button at the top of the navigation bar.  
*   
* **Node & Edge Visual Language:**  
* 

  * **Topic Nodes:** Glowing circular nodes displaying strictly **1 to 4 words** (e.g., *Resurrection Historicity*). Node radius scales subtly with time spent on the topic.  
  *   
  * **Forward Edges (Chronological Flow):** Solid glowing indigo/cyan splines with animated directional light particles flowing from parent to child ($A\rightarrow B$).  
  *   
  * **Backward Edges (Topic Revisits):** Curved, dashed magenta/amber arcs arching back to earlier nodes with a clear arrowhead, visually distinguishing a conversational loop from a forward branch.  
  *   
  * **Ghost Nodes (Missed Topics):** Translucent, hollow dashed-ring satellites gently orbiting the node where they were mentioned.  
  *   
* **Progressive Disclosure & Canvas Tools:**  
* 

  * **Hover / Long-Press:** Floating tooltip showing a 1-sentence summary and speaker breakdown.  
  *   
  * **Single Tap (Expand Inspector):** Opens a compact floating card with the detailed summary, a **Play Audio Segment** scrubber locked to that node's \[start\_sec, end\_sec\], **Conversation Diary Metadata** (Who you spoke with, Location, Date), and an **Add Canvas Note** button.  
  *   
  * **Floating Bottom Toolbar:** Includes **Zoom-to-Fit**, a **Neon Highlighter Toggle** (drag or tap across nodes/branches to paint them gold and auto-sync them to the *Favorites* tab), and the **Add Sticky Annotation** tool to drop freeform text notes directly onto the infinite canvas.  
  * 

## **7\. Recommended 12-Hour Hackathon Tech Stack**

This stack requires **zero custom model training** and relies entirely on drop-in APIs and pre-built graph engines.

| Layer | Tool / API | Why It Wins in a 12-Hour Hackathon |
| :---- | :---- | :---- |
| **Frontend & Mobile** | React \+ Vite \+ Tailwind \+ Capacitor | Instant UI iteration; Capacitor \+ PWA manifest gives native mobile install & hardware hooks |
| **Node Graph Canvas** | React Flow (@xyflow/react) \+ Dagre | Custom React components inside nodes (audio players, sticky notes, glow states) \+ pinch-to-zoom |
| **Galactic Brain Graph** | react-force-graph-2d (or D3-Force) | Physics-based spring clustering for the macro cross-conversation brain map |
| **Live STT \+ Diarization** | Deepgram Nova-3 Streaming WebSocket | Sub-300 ms streaming transcription with built-in multi-speaker diarization and word timestamps |
| **LLM & Embeddings** | gpt-4o-mini / gemini-2.5-flash \+ text-embedding-3-small | Sub-second structured JSON outputs for live node mutations; pennies per hour of audio |
| **Auth, DB & Cloud Audio** | Supabase (Auth \+ Postgres \+ pgvector \+ Storage) | Drop-in login, vector similarity queries in SQL, real-time subscriptions, and cloud audio hosting |

### **Database Schema (Supabase PostgreSQL \+** pgvector**)**

You only need four tables to support every feature in your prompt:

1. conversations: id, user\_id, title, participants (text array), is\_solo (boolean), folder, is\_favorite, audio\_url, created\_at.  
2.   
3. topic\_nodes: id, conversation\_id, short\_label, hover\_summary, detailed\_notes, node\_type (active \| ghost), is\_highlighted (boolean), is\_flagged (boolean), start\_sec, end\_sec, embedding (vector(1536)), pos\_x, pos\_y.  
4.   
5. topic\_edges: id, conversation\_id, source\_node\_id, target\_node\_id, edge\_type (forward \| revisit\_loop \| ghost\_tether).  
6.   
7. canvas\_annotations: id, conversation\_id, node\_id (nullable), user\_note\_text, pos\_x, pos\_y.  
8. 

## **8\. 12-Hour Hackathon Execution Roadmap**

* **Hours 0–2 (Foundation & Cloud Plumbing):** Initialize Vite \+ React \+ Tailwind \+ Supabase project. Enable Supabase Google Auth and create the 4 Postgres tables with pgvector enabled. Build the dark Galaxy landing view with the Sidebar and Microphone CTA.  
    
* **Hours 2–5 (Live Audio \+ Deepgram \+ LLM Graph Engine):** Connect browser MediaRecorder to Deepgram's WebSocket API (diarize=true). Build the 25-second sliding-window buffer that sends transcript chunks to gpt-4o-mini (Structured Outputs) and inserts returned nodes/edges into Supabase.  
    
* **Hours 5–8 (React Flow Constellation Canvas & Audio Slicing):** Render live nodes and directional/looping edges in @xyflow/react using dagre auto-layout so new nodes animate smoothly into position. Wire node tap events to play audioElement.currentTime \= node.start\_sec. Implement Ghost Node styling.  
    
* **Hours 8–10 (Hardware Flagging, Highlighter, Annotations & Diary Meta):** Add the Volume-Button / Double-Tap Pocket Flag listener, the Highlighter branch-selection mode, freeform canvas sticky notes, and the Post-Conversation Diary modal (tagging participants \+ ADHD "Promises & Ghost Topics" summary).  
    
* **Hours 10–12 (Galactic Brain View & Demo Polish):** Build the **"Generate Brain"** view using pgvector cosine similarity to cluster nodes across 4–5 pre-seeded rich conversations (e.g., *Existentialism*, *Religion*, *Fitness*, *Neuroscience*) so the macro brain looks densely populated for the judges, then rehearse a live 2-minute conversation on stage.

# **Conversation Atlas — A Living Map of Your Conversations**

Product concept, AI architecture, interface design, research, and 12-hour hackathon implementation plan

## **1\. Product vision**

Conversation Atlas is an AI-powered mobile application that transforms natural, free-flowing conversations into interactive visual maps of ideas.

Instead of reducing a conversation to a transcript or summary, it captures something much more interesting: the path that a conversation took, how ideas emerged, where they branched, what people returned to, and which thoughts were left unexplored.

Over time, individual conversation maps combine into a larger personal knowledge network, or "Brain," showing the ideas that recur throughout someone's conversations and their connections to other parts of their life.

The app has three core purposes:

1. Conversation mapping: Visualize how a conversation evolves, with topic transitions, branches, revisits, and forgotten threads.  
2. Conversation memory: Preserve conversations as an interactive diary, with timestamps, participants, audio, highlights, and annotations.  
3. Personal knowledge mapping: Connect ideas across different conversations to construct a growing map of someone's intellectual interests, experiences, and relationships.

A key product principle is that the structure of a conversation is itself valuable information.

A traditional meeting assistant asks, "What was discussed?"

Conversation Atlas asks, "How did we get from one idea to another, what did we explore, and where could we go next?"

## **2\. The two fundamental graph systems**

The most important architectural decision is to represent conversations using two complementary graphs rather than forcing everything into one.

Graph A — Conversation Flow

A temporal, directed graph that preserves the sequence and structure of an individual conversation. Every node represents a specific discussion segment, and every connection records how the conversation moved.

Graph B — Personal Brain

A semantic knowledge graph that connects recurring concepts across multiple conversations. Instead of following chronological order, nodes are organized by conceptual meaning and relationships.

This distinction solves several difficult problems, particularly how to represent a topic that is revisited versus a topic that appears in several unrelated conversations.

### **Example: a conversation flowing between topics**

Forward

Revisit

Unexplored

Flagged

Illustrative graph: a conversation moves into increasingly specific ideas, branches into philosophy, returns to an earlier topic, and leaves soccer as an unexplored thought.

One crucial detail: when someone revisits religion, the system should create a new temporal occurrence and connect it to the previous religion node with a special revisit edge.

It should not simply draw an arrow backwards that changes the chronology of the existing graph.

That way, the app preserves both the order of discussion and the connection between occurrences of the same subject.

### **What differentiates the two graph models?**

| Property | Conversation Flow | Personal Brain |
| ----- | ----- | ----- |
| Primary purpose | Preserve how discussion unfolded | Connect knowledge across time |
| Node meaning | A discussion occurrence | A distinct concept |
| Ordering | Chronological | Semantic |
| Repeated topic | New occurrence linked to earlier one | Same concept with multiple references |
| Connections | Transitions, branches, revisits | Similarity, hierarchy, semantic relationships |
| Audio | Segment-level playback | Links to original conversations |
| Layout | Mostly directional | Organic, spatial network |

The Brain should never replace the original conversation graph. Both are important representations of the same underlying information.

## **3\. The hardest AI problem: deciding when an idea deserves a node**

The difficult part is not speech recognition. It is deciding what counts as a topic, how detailed that topic should be, and when the conversation has genuinely moved somewhere new.

A single conversation might contain topics at several levels of abstraction.

Religion

Christianity

Resurrection

Historical evidence, faith, interpretation

Teachings of Jesus

Morality, parables, forgiveness

All of these could be valid nodes. But if the conversation is only two minutes long, displaying every level might be unnecessary. If it lasts 45 minutes, displaying only "Religion" would lose almost all the useful detail.

### **My recommended solution: hierarchical, adaptive topic segmentation**

Rather than choosing a fixed number of nodes or a fixed transcript length per node, use an LLM as an incremental conversation interpreter.

Each detected discussion should have three possible levels:

| Level | Example | Intended purpose |
| ----- | ----- | ----- |
| Broad theme | Religion | Orient the user |
| Subtopic | Christianity | Group related discussion |
| Specific idea | Resurrection | Capture what was actually explored |

The interface should automatically choose how much of this hierarchy to display, based on zoom level and conversational detail.

At a distant zoom, the user might see five large topics. At a closer zoom, those topics expand into dozens of discussion nodes.

This is effectively semantic zoom, where zooming changes the level of information, rather than merely making everything larger.

### **The AI decision process**

For each new chunk of conversation, the interpreter determines whether to:

* Continue the current topic.  
* Create a more specific child topic.  
* Move to a new sibling or unrelated topic.  
* Revisit a previously discussed topic.  
* Register an intended but unexplored topic.  
* Update an existing node's summary or confidence.

The crucial insight is that topic similarity alone cannot make this decision.

For example:

> "Jesus was resurrected after three days."

> "Do you think resurrection is historically credible?"

These two statements are semantically related and may belong to the same discussion node.

But:

> "Speaking of resurrection, that reminds me of how different religions understand reincarnation."

This may justify a new node, because the conversation has moved into a distinct conceptual question.

And:

> "Anyway, back to that question about whether Jesus existed."

This is a return to an earlier topic, not a continuation of the immediately preceding one.

A combination of semantic embeddings, conversation context, and LLM-based transition classification is much more suitable than keyword detection alone.

### **A practical algorithm**

1. Receive finalized utterances  
   Capture transcribed speech in timestamped chunks, preserving speaker IDs where possible.  
2. Assemble a moving context window  
   Supply the last few conversational turns, a condensed earlier context, the active topic, and a compact registry of existing topics.  
3. Ask an LLM to classify the conversational change  
   The model identifies the active concept, its specificity, whether a transition occurred, and any stated intentions to discuss something later.  
4. Compare with existing topics  
   Use embeddings to retrieve similar previously discussed topics. The model decides whether these are truly the same subject or simply related.  
5. Generate a graph operation  
   Update the active node, add a child or sibling, link a revisit, or create a pending-topic marker.  
6. Persist and render  
   Validate the operation against the graph's state, write it to the database, and send the update to the device.

### **How often should the LLM run?**

Do not call the LLM for every word or every speech-recognition update.

For the hackathon, use an initial interpretation window of approximately 15–25 seconds, or sooner when there is an explicit topic transition. The exact cadence should be adjustable.

The LLM receives:

* The most recently finalized utterances.  
* A condensed memory of the conversation so far.  
* The current topic and its parent themes.  
* Existing node IDs, labels, and short descriptions.  
* Candidate similar nodes retrieved through embedding search.  
* Unresolved topics mentioned earlier.

This keeps the model context manageable without requiring the complete conversation to be repeatedly analyzed.

### **Preventing excessive node creation**

An overly sensitive system could create a new node for nearly every sentence. The resulting graph would be unusable.

Introduce a few rules:

1. A new node should represent a meaningful conceptual shift, not simply a new sentence.  
2. Normally, a topic should persist for several utterances or roughly 15 seconds before it becomes a permanent node.  
3. Strong explicit transitions, such as "Let's switch to politics," can create nodes immediately.  
4. Brief side comments can remain attached to the current node.  
5. Closely related small nodes can be consolidated after recording.

These are initial heuristics, not universal thresholds.

The LLM should make the semantic decision, while the application enforces consistency rules.

### **User-controlled granularity**

Map detail

Illustrative preview

BroadBalancedDetailed

Christianity

Resurrection

Historical evidence

Existentialism

Career aspirations

These are examples of node labels at different levels of granularity, rather than different independent transcripts.

For the initial implementation, I would generate a consistent detailed graph and let users collapse or expand existing topic hierarchies.

Generating entirely new topic segmentations for every zoom level is a future refinement.

## **4\. The LLM should produce graph operations, not prose summaries**

A particularly important implementation decision is to avoid having the AI regenerate an entire graph after every update.

Instead, ask it to return a small set of structured operations.

For example:

```
{
  "operation": "create_topic",
  "label": "Historical resurrection",
  "parent_topic_id": "christianity",
  "source_node_id": "node_12",
  "relation": "subtopic",
  "start_ms": 124000,
  "summary": "The speakers began discussing historical evidence for the resurrection.",
  "confidence": 0.91
}
```

When the conversation returns to an earlier subject:

```
{
  "operation": "revisit_topic",
  "previous_node_id": "node_08",
  "source_node_id": "node_21",
  "new_label": "Faith and evidence",
  "start_ms": 345000
}
```

The backend uses these operations to create or modify graph records.

Use OpenAI Structured Outputs with a strict JSON schema to reliably obtain machine-readable graph decisions. The currently documented `gpt-6-luna` is a suitable inexpensive candidate for frequent classification, while `gpt-6.1-terra` or `gpt-6.1-sol` can be evaluated if the difficult segmentation cases need stronger reasoning. All support structured outputs.

OpenAI API+3

For performance, I would start with Luna at low or no reasoning effort and use a more capable model for final graph refinement only if necessary.

### **What context should the model maintain?**

Maintain three forms of memory:

Recent context: The last 5–10 conversational turns, including exact wording.

Structural memory: A compact representation of the conversation graph: node IDs, topic names, parent relationships, and recently active nodes.

Longer-term memory: A rolling summary of older sections plus retrievable topic descriptions, used when deciding whether a previous subject is being revisited.

This avoids repeatedly sending a 60-minute transcript to the LLM and reduces both latency and cost.

### **Live interpretation versus final refinement**

One more important distinction:

During recording: Fast, incremental interpretations. Nodes may be provisional and summaries brief.

After recording: A second pass can correct transcription mistakes, merge duplicate nodes, split overly broad discussions, improve summaries, and resolve pending topics.

The final pass should preserve node IDs and user-generated annotations whenever possible, applying explicit graph edits rather than replacing the whole graph.

This provides a useful compromise between real-time responsiveness and analytical accuracy.

## **5\. Detecting forgotten and unexplored topics**

This deserves its own feature because it is potentially one of the application's strongest differentiators.

The key is to distinguish between a topic being mentioned and a topic being substantially discussed.

Consider:

> "We should talk about soccer later. I wanted to tell you something."

The system should interpret this as an intention, not as evidence that the conversation has covered soccer.

### **Proposed topic lifecycle**

Mentioned

An idea has been introduced, but not explored.

Pending

Someone expresses an intention to return to it.

Explored

The conversation develops the idea substantively.

Unexplored

The conversation ends without following up.

The AI can detect phrases such as "remind me to tell you," "we should come back to," or "there's something else I wanted to discuss."

It then registers a pending topic, with the timestamp of the original mention.

If the subject is later discussed, the topic becomes explored and links to the relevant discussion.

If it remains unaddressed, show it in a small floating area of the graph labeled Unexplored Threads.

A faint dotted connection can point to where the idea was first mentioned, without making it look like a discussion that actually occurred.

For accuracy, I would reserve the word "forgotten" for user-facing language where appropriate. The AI cannot reliably know whether the speakers genuinely forgot, deliberately skipped the idea, or decided it was no longer relevant.

This feature could eventually support a "Things to revisit next time" section in the conversation diary.

## **6\. The Personal Brain: connecting conversations over time**

The Brain is where the product can evolve from a recording tool into a personal knowledge system.

Imagine a user has had 40 conversations over several months. Across those conversations, they have repeatedly discussed philosophy, religion, friendships, career decisions, exercise, and personal goals.

The Brain should identify recurring concepts and connect them.

### **Building the Brain**

The workflow would be:

1. Extract canonical topics from each completed conversation.  
2. Generate semantic embeddings for those topics.  
3. Search the existing Brain for similar concepts.  
4. Merge references to the same concept, while keeping distinct concepts separate.  
5. Create relationships between related concepts.  
6. Arrange these concepts spatially in an interactive graph.

For example, multiple mentions of "existentialism" should all point to a common concept.

However, "existentialism" and "personal philosophy" should not necessarily merge into one concept. They are related, but not identical.

### **Semantic similarity is not the same as conceptual identity**

This distinction is critical.

Use an embedding model such as `text-embedding-3-small` to retrieve potentially related topics. OpenAI embeddings measure relatedness between text representations and are designed for tasks such as similarity search and clustering. Supabase supports storing and querying these embeddings using `pgvector`.

OpenAI API+1

Then use the LLM to classify each candidate relationship as:

* Same concept: Merge references under a canonical topic.  
* Broader/narrower: Religion → Christianity.  
* Related: Existentialism ↔ Personal identity.  
* Co-discussed: Career aspirations ↔ Financial stability.  
* Unrelated: No edge required.

This prevents the Brain from becoming a confusing network where every remotely similar idea is connected to everything else.

### **How should distances in the Brain work?**

A physics-based graph layout can position closely connected concepts nearer to each other, while weakly connected concepts move further apart.

For example:

Concept illustration. Stronger relationships generally create tighter clusters. Dashed lines are weaker or less established connections.

One important distinction is that geometric distance is a visualization, not an objective measurement of how psychologically close two ideas are.

A graph layout should reflect a mixture of semantic similarity, explicit relationships, and how frequently topics are discussed together.

A possible edge-weight calculation is:

${w}_{ij}=0.5{S}_{ij}+0.3{C}_{ij}+0.2{R}_{ij}$

Here, $S$ is semantic similarity, $C$ is normalized co-occurrence, and $R$ is an explicit relationship score. These coefficients are illustrative and would need tuning.

### **Interacting with a Brain node**

Tapping "Existentialism" should open a detail view containing:

Existentialism

12 mentions across 5 conversations — illustrative

* October 12 — Conversation with Alex: existentialism and personal identity.  
* October 20 — Conversation with Maya: free will and determinism.  
* November 3 — Solo reflection: finding meaning in career choices.

Each reference can lead to the exact original discussion node and its audio segment.

This is more useful than merely searching a transcript because the user can see the concept's context within each conversation.

### **Brain-specific features worth adding**

Topic evolution: Show how someone's thinking about a concept changes over time, using grounded excerpts rather than speculative psychological conclusions.

Interest clusters: Reveal frequently explored topic groups, such as philosophy, health, or relationships.

Personal connections: Display which topics commonly arise in conversations with particular people, with the participants' consent and appropriate privacy controls.

Search by idea: Queries such as "When did I talk about determinism?" should retrieve relevant conversations even if those exact words were not used.

For the hackathon, I would implement a simpler version: a concept graph generated from existing conversation nodes, with frequency counts and links back to their source conversations.

The complete semantic relationship engine can be developed afterward.

## **7\. Minimalistic mobile UI and UX**

The application should visually communicate curiosity, discovery, and connected ideas.

The dark galaxy aesthetic is a good fit, as long as it remains subtle enough that the maps are readable.

### **Visual identity**

Background

Surfaces

Topics

Revisits

Highlights

I would use deep navy rather than pure black, limited luminous accents, thin connection lines, and typography resembling Inter or SF Pro.

A subtle animated starfield could appear behind the home screen and Brain. The actual conversation map should use a much quieter background.

### **Screen A: Home**

The home screen should contain a large greeting and microphone, with very few competing actions.

atlas

# **Welcome.**

Where will your conversations take you?

Begin a conversation

Your conversations

Life & philosophy

Nov 6 · 38 min

Thoughts on work

Nov 3 · 21 min

Generate Brain

Illustrative mobile layout, not an implemented app. The final home screen can use restrained ambient stars and slow-moving connections.

### **Screen B: Live conversation map**

The map occupies nearly the entire screen.

A small recording bar remains visible, with elapsed time, recording status, and controls for flagging and stopping.

The active discussion node should have a subtle glow or pulse, and new nodes should appear with a short animation.

Connections need clear visual conventions:

| Connection | Appearance |
| ----- | ----- |
| Forward transition | Solid blue, arrowhead |
| Revisit | Curved violet, arrowhead |
| Parent/child hierarchy | Thin, understated |
| Unexplored intention | Dashed amber |
| User-created relationship | Neutral dotted line |
| Highlighted branch | Brighter stroke and soft glow |

The map should avoid unnecessarily moving existing nodes as new information arrives. A stable layout is important for visual memory.

### **Screen C: Conversation diary**

After recording, the conversation is saved with metadata:

* Conversation title, date, time, duration, and participants.  
* Interactive conversation map.  
* Optional audio and transcript.  
* Flags, highlighted branches, and annotations.  
* Unexplored threads and ideas to revisit.

A particularly useful feature would be a brief post-conversation reflection prompt:

"What would you like to remember from this conversation?"

The answer becomes a personal note associated with the entire conversation, or with a selected node.

### **Screen D: Brain**

The Brain opens into an expansive, zoomable conceptual network.

Selecting a topic highlights its immediate neighbors and dims the others.

A compact bottom sheet displays related ideas and the conversations where that topic appeared.

Users should be able to switch between viewing their entire Brain and focusing on one cluster.

### **Screen E: Library and Favorites**

On phones, use a slide-out drawer for folders and recent conversations. On a tablet or desktop, keep the drawer available as a sidebar.

Offer conversation folders, search, favorites, recently viewed maps, and a dedicated list of highlighted nodes.

### **Mobile interaction details**

Hover-based descriptions should be an enhancement on desktop, not the primary interaction mechanism.

On mobile:

* Single tap: open a short node preview.  
* Tap the preview: expand into a detail sheet with the description and audio.  
* Long press: show highlight, annotation, and link options.  
* Pinch: zoom.  
* Drag empty space: pan.  
* Double tap empty space: zoom or refocus.  
* Tap a highlighted branch: isolate it and its associated discussion path.

A small overview map, a "Fit all" control, and a "Jump to current topic" button will be especially helpful as conversations grow.

## **8\. Recording highlights and annotating the graph**

### **A. Instant audio flags**

When the user presses Flag during recording, save the exact timestamp.

The flag should later attach to whichever topic node covers that timestamp, or to the closest speech segment.

For example:

```
{
  "conversation_id": "conv_123",
  "timestamp_ms": 485000,
  "type": "bookmark",
  "note": null
}
```

The user can review that flagged moment after the recording.

About double-tapping the hardware volume button: This should be treated as an experimental enhancement rather than a guaranteed cross-platform feature. iOS does not provide a general-purpose public API for reliably repurposing hardware volume buttons in an ordinary Expo app. Android offers more options for handling hardware events in a foreground native activity, but platform behavior and background restrictions remain important. Apple's documented public volume interfaces primarily expose system-volume state and controls.

Apple Developer Documentation+1

For the hackathon, implement an in-app flag button first, potentially supplemented by a notification or headset shortcut later.

### **B. Highlighting branches**

Users should be able to select a topic and choose "Highlight branch."

Store highlights as graph annotations rather than modifying the AI-generated source data. A highlight might contain a set of node IDs, a color, a note, and a timestamp.

This allows the highlighted section to appear in the Favorites tab while keeping the original map intact.

### **C. Freeform annotations**

Users can attach their own notes to any node, and optionally position the notes directly on the canvas.

A note could be:

"I changed my mind about this after reading more about it."

Store annotations separately from generated summaries so the distinction between what was said and what the user thought afterward remains clear.

### **D. Audio playback**

Every discussion node should retain accurate start and end timestamps.

Selecting a node seeks to its beginning and plays the corresponding segment, with a little padding on either side if desired.

For longer recordings, use a range-enabled player or load the recording and seek to the stored start time. The graph should stay synchronized with audio playback, showing which topic is currently being heard.

## **9\. Recommended technical architecture**

The best option is a real React Native application using Expo, paired with a cloud backend and hosted AI services.

This provides an actual mobile application that can be tested through Expo Go, while keeping the backend, login system, and saved conversations independent of the device.

Expo / React Native

Microphone · Graph UI · Bookmarks · Login

Node.js WebSocket backend

Streams audio, validates sessions, orchestrates AI, broadcasts graph updates

Deepgram

Streaming transcription, timestamps and speaker detection

OpenAI

Topic interpretation, structured graph updates and embeddings

Supabase

Authentication · Postgres · Private audio storage · Graph persistence · pgvector

### **Recommended technology stack**

| Component | Recommended technology | Role |
| ----- | ----- | ----- |
| Mobile framework | Expo \+ React Native \+ TypeScript | Native iOS/Android application |
| Navigation | Expo Router | Home, recording, Brain, library |
| Audio capture | `expo-audio` | Live microphone streaming and recording |
| Transcription | Deepgram Nova-3 | Streaming speech-to-text |
| Speaker detection | Deepgram streaming diarization | Approximate speaker labels |
| AI interpretation | `gpt-6-luna` | Topic changes, summaries, intentions |
| Stronger AI reasoning | `gpt-6.1-terra` or `gpt-6.1-sol` | Optional graph refinement |
| Embeddings | `text-embedding-3-small` | Semantic topic comparison |
| Graph drawing | `react-native-svg` | Render nodes, edges, arrows |
| Graph layouts | `d3-hierarchy`, `d3-force` | Position conversation and Brain nodes |
| Touch interactions | React Native Gesture Handler | Pinch, zoom, pan |
| Backend | Node.js \+ TypeScript \+ `ws` | Persistent real-time connection |
| Cloud platform | Railway or Render | Host the WebSocket backend |
| Authentication | Supabase Auth | Accounts and sessions |
| Database | Supabase Postgres | Conversation and graph records |
| Audio files | Supabase Storage | Persistent private cloud recordings |
| Vector search | Supabase `pgvector` | Cross-conversation concept retrieval |

The Expo documentation confirms native audio streaming, and Supabase has current React Native integration guides.

Expo documentation+2

### **An important mobile graphics decision**

For this hackathon, I would use `react-native-svg` and simple custom layouts instead of trying to integrate a full browser-based graph editor into React Native.

React Flow (`@xyflow/react`) is excellent for a browser-based editor, particularly if you ultimately build a desktop companion, but it is not a drop-in React Native canvas.

With `react-native-svg`, the same Expo application can draw circles, labels, curved paths, arrowheads, and highlights on the phone. Gesture Handler supplies the touch interactions.

Expo documentation+2

For the initial conversation graph, a deterministic layout will also be easier to control than a completely dynamic force simulation.

## **10\. Real-time audio-to-graph pipeline**

### **Step 1: Capture live audio**

The current Expo Audio API provides `useAudioStream`, which exposes raw PCM buffers through an `onBuffer` callback. It also supports writing a captured stream to a file on iOS and Android. This makes it possible to feed live speech recognition while retaining a complete recording.

Expo documentation+2

The intended workflow is:

1. Request microphone permission.  
2. Start a PCM audio stream.  
3. Send audio buffers through a WebSocket to the backend.  
4. Record the audio to a temporary file on the device.  
5. Upload the completed file to private cloud storage.  
6. Save its cloud path in the conversation record.

Use mono, 16-bit PCM with a target sample rate supported by the transcription provider. Check the actual rate returned by the capture device and resample when required.

Important: The device holds temporary capture data during recording, but the authoritative saved copy lives in Supabase. That meets your cross-device persistence requirement.

This audio path should be tested on a physical phone at the beginning of the hackathon, including whether the chosen Expo SDK version works in Expo Go without a custom development build.

### **Step 2: Transcribe the conversation**

Use Deepgram Nova-3 through its streaming API.

Deepgram can produce interim and finalized transcripts with timing data. Its streaming diarization assigns provisional speaker labels to transcribed words. The current streaming diarization configuration supports `diarize_model=latest`, while its newer v2 diarizer is currently batch-only.

Deepgram docs+1

Use finalized transcripts to make graph decisions. Interim transcripts can update a small caption strip, but they should not permanently modify the graph because interim words may change.

A speech endpointing configuration around 300–500 milliseconds is a reasonable starting point for natural conversations, subject to testing.

Speaker labels such as `Speaker 0` and `Speaker 1` should not automatically be treated as real identities. Group conversations, especially overlapping speech, can make diarization unreliable.

### **Step 3: Interpret conversation chunks**

After enough finalized speech accumulates, the backend calls the LLM.

Inputs include the speech window and conversation state. Outputs are validated graph operations.

A minimal TypeScript type might look like this:

```
type GraphOperation = {
  action:
    | "continue"
    | "new_topic"
    | "new_subtopic"
    | "revisit"
    | "mark_pending"
    | "resolve_pending";

  label: string | null;
  sourceNodeId: string | null;
  targetNodeId: string | null;
  parentTopicId: string | null;

  summary: string;
  startMs: number;
  endMs: number;
  confidence: number;
};
```

This is a simplified interface; the production version should also contain source-utterance IDs and validation fields.

The backend, not the LLM, should assign permanent database IDs and enforce graph integrity.

### **Step 4: Update and save the graph**

Each validated change is added to the database and immediately transmitted to the app.

For example, the backend could broadcast:

```
{
  "event": "graph_updated",
  "conversation_id": "conv_123",
  "operation": {
    "action": "new_subtopic",
    "label": "Resurrection",
    "parentTopicId": "christianity"
  }
}
```

The app animates the newly created node into view.

The LLM should not control exact screen coordinates. That responsibility belongs to the layout engine.

### **Step 5: Finalize and upload**

When recording stops, the app uploads the audio to Supabase Storage and the backend performs a more complete analysis of the transcript.

This final pass identifies duplicate topics, unresolved threads, and imperfect segmentation. It also generates the short and expanded descriptions associated with each node.

Aim for visibly incremental topic updates every 10–25 seconds during the hackathon demo, rather than claiming word-by-word semantic mapping. Actual delay depends on speech recognition, model latency, connectivity, and discussion patterns.

## **11\. Cloud database structure**

This is another critical design decision. Do not save conversations as one large JSON file per user.

Use a relational database where conversation metadata, discussion nodes, graph edges, and personal annotations have independent records.

A workable schema would be:

| Table | Important fields | Purpose |
| ----- | ----- | ----- |
| `conversations` | id, user\_id, title, started\_at, ended\_at, audio\_path, status | Recording diary |
| `participants` | id, conversation\_id, display\_name, speaker\_index | Optional people metadata |
| `utterances` | id, conversation\_id, speaker\_index, start\_ms, end\_ms, text | Timestamped speech |
| `conversation_nodes` | id, conversation\_id, topic\_id, label, summary, start\_ms, end\_ms, parent\_node\_id | Discussion occurrences |
| `conversation_edges` | id, conversation\_id, source\_id, target\_id, edge\_type | Transitions and relationships |
| `flags` | id, conversation\_id, timestamp\_ms, node\_id, note | Saved moments |
| `annotations` | id, conversation\_id, node\_id, content, x, y | Personal notes |
| `highlights` | id, conversation\_id, name, selected\_node\_ids | Saved branches |
| `topics` | id, user\_id, canonical\_name, embedding, description | Concepts in the Brain |
| `topic_mentions` | id, topic\_id, conversation\_id, node\_id | Brain-to-conversation references |
| `topic_links` | source\_topic\_id, target\_topic\_id, relation, weight | Brain relationships |
| `folders` | id, user\_id, name | Conversation organization |

The database distinguishes a discussion occurrence from a concept.

A conversation can have three distinct discussion nodes about existentialism, all associated with one persistent `topics` entry.

This makes cross-conversation retrieval much easier.

### **Authentication and data security**

Use Supabase Auth with email/password or email-based login for the hackathon. Configure Row Level Security so users can only access their own private conversations and related records.

Audio files should be stored in a private Supabase Storage bucket, with authenticated access or short-lived signed URLs. Supabase documents both RLS-backed storage controls and private bucket access.

Supabase Docs+1

External transcription and LLM keys must stay on the backend, never embedded in the mobile app.

### **Suggested project organization**

```
conversation-atlas/
├── mobile/
│   ├── app/
│   │   ├── index.tsx
│   │   ├── login.tsx
│   │   ├── recording.tsx
│   │   ├── conversation/[id].tsx
│   │   ├── brain.tsx
│   │   └── library.tsx
│   ├── components/
│   │   ├── ConversationGraph.tsx
│   │   ├── BrainGraph.tsx
│   │   ├── TopicNode.tsx
│   │   ├── NodeDetails.tsx
│   │   └── RecordingControls.tsx
│   └── lib/
│       ├── supabase.ts
│       └── audioStream.ts
├── backend/
│   └── src/
│       ├── server.ts
│       ├── transcription.ts
│       ├── topicInterpreter.ts
│       ├── graphEngine.ts
│       ├── brainBuilder.ts
│       └── storage.ts
├── shared/
│   └── graphTypes.ts
└── supabase/
    └── migrations/
```

A shared TypeScript definition for nodes, edges, and graph operations helps keep the mobile and backend code synchronized.

## **12\. Accessibility and ADHD-related applications**

There is a credible opportunity to support memory, attention, and executive functioning. However, it is important to distinguish established cognitive findings from features that merely seem promising.

### **Relevant research**

Long-term memory in adult ADHD

A meta-analysis found differences in verbal memory acquisition and long-term performance in adults with ADHD, while visual memory findings were not similarly impaired in the studied tests. Importantly, the analysis linked long-term differences to acquisition rather than showing a general retrieval deficit.

PubMed+1

Design implication: Contextual, structured representations may be useful to explore, but this does not establish that conversation graphs improve memory in ADHD.

Prospective memory

Recent studies have examined difficulties remembering intended future actions in adults with ADHD. Episodic future thinking—imagining carrying out an intention—showed promising results, although findings have limitations and some effects depend on other variables.

PubMed+1

Design implication: Unexplored threads and explicitly stated future intentions could become reminders or prompts for future reflection.

Spaced retrieval and active recall

Research reviews support spacing and retrieval practice as effective learning strategies, although their effectiveness in a specific conversation-diary product would still need evaluation.

DOI

Design implication: The app could prompt users to recall key ideas before showing their notes.

### **Features that synergize particularly well**

| Feature | Potential benefit | Implementation difficulty |
| ----- | ----- | ----- |
| Unexplored Threads | Externalize conversational intentions | Low; already part of the core product |
| Favorite Moments | Quickly recover meaningful ideas | Low |
| Personal reflection notes | Associate conversations with meaningful context | Low |
| Search by concept | Retrieve ideas without remembering exact words | Medium |
| "What did we discuss last time?" | Support recall before another conversation | Low–medium |
| Optional follow-up reminders | Help users revisit stated intentions | Medium |
| Active recall prompts | Encourage deliberate remembering | Medium |
| Low-stimulation display | Reduce visual overload | Low |
| Conversation review timeline | Provide chronological context | Low |

### **Three features I would prioritize**

1\. Conversation memory cards

After recording, generate a small number of optional cards containing meaningful topics and prompts.

For example: "You discussed determinism and free will with Alex. What argument do you remember finding convincing?"

The user can answer before revealing the original discussion. This integrates active recall without making the app feel like a study tool.

2\. Unfinished thought reminders

If the app detects an explicit future intention, such as "I'll tell you about my interview next time," it can offer to save it as a reminder.

Do not automatically turn every passing comment into a task.

3\. Contextual recall

Before talking with someone again, users could choose to review a compact map of relevant earlier conversations.

This could be particularly valuable for remembering social context, shared interests, and previously raised questions.

These features should be opt-in and should not imply that the user has ADHD or another condition. The app is a general-purpose memory and reflection tool, not a diagnostic or therapeutic system.

## **13\. Privacy, consent, and responsible design**

A device listening to ordinary conversations creates substantial privacy obligations, especially when it uploads recordings and derives long-lived knowledge about individuals.

This is not something to defer entirely until after the hackathon.

In Canada, Criminal Code section 184 contains an exception where at least one relevant party consents to interception. But that does not settle all privacy obligations for a commercial recording application. Canada's Privacy Commissioner has also published guidance on meaningful consent, safeguarding recorded voice data, purpose limitations, and retention.

Justice Canada+2

I would build the following baseline into the product:

* Obtain clear, informed agreement from everyone participating in a recording before starting; provide an obvious recording indicator and a way to stop.  
* Explain that speech may be transmitted to transcription and AI providers, not just saved privately.  
* Make conversation maps private by default, with sharing as a deliberate action.  
* Provide deletion of the audio, transcript, graph, embeddings, and associated records.  
* Allow users to keep a map or written reflections while deleting the original audio, subject to participant consent.  
* Minimize retention and avoid automatically inferring medical, political, religious, or other sensitive personal attributes from conversations.

For the hackathon, limit testing to informed volunteers and clearly distinguish synthetic demo content from real recordings.

One especially good long-term feature is Map-Only Mode, in which the app generates a graph and then deletes the audio and detailed transcript. This would reduce the amount of highly sensitive information retained, although the map itself may still contain personal information.

## **14\. The 12-hour hackathon build plan**

The full vision is larger than a 12-hour project. But a strong end-to-end MVP is feasible if the team prioritizes the correct interactions.

The essential demo is:

Start recording → watch topic nodes appear → flag a moment → stop → save → reopen on another device → explore the graph → generate a Brain from multiple conversations.

### **What makes the cut?**

Essential features

Build first

* Supabase login and cloud persistence  
* Real microphone recording  
* Streaming or near-real-time topic analysis  
* Topic nodes and directional edges  
* Revisited and unexplored topic detection  
* Basic pan/zoom and node details  
* Saving and reopening conversations

High-value additions

Build if core works

* Instant flags and node favorites  
* Basic annotations  
* Brain built from saved topics  
* Audio playback from a selected node  
* Folders and conversation labels

Post-hackathon

Defer

* Hardware volume-button shortcuts  
* Complex AI topic-evolution analysis  
* Full multi-user sharing  
* Advanced speaker recognition  
* Automated reminders  
* Very large-scale graph optimization  
* Production-grade offline synchronization

### **Suggested development timeline**

One 12-hour sprint, assuming 3–4 developers and API accounts prepared in advance

0–1h

Setup and architecture

Expo project, backend skeleton, Supabase setup, shared types

1–2h

Authentication and persistence

Login, database tables, private storage, RLS

2–4h

Audio and transcription

Physical-phone microphone test, streaming gateway, finalized transcripts

4–6h

AI topic interpreter

Structured graph operations, revisits, pending topics

6–8h

Interactive graph UI

Nodes, arrows, zoom, pan, selection and summaries

8–9h

Diary and flags

Save, reload, timestamp bookmarks

9–10h

Basic Brain

Generate canonical topics and link conversations

10–11h

Integration and polish

Home design, transitions, UI refinements

11–12h

End-to-end testing

Use real and prepared conversations; verify cross-device login

### **Parallelization**

If you have four team members, divide responsibility by integration boundaries rather than by app screens.

| Developer | Responsibility |
| ----- | ----- |
| A — Mobile/UI | Expo screens, graph renderer, zoom and pan |
| B — Audio/backend | Microphone pipeline, WebSocket, Deepgram |
| C — AI | Topic segmentation, graph operations, semantic matching |
| D — Cloud/integration | Supabase, auth, storage, Brain, end-to-end tests |

The AI developer can initially test against prepared transcript chunks while the audio developer brings the microphone pipeline online.

Similarly, the UI developer can render a prepared graph JSON payload without waiting for live model output.

That is an important time-saving technique: agree on the graph data contracts in the first hour.

### **Hackathon fallback strategy**

A functional fallback is essential.

If live streaming is not stable by the audio milestone, switch to this sequence:

* Record a complete conversation using the phone.  
* Upload the real audio file to the backend.  
* Transcribe and analyze it.  
* Animate the resulting graph progressively during playback.

The recording, AI interpretation, database, and interactive graph are still genuine. The demo should simply describe the graph generation as post-recording rather than claim it is live.

This is far better than spending the entire hackathon debugging real-time sockets without ever completing the product.

## **15\. How to test whether the AI actually understands conversations**

I would prepare several short scripted conversations before the hackathon.

The tests should cover:

| Test | Example | Expected behavior |
| ----- | ----- | ----- |
| Simple transition | Sports → music | Two linked topic segments |
| Specificity | Religion → Christianity → resurrection | Parent/child concepts |
| Revisit | Philosophy → career → philosophy | New occurrence with revisit edge |
| Unexplored thread | "Let's talk about soccer later" | Pending topic, then unexplored |
| Resolved intention | Soccer mentioned, later discussed | Pending topic becomes explored |
| Brief digression | Ten-second unrelated joke | No unnecessary permanent node |
| Synonyms | "Working out" and "going to the gym" | Appropriate concept matching |
| Ambiguity | "Java" as language versus island | Avoid false concept merging |
| Multiple speakers | Two people alternating | Timestamped transcript with provisional speakers |
| Saved session | Close app, log in elsewhere | Same graph loads from cloud |

Evaluate node quality, topic-transition precision, revisit accuracy, and unresolved-topic handling.

Also inspect whether clicking a node leads to the correct audio passage. An attractive graph that maps to the wrong moment is not useful.

For an early demo, use a five-minute conversation that intentionally includes a topic shift, a revisit, an unresolved intention, and a bookmarked moment.

That gives the judges a visible demonstration of the product's differentiating features.

## **16\. Longer-term opportunities**

After the MVP, I see several particularly interesting extensions.

Conversation replay: Animate the graph from beginning to end, showing how the discussion evolved while synchronizing the recorded audio. This could be an especially distinctive way of remembering a conversation.

Branch exploration: Select a branch and see all the ideas that emerged from one initial topic, rather than the entire conversation.

Thought development: Compare discussions of the same subject over several months, showing where positions changed and linking to the exact supporting statements.

Solo thought mapping: Record a voice journal or stream-of-consciousness reflection. The same topic graph can represent internal thought transitions without requiring another speaker.

Conversation continuity: Show explicitly saved topics the user hoped to revisit the next time they spoke with someone.

Collaborative maps: With participant consent, allow two people to annotate or reflect on their shared conversation map independently.

Personal knowledge export: Export selected concepts and notes to a graph or Markdown format so the user's knowledge is not trapped inside the application.

## **17\. Final recommendation**

I would organize the project around the following priorities.

Nail conversation structure first

Topic transitions, meaningful granularity, revisits, and unexplored ideas are the true core innovation. A good graph matters more than an elaborate landing page.

Make the saved data real

Use authentication and normalized cloud records from the start. This is what enables the diary and the Brain to exist as genuine features.

Make the graph visually memorable

Use simple labels, purposeful motion, consistent directionality, and progressive disclosure. The user should feel that they are watching a living conversation develop, not reading a diagram generated by a meeting assistant.

The strongest version of this product is not an AI note-taking app that happens to draw bubbles.

It is a visual memory system for human thought and conversation, where the sequence, relationships, detours, and revisits are treated as first-class information.

For a 12-hour hackathon, the combination of Expo, Deepgram, an inexpensive structured-output LLM, and Supabase is a realistic foundation. It requires orchestration, prompting, graph logic, and interface development—but no custom model training.

If you can demonstrate a genuine conversation turning into a navigable map, preserve it in the cloud, and then show its topics becoming part of a larger personal Brain, you will have demonstrated the central idea and established a strong foundation for a much more ambitious application.

