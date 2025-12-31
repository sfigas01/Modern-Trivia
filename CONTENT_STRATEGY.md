# Modern Trivia: Content Strategy

## Core Philosophy: "Freshly Squeezed & Globally Smart"
A trivia game that feels alive and intelligent. It mixes hyper-local Canadiana with globally relevant general knowledge, avoiding US-centric defaults while staying accessible to Canadians aged 18-50.

---

## The Four Content Pillars

### 🎬 Pillar A: "The Time Capsule" (30%)
**Target:** Gen X / Elder Millennials (30-50)

Shared nostalgia from the 80s, 90s, and 2000s. Questions about iconic Canadian moments, beloved pop culture, historical landmarks, and generational touchstones.

**Examples:**
- Degrassi plot points and characters
- MuchMusic VJs and early Canadian TV
- The Simpsons, Friends, X-Files
- Heritage moments ("I smell burnt toast")
- Classic Canadian musicians (Celine Dion, Gretzky, Margaret Atwood)
- Y2K tech boom and early internet culture

---

### 🌍 Pillar B: "Global, Eh?" (30%)
**Target:** Everyone (The "Smart" Pillar)

General knowledge that is **NOT** US-centric. World history, science, geography, literature, and culture from a global perspective.

**The Rule:**
- Geography questions won't be about Iowa; they'll be about world capitals, oceans, landmarks
- History questions avoid US Civil War unless Canada was involved
- Focus on World Cup, Nobel Prize winners, European history, Asian cultures, etc.

**Examples:**
- World capitals and major cities
- International Nobel Prize winners
- Global science and nature facts
- World history and civilizations
- International sports events

---

### ⚡ Pillar C: "Fresh Prints" (25%)
**Target:** Gen Z / Younger Millennials (18-30) + News Junkies

Viral moments, current Billboard hits, trending topics, and meme culture from the last 3 months. This is where the game stays fresh and relevant.

**Examples:**
- Recent celebrity news and scandals
- Current music chart toppers
- Recent awards season winners (Oscars, Grammys)
- Trending social media moments
- Recent sports championships
- Breaking pop culture news

**AI-Ready:** This pillar is designed for periodic AI ingestion of daily/weekly trends to keep questions current.

---

### 🏕️ Pillar D: "The Great Outdoors" (15%)
**Target:** The "Hoser" Lifestyle

Culinary, travel, slang, cottage life, and uniquely Canadian experiences. Questions about food, nature, regional lingo, and lifestyle.

**Examples:**
- Poutine, butter tarts, Nanaimo bars
- Canadian slang ("bunnyhugs," "double-double," "toque")
- CN Tower, Niagara Falls, Rocky Mountains
- Cottage culture and outdoor recreation
- Lacrosse, ice hockey heritage
- Regional Canadian cuisine and coffee culture (Tim Hortons)

---

## Distribution Target

- **TimeCapsule:** ~15 questions (30%)
- **GlobalEh:** ~15 questions (30%)
- **FreshPrints:** ~12-13 questions (25%)
- **GreatOutdoors:** ~7-8 questions (15%)

**Total:** 50-question starter bank

---

## Future: Dynamic Pillars

Once fully scaled with AI, players can request niche topics like "1990s Toronto Raves" or "Organic Chemistry 101" and the AI generates custom rounds on demand, outside the standard mix.

---

## How Questions Are Tagged

Each question in `questions.json` has:
- **Location tags:** `CA`, `US`, or `Global`
- **Category tags:** `History`, `Music`, `Geography`, `Science`, etc.
- **Pillar tags:** `TimeCapsule`, `GlobalEh`, `FreshPrints`, or `GreatOutdoors`

The game filters to Canadian-friendly content by default (Global + CA tagged questions) and maintains pillar diversity to ensure a balanced, engaging mix.
