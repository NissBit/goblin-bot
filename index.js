require('dotenv').config();
const fs = require('fs');
const cron = require('node-cron');
const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');

const GOBLIN_CHANNEL_ID = '1500025967588937831';
const DATA_FILE = './goblin-data.json';
const TIMEZONE = 'America/Los_Angeles';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

let challenge = {
  active: false,
  startDate: null,
  endDate: null,
  finalAnnounced: false
};

let pendingChallenge = null;
let stepData = {};

const goblinMoods = [
  {
    name: "Grouchy",
    line: "The goblin woke up grouchy and demands extra steps from all mortals today.",
    stepPraise: "The goblin grunts. Fine. These steps are acceptable, but do not expect applause.",
    lowSteps: "The goblin squints. These are not steps. These are crumbs.",
    randoms: [
      "The goblin is grouchy today. Walk more.",
      "The goblin demands movement. Immediately.",
      "Someone here is disappointing the sacred shoe."
    ]
  },
  {
    name: "Chaotic",
    line: "The goblin woke up chaotic and may reward effort or mock it. No promises.",
    stepPraise: "The goblin spins in a tiny circle and records your steps with suspicious joy.",
    lowSteps: "The goblin laughs so hard he drops the scroll. Tiny steps. Tiny drama.",
    randoms: [
      "The goblin has rearranged the shoelaces. Do not ask why.",
      "A mortal somewhere is walking. The goblin approves aggressively.",
      "The goblin smells ambition. Or snacks."
    ]
  },
  {
    name: "Judgmental",
    line: "The goblin woke up judgmental. All excuses will be inspected and rejected.",
    stepPraise: "The goblin records your offering. You may continue existing.",
    lowSteps: "The goblin has seen ants travel farther.",
    randoms: [
      "The goblin is judging your step count from afar.",
      "Excuses have been banned by goblin decree.",
      "Walk now. Explain later."
    ]
  },
  {
    name: "Dramatic",
    line: "The goblin woke up dramatic and believes every step is part of an epic saga.",
    stepPraise: "The goblin raises the scroll to the sky. A worthy chapter has been written.",
    lowSteps: "The goblin collapses dramatically. Such few steps. Such tragedy.",
    randoms: [
      "The goblin gazes into the distance. The trial continues.",
      "Every step echoes through history. Probably.",
      "The sacred shoe awaits a champion."
    ]
  },
  {
    name: "Suspiciously Encouraging",
    line: "The goblin woke up encouraging, which is suspicious but useful.",
    stepPraise: "The goblin nods. Strong effort, mortal. Do not make this weird.",
    lowSteps: "The goblin believes you can do better. Unfortunately, he is right.",
    randoms: [
      "The goblin believes in you today. This is alarming.",
      "Tiny progress is still progress, mortal.",
      "The goblin says hydrate and walk. Begrudgingly."
    ]
  }
];

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ challenge, stepData }, null, 2));
}

function loadData() {
  if (fs.existsSync(DATA_FILE)) {
    const data = JSON.parse(fs.readFileSync(DATA_FILE));
    challenge = data.challenge || challenge;
    stepData = data.stepData || {};
  }
}

function isAdmin(message) {
  return message.member.permissions.has(PermissionsBitField.Flags.Administrator);
}

function getDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function getYesterdayKey() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return getDateKey(date);
}

function formatDate(date) {
  return new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: TIMEZONE
  });
}

function getTodayMood() {
  const today = getDateKey();
  let total = 0;

  for (const char of today) {
    total += char.charCodeAt(0);
  }

  return goblinMoods[total % goblinMoods.length];
}

function getDailyRankings(dateKey) {
  const rankings = [];

  for (const [userId, user] of Object.entries(stepData)) {
    const dailyTotal = user.entries
      .filter(entry => entry.date === dateKey)
      .reduce((sum, entry) => sum + entry.steps, 0);

    if (dailyTotal > 0) {
      rankings.push({
        userId,
        username: user.username,
        steps: dailyTotal
      });
    }
  }

  return rankings.sort((a, b) => b.steps - a.steps);
}

function getOverallRankings() {
  return Object.values(stepData).sort((a, b) => b.total - a.total);
}

async function postDailyAnnouncement() {
  if (!challenge.active) return;

  const channel = client.channels.cache.get(GOBLIN_CHANNEL_ID);
  if (!channel) return;

  const mood = getTodayMood();
  const yesterday = getYesterdayKey();
  const rankings = getDailyRankings(yesterday);

  if (rankings.length === 0) {
    await channel.send(
      `@everyone\n\n` +
      `👹 **Morning Goblin Judgment**\n\n` +
      `${mood.line}\n\n` +
      `The goblin checked yesterday's scroll for **${formatDate(yesterday)}**...\n\n` +
      `No steps were submitted.\n\n` +
      `The goblin is disappointed. Deeply. Dramatically.`
    );
  } else {
    const winner = rankings[0];

    let message =
      `@everyone\n\n` +
      `👹 **Morning Goblin Judgment**\n\n` +
      `${mood.line}\n\n` +
      `The goblin has reviewed the steps from **${formatDate(yesterday)}**.\n\n` +
      `Today's **👹 Holder of the Sacred Shoe** is **${winner.username}** with **${winner.steps}** steps.\n\n` +
      `**Yesterday's Standings:**\n`;

    rankings.forEach((user, index) => {
      message += `#${index + 1} ${user.username}: **${user.steps}** steps\n`;
    });

    message += `\nThe goblin has spoken. Continue walking, mortals.`;

    await channel.send(message);
  }

  if (yesterday >= challenge.endDate && !challenge.finalAnnounced) {
    const overall = getOverallRankings();

    if (overall.length > 0) {
      const champion = overall[0];

      let finalMessage =
        `@everyone\n\n` +
        `👑 **Final Goblin Judgment**\n\n` +
        `The trial has ended. The steps have been counted. The excuses have been ignored.\n\n` +
        `The goblin crowns **${champion.username}** as the **👑 Trial Victor** with **${champion.total}** total steps.\n\n` +
        `**Final Standings:**\n`;

      overall.forEach((user, index) => {
        finalMessage += `#${index + 1} ${user.username}: **${user.total}** steps\n`;
      });

      finalMessage += `\nThe goblin bows slightly... but only slightly.`;

      await channel.send(finalMessage);
    }

    challenge.finalAnnounced = true;
    challenge.active = false;
    saveData();
  }
}

function handleGoblinConversation(message, lower) {
  if (message.content.startsWith('!')) return false;

  lower = lower.replace(/<@!?\d+>/g, '').trim();

  if (lower === '') {
    message.reply("You have summoned the goblin. Speak your request, mortal.");
    return true;
  }

  const mood = getTodayMood();

  if (['hi', 'hello', 'hey', 'yo', 'sup', 'greetings'].some(word => lower.includes(word))) {
    const replies = [
      "The goblin acknowledges your presence. Have you walked?",
      "Greetings, mortal. Your step count will determine your worth.",
      "Hello. The goblin is already judging you.",
      "You have greeted the goblin. This was a bold decision.",
      "The goblin peeks from behind the sacred scroll. Speak."
    ];
    message.reply(replies[Math.floor(Math.random() * replies.length)]);
    return true;
  }

  if (lower.includes('who are you') || lower.includes('what are you')) {
    message.reply("I am the Accountability Goblin, keeper of steps, judge of mortals, and owner of the sacred shoe. I do not explain myself twice.");
    return true;
  }

  if (lower.includes('good morning')) {
    message.reply(`The goblin awakens. ${mood.line}`);
    return true;
  }

  if (lower.includes('good night')) {
    message.reply("The goblin watches even while you sleep. Rest… but not too comfortably.");
    return true;
  }

  if (
    lower.includes('funny') ||
    lower.includes('joke') ||
    lower.includes('laugh') ||
    lower.includes('want to hear something funny')
  ) {
    const jokes = [
      "A mortal once said, 'I'll walk later.' The goblin still laughs about that.",
      "Why did the mortal stop walking? Weakness.",
      "The funniest thing the goblin has seen? A 300-step day.",
      "The goblin does not joke. Life is the joke. Also your step count.",
      "The sacred shoe once ran away from a lazy mortal. Understandable."
    ];
    message.reply(jokes[Math.floor(Math.random() * jokes.length)]);
    return true;
  }

  if (lower.includes('tired') || lower.includes('lazy') || lower.includes('sleepy')) {
    message.reply("Tired? The goblin respects your honesty. The goblin ignores it. Walk anyway.");
    return true;
  }

  if (
    lower.includes('excuse') ||
    lower.includes('cant walk') ||
    lower.includes("can't walk") ||
    lower.includes("don't want") ||
    lower.includes('dont want') ||
    lower.includes('skip')
  ) {
    message.reply("The goblin accepts your excuse... and throws it directly into the fire.");
    return true;
  }

  if (lower.includes('i walked') || lower.includes('i got steps') || lower.includes('got my steps')) {
    message.reply("The goblin hears claims of walking. Submit the sacred number with `!steps` or be suspected of exaggeration.");
    return true;
  }

  if (lower.includes('walk') || lower.includes('steps')) {
    const replies = [
      "Did someone say steps? The goblin awakens.",
      "Walking is encouraged. Stopping is suspicious.",
      "The goblin nods. Movement is good.",
      "The goblin is listening for numbers...",
      "The sacred scroll accepts only step offerings."
    ];
    message.reply(replies[Math.floor(Math.random() * replies.length)]);
    return true;
  }

  if (lower.includes('motivate') || lower.includes('motivation') || lower.includes('hype') || lower.includes('encourage')) {
    const hype = [
      "Walk like the goblin is chasing you. Because he might be.",
      "Every step brings you closer to glory. Or at least less shame.",
      "Move. The goblin demands it.",
      "Your future self will thank you. The goblin will judge you regardless.",
      "You are capable of more steps. Unfortunately, now the goblin expects them."
    ];
    message.reply(hype[Math.floor(Math.random() * hype.length)]);
    return true;
  }

  if (lower.includes('sacred shoe') || lower.includes('shoe')) {
    message.reply("The sacred shoe is not merely a shoe. It is power. It is glory. It probably smells terrible.");
    return true;
  }

  if (lower.includes('trial victor') || lower.includes('victor') || lower.includes('winner')) {
    message.reply("Only one mortal will rise as 👑 Trial Victor. The rest will be remembered... poorly.");
    return true;
  }

  if (lower.includes('thank you') || lower.includes('thanks')) {
    message.reply("The goblin accepts your gratitude. Payment in steps is preferred.");
    return true;
  }

  if (lower.includes('sorry')) {
    message.reply("The goblin does not require apologies. The goblin requires steps.");
    return true;
  }

  if (lower.includes('water') || lower.includes('hydrate')) {
    message.reply("The goblin commands hydration. Dry mortals walk poorly.");
    return true;
  }

  if (lower.includes('help')) {
    message.reply(
      "The goblin permits these commands:\n\n" +
      "`!steps 5000` — submit steps\n" +
      "`!leaderboard` — view rankings\n" +
      "`!undo` — erase your last step entry\n" +
      "`!challenge` — view current trial\n" +
      "`!mood` — learn today's goblin mood"
    );
    return true;
  }

  const fallbackReplies = [
    "The goblin heard you, but understood only vibes.",
    "The goblin tilts his head. Interesting. Suspicious, but interesting.",
    "The goblin records this conversation under: questionable mortal behavior.",
    "The goblin is unsure what you mean, but he is certain more walking would help.",
    "The goblin blinks slowly. Try again, mortal."
  ];

  message.reply(fallbackReplies[Math.floor(Math.random() * fallbackReplies.length)]);
  return true;
}

client.once('ready', () => {
  loadData();
  console.log(`Goblin is awake as ${client.user.tag}`);

  cron.schedule('0 8 * * *', () => {
    postDailyAnnouncement();
  }, {
    timezone: TIMEZONE
  });
});

client.on('messageCreate', (message) => {
  if (message.author.bot) return;

  const args = message.content.trim().split(' ');
  const command = args[0].toLowerCase();
  const lower = message.content.toLowerCase();
  const isMentioned = message.mentions.has(client.user);

  if (isMentioned) {
    if (handleGoblinConversation(message, lower)) return;
  }

  if (command === '!goblin' || command === '!whoareyou') {
    message.reply("I am the Accountability Goblin, keeper of steps, judge of mortals, and loyal commander of the sacred shoe.");
  }

  if (command === '!mood') {
    const mood = getTodayMood();
    message.reply(`Today's goblin mood is **${mood.name}**.\n\n${mood.line}`);
  }

  if (command === '!startchallenge') {
    if (!isAdmin(message)) {
      message.reply("The goblin hisses... How dare this mortal attempt to command me? Only my loyal servant holds such power.");
      return;
    }

    if (args.length < 3) {
      message.reply("The goblin grumbles... Use: `!startchallenge YYYY-MM-DD YYYY-MM-DD`");
      return;
    }

    const start = new Date(args[1]);
    const end = new Date(args[2]);

    if (isNaN(start) || isNaN(end)) {
      message.reply("The goblin squints... These dates are nonsense. Use `YYYY-MM-DD`.");
      return;
    }

    if (args[2] < args[1]) {
      message.reply("The goblin bonks the calendar... The end date cannot come before the start date, mortal.");
      return;
    }

    pendingChallenge = {
      startDate: args[1],
      endDate: args[2]
    };

    message.reply(
      `The goblin squints at the sacred calendar...\n\n` +
      `You are about to begin a trial from **${formatDate(args[1])}** to **${formatDate(args[2])}**.\n\n` +
      `Type \`!confirmchallenge\` to begin, or \`!cancelchallenge\` to cancel.`
    );
  }

  if (command === '!confirmchallenge') {
    if (!isAdmin(message)) {
      message.reply("The goblin snaps the scroll shut... Only my loyal servant may confirm the sacred trial.");
      return;
    }

    if (!pendingChallenge) {
      message.reply("The goblin blinks... There is no pending challenge to confirm.");
      return;
    }

    challenge.active = true;
    challenge.startDate = pendingChallenge.startDate;
    challenge.endDate = pendingChallenge.endDate;
    challenge.finalAnnounced = false;
    stepData = {};
    saveData();

    const channel = client.channels.cache.get(GOBLIN_CHANNEL_ID);

    if (channel) {
      channel.send(
        `@everyone\n\n` +
        `👹 **THE GOBLIN'S STEP TRIAL HAS BEEN DECLARED** 👹\n\n` +
        `A new trial shall run from **${formatDate(challenge.startDate)}** to **${formatDate(challenge.endDate)}**.\n\n` +
        `Each morning at **8:00 AM**, the goblin will announce the previous day's standings.\n\n` +
        `Each day, the top walker shall be crowned:\n` +
        `**👹 Holder of the Sacred Shoe**\n\n` +
        `At the end, one will rise above all:\n` +
        `**👑 Trial Victor**\n\n` +
        `Walk boldly, mortals. The goblin is watching.`
      );
    }

    pendingChallenge = null;
  }

  if (command === '!cancelchallenge') {
    if (!isAdmin(message)) {
      message.reply("The goblin clutches the parchment... This cancellation is not yours to command, mortal.");
      return;
    }

    pendingChallenge = null;
    message.reply("The goblin burns the mistaken prophecy.");
  }

  if (command === '!endchallenge') {
    if (!isAdmin(message)) {
      message.reply("The goblin snarls... Know your place.");
      return;
    }

    challenge.active = false;
    saveData();

    message.reply("The goblin declares... The trial has ended.");
  }

  if (command === '!steps') {
    if (!challenge.active) {
      message.reply("The goblin scoffs... There is no active trial.");
      return;
    }

    const today = getDateKey();

    if (today < challenge.startDate || today > challenge.endDate) {
      message.reply("The goblin checks the calendar... Steps can only be submitted during the active challenge dates.");
      return;
    }

    const steps = parseInt(args[1]);

    if (!steps || steps < 1) {
      message.reply("The goblin squints... Try again.");
      return;
    }

    const userId = message.author.id;
    const username = message.author.username;
    const date = getDateKey();
    const mood = getTodayMood();

    if (!stepData[userId]) {
      stepData[userId] = { username, total: 0, entries: [] };
    }

    stepData[userId].username = username;
    stepData[userId].total += steps;
    stepData[userId].entries.push({ steps, date });

    saveData();

    if (steps < 1000) {
      message.reply(`${mood.lowSteps} The goblin records **${steps}** steps anyway.`);
    } else {
      message.reply(`${mood.stepPraise} Recorded: **${steps}** steps.`);
    }
  }

  if (command === '!undo') {
    const userId = message.author.id;

    if (!stepData[userId] || stepData[userId].entries.length === 0) {
      message.reply("Nothing to undo.");
      return;
    }

    const last = stepData[userId].entries.pop();
    stepData[userId].total -= last.steps;

    saveData();

    message.reply(`The goblin erases **${last.steps}** steps. Suspicious, but permitted.`);
  }

  if (command === '!leaderboard') {
    const rankings = getOverallRankings();

    if (rankings.length === 0) {
      message.reply("No steps yet.");
      return;
    }

    let msg = "👹 **Leaderboard** 👹\n\n";

    rankings.forEach((u, i) => {
      msg += `#${i + 1} ${u.username}: **${u.total}** steps\n`;
    });

    message.reply(msg);
  }

  if (command === '!challenge') {
    if (!challenge.active) {
      message.reply("The goblin mutters... No trial is currently active.");
      return;
    }

    message.reply(
      `The current trial runs from **${formatDate(challenge.startDate)}** to **${formatDate(challenge.endDate)}**.`
    );
  }

  if (command === '!testdaily') {
    if (!isAdmin(message)) {
      message.reply("The goblin swats your hand away. Only my loyal servant may test the sacred morning judgment.");
      return;
    }

    postDailyAnnouncement();
    message.reply("The goblin performs a test morning judgment.");
  }
});

client.login(process.env.TOKEN);
