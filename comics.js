/* The comics (2026-11-01): the stand-in seats of a Punchlines table. A comic is a bot the host sat down ("Fill with comics"),
   a seat whose person has been away for three phases, or one whose link has been down past the grace; each answers from
   the bank below, so a table with two people missing still has an answer in every blank and a vote on every matchup.

   The bank is ours: short, original, family-friendly lines, filed by the kind of blank they fit (kindOf reads the prompt:
   "The worst thing to say at ..." wants something said, "A terrible name for ..." a name, and so on). answer() draws from
   the prompt's own kind most of the time and from the lines that suit any blank the rest, and never says one line twice
   in a game. Nothing here is typed by a player, so nothing here goes through the moderation reader; test/comics.js reads
   every line with its word list instead. */
"use strict";
const crypto = require("crypto");

const BANK = {
  /* something said, texted, shouted or thought out loud */
  say: [
    "Does this cake have a name?", "I brought my own llama.", "Nobody panic, but the goose is back.", "Is it too late to be a pirate?",
    "Quick, hide the spaghetti!", "Who invited my twin?", "Sorry, wrong planet.", "I put the cat in charge.",
    "That's not a hat, that's my hair!", "I only came for the soup.", "Can you hold my sandwich?", "Fun fact: I'm allergic to Mondays.",
    "Please don't feed the tuba.", "Oops, I sat on your lasagna.", "I definitely didn't eat the evidence.", "Is this seat taken by the cake?",
    "Beep boop, I am a normal human.", "My other dog is a wolf.", "Who turned the floor into lava?", "Can we go back to the part with cake?",
    "I speak fluent penguin.", "Time out, my sock fell off.", "I was told there'd be pie.", "Don't mind me, I'm just a bush.",
    "Technically, a hot dog is a sandwich.", "I'd like to speak to the moon.", "We should totally adopt a walrus.", "Hold on, I'm updating my hat.",
    "Sorry, I thought this was a nap.", "Where do you keep the confetti?", "I swear that sock was alive.", "Nobody told me it was Opposite Day.",
    "You can't prove I'm not a robot.", "Let's all just clap and hope.", "My horse says hello.", "Does anyone speak goat?",
    "May I borrow your elbow?", "I'll have what the giraffe is having.", "I'm going to need a bigger spoon.", "Quiet, the pillows are listening.",
    "Can I get that in glitter?", "Say cheese... no, the other cheese.", "That wasn't me, that was my belly.", "I accidentally joined the circus.",
    "Just five more minutes of bubbles.", "I'm only allowed one dragon.", "Tell the pigeons I said hi.", "Wait, which one is the soup?",
    "I knew it, the couch is a spy.", "Is that a cloud or a very big sheep?", "Please remain calm, I am a mango.", "Everything is fine, the ceiling is just shy.",
    "I think my shoe is in love.", "Who ordered a thousand ducks?", "I'm not lost, I'm exploring sideways.", "Careful, that pudding bites.",
    "Not the hat, anything but the hat!", "Why is the moon following me?", "I can't find my other elbow.", "We're out of both kinds of jelly.",
    "Do you validate parking for unicorns?", "Is the wizard coming to dinner?", "I blame the squirrels.", "Cough twice if you're a ghost.",
    "I just remembered I'm a sandwich.", "I'm being chased by my own shadow.", "Do not touch the big red banana.", "That's a lot of llama for one room.",
  ],
  /* the reason, the excuse, the real cause */
  excuse: [
    "a squirrel stole the Wi-Fi", "the dog ate the map", "Grandma's hat started a rumor", "the clock got tired",
    "a goose held the door hostage", "everyone was busy hugging a cactus", "the pigeons formed a club", "someone taught the toaster to sing",
    "the moon asked for a day off", "an octopus borrowed the keys", "all the socks went on strike", "Mercury was in a bad mood",
    "the elevator needed a hug", "a wizard changed the sign", "the cat pressed the wrong button", "somebody fed the vending machine glitter",
    "a very slow parade went by", "three ducks blocked the road", "the GPS fell in love with a roundabout", "the calendar had a typo",
    "a llama was learning to drive", "my shoes had a secret meeting", "the bus took a scenic detour to Mars", "a jellyfish sat on the schedule",
    "the sun overslept", "the clouds were rehearsing", "the wind borrowed my homework", "a runaway pancake rolled past",
    "there were just so many bubbles", "a dinosaur needed the bathroom first", "an owl asked for directions", "the snow globe got jealous",
    "the sandwich wasn't finished", "a raccoon ran the meeting", "the umbrella changed its mind", "my pet rock needed a lift",
    "the whole town was playing hide and seek", "the pencil case got stuck in traffic", "someone hid the weekend", "the robot vacuum went exploring",
    "a parade of penguins crossed the street", "the lights broke, and so did the dark", "somebody sat on the doorbell", "the stairs went the wrong way",
  ],
  /* a name for a pet, a team, a shop, a ship, a chat */
  name: [
    "Sir Nibbles-a-Lot", "Captain Soggy", "Wobbly Pete", "Mr. Fluffington", "The Soggy Biscuits", "Bubble Trouble",
    "Professor Pickle", "Noodle McNoodleface", "Grumpy Banana", "The Flying Pancakes", "Lord Wiggles", "Snuggle Bandit",
    "Fancy Pants", "Tater Tot Tornado", "The Dizzy Donuts", "Waffle Wizard", "Big Fuzzy Bob", "Mildly Spicy",
    "Tiny Thunder", "The Mighty Muffins", "Pudding Pirates", "Super Soggy", "Hot Potato Hotel", "Dave's Dizzy Diner",
    "Sparkle Sprout", "Moonbeam Mike", "Cheesy Wheezy", "Slippery Steve", "Mr. Bumblesnort", "The Wobbly Wizards",
    "Ziggy Zoodle", "Lady Gigglesworth", "Peanut Butter Panic", "The Lost Socks", "Glitter Gorilla", "Quacky McQuack",
    "Gary the Goose", "The Sleepy Sloths", "Count Snacula", "Fuzzy Wuzzy Wonders", "Baron Von Bubbles",
    "The Dancing Dumplings", "Admiral Crumbs",
  ],
  /* the title of a film, a show, a story, a song */
  title: [
    "The Day My Soup Escaped", "Revenge of the Pillow Fort", "A Very Long Nap", "Attack of the Giant Sneeze",
    "The Llama Who Forgot Everything", "The Great Sock Mystery", "Dinner with Gerald the Goose", "A Walrus on the Roof",
    "The Bathtub Pirates", "The Great Cookie Caper", "The Princess and the Pickle", "Three Bears and a Burrito",
    "The Cat Who Ran the Bank", "Spoon Quest", "Bubble Bath Bandits", "The Mystery of the Missing Mitten",
    "Mission: Nap Time", "Grandpa's Secret Trampoline", "My Toaster Has Feelings", "The Haunted Sandwich",
    "Tiny Tornado Tim", "Return of the Soggy Biscuit", "Dancing with the Squirrels", "The Last Pancake on Earth",
    "Beware the Rubber Duck", "Moonwalking Marmot", "Sir Snore-a-Lot", "The Itchy Sweater",
    "Escape from Sock Island", "Spaghetti Stampede", "The Wobbly Wizard of Wednesday", "Jellybean Jungle",
    "Pigeon Palace", "The Great Cheese Heist", "Tuba Trouble", "A Walrus Called Wendy",
    "Kitten Kung Fu Academy", "Snack Attack at the Zoo", "The Pickle Who Wanted to Fly", "Two Ducks and a Mystery",
  ],
  /* a slogan, a rule, a sign on the wall */
  slogan: [
    "We're good at stuff!", "Come for the soup, stay for the soup.", "Now with 20% more hamster.", "Please wipe your paws.",
    "No refunds on hugs.", "Trust us, it's mostly clean.", "Where nothing ever quite fits.", "Just add glitter.",
    "Fresh ideas, slightly used.", "We try our best-ish.", "Don't ask about the basement.", "Smile, the goat is watching.",
    "Always bring a spare spoon.", "Nap first, ask later.", "Our pigeons are very professional.", "No running, no jumping, no llamas.",
    "Only on Tuesdays, only in socks.", "Everything is probably fine.", "Be nice to the snack.", "Hats required after noon.",
    "Quiet hours: all of them.", "Bring your own wobble.", "Everyone gets a trophy, even the goat.", "Dress code: dramatic.",
    "Whisper when the toaster is asleep.", "Free hugs, small fee for the hug.", "Because why not?", "If it squeaks, it's yours.",
    "Making mountains out of molehills since 1987.", "We have no idea what we're doing, but loudly.", "Eat well, nap often.", "Please do not pet the furniture.",
    "Lost something? So did we.", "Now with extra sprinkles.", "All the noodles you can carry.", "Your wobble, our pleasure.",
  ],
  /* a food, a flavour, a topping, an ingredient */
  food: [
    "pickle-flavoured cotton candy", "burnt toast sprinkles", "a whole lemon, peel on", "gravy ice cream",
    "cold spaghetti sprinkles", "marshmallow meatloaf", "mango-mustard swirl", "raisin and ketchup surprise",
    "blueberry broccoli", "peanut butter and pepper jam", "lukewarm lemonade soup", "soggy cereal with fish crackers",
    "chocolate-covered onions", "cheesy jellybeans", "banana-bacon bubblegum", "pineapple pizza with gravy",
    "mashed potato milkshake", "a tuna sundae", "spicy marshmallows", "pickled pudding",
    "cabbage cupcakes", "toothpaste sorbet", "vanilla-garlic crunch", "broccoli brownies",
    "jellyfish jelly", "soup on a stick", "peas and pancakes", "sprouts and sprinkles",
    "a burger-flavoured lollipop", "olive ice pops", "lasagna lemonade", "cheddar cheesecake",
    "radish ripple", "grape gravy", "cinnamon sardines", "waffles with ketchup",
    "wasabi whipped cream", "a hot dog sundae", "noodle nuggets", "mystery casserole with a hat",
  ],
  /* an object, an item, a thing you might find */
  thing: [
    "a very damp sock", "a tiny trumpet", "a spoon with feelings", "a trampoline for ants",
    "forty-two rubber ducks", "a bag of mystery gravel", "my uncle's wig", "a half-eaten crayon",
    "an angry pillow", "a map to nowhere", "a left-handed boomerang", "one single mitten",
    "a jar of buttons", "a cactus in a sweater", "glow-in-the-dark spaghetti", "a very confused snail",
    "a suitcase full of confetti", "a mysterious blue key", "a pair of shoes for a snake", "a clock that runs backwards",
    "an umbrella with holes", "a golden toothbrush", "an invisible sandwich", "a hat with a hat",
    "the world's smallest violin", "a handful of glitter", "a lonely meatball", "a banana wearing sunglasses",
    "a rubber chicken", "a bucket of left socks", "a talking doorknob", "a dusty trophy for 'Participation'",
    "an escaped balloon", "a pocket full of marbles", "a hand puppet that knows too much", "a kite stuck in a tree",
    "a banana peel", "a suspicious potato", "a giant paperclip", "a snow globe with a tiny storm",
  ],
  /* an invention, an app, a feature, a gadget */
  idea: [
    "An app that argues with your cat", "A fork with a built-in hat", "Wi-Fi for goldfish", "A button that says 'maybe'",
    "An alarm clock that tells jokes", "A hat that holds tiny hats", "A robot butler for goldfish", "A snack catapult",
    "A calendar with only Fridays", "A treadmill for hamsters with snacks", "A phone that only plays elevator music", "A GPS for finding your other sock",
    "An app that rates your naps", "A jetpack for the cat", "A fridge that gossips", "A kite with a mind of its own",
    "A trampoline in every elevator", "A pillow that tells bedtime stories", "A self-stirring soup bowl", "An umbrella for indoors",
    "A snooze button for Mondays", "A backpack with a built-in nap", "A doorbell that sings", "Shoes that tie themselves, badly",
  ],
  /* a sport, a game */
  sport: [
    "Underwater bowling", "Synchronised napping", "Competitive cloud watching", "Hide and seek for professionals",
    "Extreme sock folding", "Speed knitting on trampolines", "Sandcastle demolition derby", "Pillow fight marathon",
    "Backwards walking relay", "Musical beds", "Soup curling", "Banana limbo",
    "Pogo-stick chess", "Blindfolded pancake flipping", "Tug of war with a very long noodle", "Hopscotch for giants",
    "Chess, but everyone's a pigeon", "Dance-off with penguins", "Wheelbarrow ballet", "Competitive staring",
    "Sock-puppet boxing", "Synchronised sock-hopping", "Spoon-and-egg marathon", "Hula hooping in a lift",
  ],
  /* the theme of a party */
  theme: [
    "Everyone dresses as a sandwich", "Pirates versus pandas", "Underwater, but dry", "A silent disco for hamsters",
    "The great sock hop", "Medieval laundry day", "Backwards day", "Tiny hats only",
    "A castle made of boxes", "Jungle, but in a bathtub", "Pajama Olympics", "Dress as your favourite vegetable",
    "A spaghetti western with real spaghetti", "Dinosaurs on roller skates", "Fancy dress, but in your own clothes", "A tea party for goldfish",
  ],
  /* the start of "___ Day" */
  dayname: [
    "Pillow Fight", "Sock Swap", "Hug a Llama", "Pajama", "Backwards", "Pancake", "Bubble Wrap", "National Nap",
    "Silly Hat", "Wear Two Shoes", "Talk Like a Pirate", "High-Five a Stranger", "Soup for Breakfast", "Dance Like a Chicken", "Hide the Broccoli", "Everyone Gets a Cookie",
  ],
  /* the start of "___ Man" */
  man: [
    "Captain Hiccup", "Soggy Sock", "Noodle", "Banana", "Wobble", "Pickle", "Sir Sneeze", "Mister Snooze",
    "Spaghetti", "Flip-Flop", "Marshmallow", "Bubble", "Sandwich", "Toast", "Lord Soggy", "Giggle",
  ],
  /* an animal */
  animal: [
    "flamingo", "hedgehog", "walrus", "goldfish", "giraffe", "penguin", "hamster", "octopus", "llama", "sloth",
    "goose", "crab", "kangaroo", "owl", "squirrel", "pigeon", "snail", "tortoise", "panda", "dolphin",
  ],
  /* what someone does: a hobby, a way, a habit, a talent, a power */
  activity: [
    "juggling soup", "knitting a sweater for a snail", "teaching the dog to yodel", "collecting lost mittens",
    "whispering to houseplants", "racing shopping carts at midnight", "competitive bubble wrap popping", "synchronised sneezing",
    "building pillow castles", "walking backwards on Wednesdays", "arguing with the thermostat", "tap dancing in socks",
    "stacking spoons", "speed-eating sandwiches", "naming every cloud", "singing to the fridge",
    "painting pebbles with tiny faces", "balancing a spoon on your nose", "hugging trees", "hopping on one leg to the shops",
    "babysitting a potato", "waving at airplanes", "high-fiving the mailman", "doing the robot at bus stops",
    "talking to pigeons", "turning invisible, but only socks", "being extremely early", "making any sandwich slightly warmer",
    "knowing what time it is, roughly", "hiccuping on demand", "folding fitted sheets (somehow)", "breathing really loudly",
    "reading maps upside down", "writing letters to the moon", "growing a tiny mustache for fun", "teaching goldfish to dance",
    "inventing new colours", "tickling clouds",
  ],
  /* a creature, a character, a person, a power-holder */
  creature: [
    "a very polite goat", "a confused flamingo", "an overconfident hamster", "a dancing octopus",
    "a sleepy dragon", "the world's slowest cheetah", "a grumpy walrus", "a penguin in a tuxedo",
    "a tiny wizard named Gary", "a talking potato", "the ghost of a sandwich", "a very hairy sock",
    "a llama with opinions", "a squirrel with a briefcase", "an overly dramatic pigeon", "a shy volcano",
    "a goose in disguise", "a sloth on roller skates", "my invisible friend Doug", "a mermaid on a bicycle",
    "a robot that only says 'meh'", "a lion who hates loud noises", "a giraffe in a tiny car", "Professor Hiccup",
    "a nervous cactus", "a ten-foot hamster", "a polite tornado", "a very tall snail",
    "the tooth fairy's cousin", "a bear who loves ballet", "a crab with a camera", "a monkey in a tie",
    "a dinosaur named Kevin", "a cloud that follows you", "an owl who gives bad advice", "a wizard allergic to magic",
  ],
  /* what a pet, the moon, a ghost or a machine thinks or wants */
  thought: [
    "I wonder if I can sit on that.", "Dinner is late again.", "Please stop talking to me in that voice.", "I could take that sandwich.",
    "I will rule the sofa.", "Is it nap time yet?", "Why is everyone so loud?", "Look at me, I'm very important.",
    "More snacks, fewer questions.", "The humans are acting suspicious.", "Today I shall do absolutely nothing.", "That bird is looking at me.",
    "Maybe if I stare long enough...", "I need a bigger bed.", "Who moved my favourite spot?", "Nice hat, though.", "Bigger. I want it bigger.", "Hmm, that button looks fun.",
    "I should have been a cloud.", "They forgot my birthday again.", "Is that a snack or a hat?", "Everything is a toy if you're brave enough.",
    "If I sit still, nobody will notice.", "I demand a tiny crown.", "One day I'll learn to fly.", "Why does the vacuum hate me?",
    "I was here first.", "Let's pretend we never met.", "I knew where the cookies were all along.", "The mailman and I have history.",
  ],
  /* what a person types into a search box at 3am */
  search: [
    "how to teach a goldfish to dance", "is my toaster alive", "can llamas swim", "how many ducks fit in a car",
    "why is my cat judging me", "world's biggest sandwich", "how to fold a fitted sheet", "do goldfish get bored",
    "what rhymes with orange (again)", "how to become a pirate by Friday", "are pigeons secretly smart", "how tall is a giraffe's hat",
    "why do socks vanish", "can I train a snail to fetch", "soup for breakfast: yes or no", "who invented the nap",
    "how to hide a hippo", "best name for a potato", "is a pickle a fruit", "how long can I stare at a wall",
  ],
  /* a password somebody uses */
  password: [
    "hamster2000", "Fluffy1234", "letmein-please", "IAmNotARobot", "banana123", "ilovemydog", "SnackTime99", "FortyTwo",
    "cheese4ever", "NotThePassword", "AbracadabraPlease", "12345 (again)", "mynameisgary", "Sunshine1", "password (but backwards)", "ilovepickles",
    "OpenSesame2", "noodles4life", "MyCatIsTheBoss", "qwerty-ish", "Pa55word with feelings", "WhatIsMyPassword",
  ],
  /* things that suit almost any blank */
  any: [
    "a very large spoon", "Uncle Bob's secret", "twelve angry ducks", "pure glitter",
    "something sticky", "Grandma's other grandma", "a bucket of jellybeans", "whatever that smell was",
    "a lot of bubbles", "my imaginary friend", "too many hats", "two thousand tiny elephants",
    "the neighbour's parrot", "a very patient snail", "an eight-hour sneeze", "fancy socks",
    "pickles. Just pickles.", "a surprise party for a goat", "someone's long-lost spoon", "three squirrels in a trench coat",
    "a bouncy castle", "a banana", "the entire marching band", "pure confusion",
    "a mountain of laundry", "a duck in a bow tie", "a loud sandwich", "my left shoe",
    "extra cheese", "a flying carpet with a parking ticket", "the world's longest hug", "a dancing broccoli",
    "my cousin's pet rock", "a tuba solo", "wobbly jelly", "a puppet with a plan",
    "an overdue library llama", "soggy confetti", "a bag of left-over giggles", "Dave",
    "a very serious pigeon", "a tiny parade", "an extra-large hamster wheel", "one thousand paper planes",
    "the last cookie", "a hippo in a hammock", "a cardboard castle", "somebody's lunch",
    "the sound of a trombone falling down stairs", "a rubber duck convention", "my sock drawer", "a very smug cat",
    "a mystery meatball", "a pile of pillows", "the biggest sneeze ever", "an upside-down umbrella",
    "an honest-to-goodness walrus", "a robot called Steve", "a lot of noodles", "the grand cheese caper",
    "an itchy sweater", "sparkly spaghetti", "a goose with a plan", "a vacuum cleaner named Gloria",
    "the wrong sandwich", "a banana phone with no signal", "two very tired llamas", "a chorus of kazoos",
    "yesterday's pancakes", "my left eyebrow", "a trampoline full of cats", "a giant pair of pants",
    "the smell of popcorn", "tiny umbrellas", "a hat full of frogs", "the fanciest potato",
  ],
};

const KINDS = Object.keys(BANK);

/* The blank's kind, read off the prompt (first rule that fits wins; anything else takes the lines that suit any blank). */
const RULES = [
  ["any", /says about you|talk about|job title|real meaning/],
  ["dayname", /_ day\b/],
  ["man", /_ man\b/],
  ["animal", /\bhalf _/],
  ["thought", /^what .*\b(thinks?|thinking|wonders?|planning|plans|wants?|really want)\b/],
  ["password", /\bpassword\b/],
  ["search", /\b(google|search history|searched)\b/],
  ["slogan", /\b(slogan|tagline|motto|poster|policy|rule|rules|sign says|buzzword|jingle|catchphrase)\b/],
  ["say", /\b(say|says|said|saying|shout|whisper|text|reply|hear|overheard|last words|opening line|pick-up line|first line|line to end|toast|speech|announce|autocorrect|voice says|advice|comment|question|quote)\b/],
  ["excuse", /\b(real reason|reason|excuse|because of)\b/],
  ["title", /\b(title|sequel|documentary|reality show|kids' cartoon|cartoon that|autobiography|song choice|song to have|montage song|binge-watch)\b|musical number/],
  ["name", /\b(name for|name of|names|called|named|nickname)\b|\bsuperhero name\b/],
  ["food", /\b(pizza|topping|flavou?r|ingredient|biryani|recipe|ice cream|dish|snack|cook|cooking|pancakes?|cocktail|popcorn|potluck|order|eat|menu|chips|soup|sandwich|dinner|lunch|breakfast|dessert|cake|burger|taco)\b/],
  ["activity", /\b(way to|ways to|hobby|hobbies|exercise|activity|talent|habit|trait|superpower|power|job for|job|do on|does all day|do all day|do in|thing about|learn on your last|spend|wake up|best thing to do|worst thing to do|hired to|what .* (does|do|would do)|what happens)\b/],
  ["creature", /\b(mascot|animal|person|who would|character|monster|ghost|dragon|neighbo[u]?rs?|hero|villain|kid|baby|babies|pet|dog|cat|evil twin|goes to|it was _ all along)\b/],
  ["theme", /\b(theme)\b/],
  ["sport", /\b(sport|olympic|olympics|game(?! show)|party game)\b/],
  ["idea", /\b(idea|feature|invention|invent|app|gadget|goal|pretends)\b/],
  ["thing", /\b(find|found|under your|gift|present|item|treasure|pocket|pack|bring|lost-and-found|time capsule|contents|camera roll|prize|inside|made of|carry|bag|drawer|wear|put on|put in|resume|stuck in|expense claim|put in)\b/],
];

function kindOf(prompt) {
  const t = String(prompt || "").toLowerCase().replace(/_+/g, "_");
  for (const [kind, re] of RULES) if (re.test(t)) return kind;
  return "any";
}

const pick = (a) => a[crypto.randomInt(a.length)];

/* The kinds whose blank takes any noun phrase, so a line that suits any blank may stand in (one time in ten) */
const LOOSE = new Set(["any", "thing", "creature", "food", "activity"]);

/* One answer for the prompt, not one in `used` (a Set the room keeps; the line is added to it). The prompt's own kind, with
   a line that suits any blank now and then where the blank allows it; if the pool is spent the other one helps out, and
   a spent bank starts again rather than leave a comic with nothing to say. */
function answer(prompt, used) {
  used = used || new Set();
  const kind = kindOf(prompt);
  const own = BANK[kind];
  const free = (a) => a.filter((x) => !used.has(x));
  const pools = [free(LOOSE.has(kind) && crypto.randomInt(10) === 0 ? BANK.any : own), free(own), free(BANK.any)];
  let pool = pools.find((p) => p.length);
  if (!pool) { used.clear(); pool = own; }
  const line = pick(pool);
  used.add(line);
  return line;
}

/* The people (2026-11-04, the Prime-Time Show). Every player picks who stands behind their podium from eight people the app draws, four men and four
   women (m1-m4, f1-f4: the teal jacket, the burgundy blazer with a short beard, the grey hair with glasses, the curly hair in a mustard hoodie; the red
   blazer, the long box braids, the silver pixie cut, the lilac hijab). A comic is dealt one too, with a plain first name that fits it (ours, never a
   celebrity's). The old cast (the tabby and the puppy), the pool of cute names and the animal portraits the app hashed them into are gone. An older app that
   knows no `person` dresses a comic by its name as it dresses any bot, so every comic still has a face and a name there. */
const PEOPLE = {
  m1: { kind: "m", name: "Max" }, m2: { kind: "m", name: "Omar" }, m3: { kind: "m", name: "Raj" }, m4: { kind: "m", name: "Leo" },
  f1: { kind: "f", name: "Nora" }, f2: { kind: "f", name: "Imani" }, f3: { kind: "f", name: "Sofia" }, f4: { kind: "f", name: "Layla" },
};
const PERSON_IDS = Object.keys(PEOPLE);
/* Plain first names of the same kind, for a table with more comics than people (a person repeats, its name must not). */
const RESERVE = { m: ["Sam", "Ben", "Theo", "Eli", "Jay", "Ian", "Gus", "Ned"], f: ["Mia", "Zoe", "Ivy", "Ruby", "Tess", "Lena", "June", "Ada"] };
const AVATAR = "\u{1F3A4}";   // the microphone: the sticker every comic carries (the app draws a comic as its person)
/* m1-m4 or f1-f4, else null: nobody's person is ever guessed. */
const personOf = (x) => (typeof x === "string" && Object.prototype.hasOwnProperty.call(PEOPLE, x) ? x : null);
const wearCount = (worn, id) => worn.filter((w) => w === id).length;

/* The person a human wears, from the one they picked and `worn` (the persons the others at the table wear, repeats counted): their pick when nobody wears it,
   else the next free one of the same kind (the kind's order, round from the pick: a man's for a man, a woman's for a woman), else, with all four of the kind
   worn, the one worn least (their own pick first among equals), so people repeat only within a kind. */
function dealHuman(pick, worn) {
  const ring = PERSON_IDS.filter((id) => PEOPLE[id].kind === PEOPLE[pick].kind);
  const at = ring.indexOf(pick);
  const order = ring.map((_, i) => ring[(at + i) % ring.length]);
  const free = order.find((id) => wearCount(worn, id) === 0);
  if (free) return free;
  const least = Math.min(...order.map((id) => wearCount(worn, id)));
  return order.find((id) => wearCount(worn, id) === least);
}
/* A comic's person and name: a free person (any kind, at random), else one worn least (at random among them); the person's own name, or a plain reserve
   name of its kind when that one is already at the table. */
function dealComic(worn, takenNames) {
  const free = PERSON_IDS.filter((id) => wearCount(worn, id) === 0);
  const least = Math.min(...PERSON_IDS.map((id) => wearCount(worn, id)));
  const pool = free.length ? free : PERSON_IDS.filter((id) => wearCount(worn, id) === least);
  const person = pool[crypto.randomInt(pool.length)];
  const own = PEOPLE[person].name;
  let name = own;
  if (takenNames.has(own)) {
    const reserve = RESERVE[PEOPLE[person].kind].filter((n) => !takenNames.has(n));
    name = reserve.length ? reserve[crypto.randomInt(reserve.length)] : own + " " + (takenNames.size + 1);
  }
  return { person, name, avatar: AVATAR };
}

function count() { return new Set(Object.values(BANK).flat()).size; }

module.exports = { BANK, KINDS, kindOf, answer, PEOPLE, PERSON_IDS, RESERVE, AVATAR, personOf, dealHuman, dealComic, count };
