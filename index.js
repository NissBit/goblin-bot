require('dotenv').config();
const fs = require('fs');
const cron = require('node-cron');
const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  ChannelType,
  PermissionFlagsBits
} = require('discord.js');

const GOBLIN_CHANNEL_ID = '1500025967588937831';
const DATA_FILE = './goblin-data.json';
const TIMEZONE = 'America/Los_Angeles';

const CATEGORY_NAME = '👟 Step Tribute Hall';

const TRIAL_VICTOR_ROLE = '👑 Trial Victor';
const FORMER_CHAMPION_ROLE = '🏆 Former Step Champion';
const SACRED_SHOE_ROLE = '👹 Holder of the Sacred Shoe';

const SELECTABLE_ROLES = [
  '👟 Mileage Monster',
  '💨 Step Assassin',
  '🏃 Pro Athlete',
  '🔥 Pavement Pusher',
  '🐇 Step Sprinter',
  '🚶 Casual Cruiser',
  '🐢 Slow & Steady'
];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

let challenge = {
  active: false,
  startDate: null,
  endDate: null,
  finalAnnounced: false,
  lastShoeHolderId: null,
  lastShoeHolderName: null
};

let pendingChallenge = null;
let stepData = {};
let participants = {};

const goblinMoods = [
  {
    name: "Grouchy",
    line: "The goblin woke up grouchy and demands extra steps from all mortals today.",
    stepPraise: "The goblin grunts. Fine. These steps are acceptable, but do not expect applause.",
    lowSteps: "The goblin squints. These are not steps. These are crumbs."
  },
  {
    name: "Chaotic",
    line: "The goblin woke up chaotic and may reward effort or mock it. No promises.",
    stepPraise: "The goblin spins in a tiny circle and records your steps with suspicious joy.",
    lowSteps: "The goblin laughs so hard he drops the scroll. Tiny steps. Tiny drama."
  },
  {
    name: "Judgmental",
    line: "The goblin woke up judgmental. All excuses will be inspected and rejected.",
    stepPraise: "The goblin records your offering. You may continue existing.",
    lowSteps: "The goblin has seen ants travel farther."
  },
  {
    name: "Dramatic",
    line: "The goblin woke up dramatic and believes every step is part of an epic saga.",
    stepPraise: "The goblin raises the scroll to the sky. A worthy chapter has been written.",
    lowSteps: "The goblin collapses dramatically. Such few steps. Such tragedy."
  },
  {
    name: "Suspiciously Encouraging",
    line: "The goblin woke up encouraging, which is suspicious but useful.",
    stepPraise: "The goblin nods. Strong effort, mortal. Do not make this weird.",
    lowSteps: "The goblin believes you can do better. Unfortunately, he is right."
  }
];

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ challenge, stepData, participants }, null, 2));
}

function loadData() {
  if (fs.existsSync(DATA_FILE)) {
    const data = JSON.parse(fs.readFileSync(DATA_FILE));
    challenge = { ...challenge, ...(data.challenge || {}) };
    stepData = data.stepData || {};
    participants = data.participants || {};
  }
}

function findRole(guild, roleName) {
  return guild.roles.cache.find(role => role.name === roleName);
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
  for (const char of today) total += char.charCodeAt(0);
  return goblinMoods[total % goblinMoods.length];
}

function cleanChannelName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'mortal';
}

function getDailyRankings(dateKey) {
  const rankings = [];

  for (const [userId, user] of Object.entries(stepData)) {
    const dailyTotal = user.entries
      .filter(entry => entry.date === dateKey)
      .reduce((sum, entry) => sum + entry.steps, 0);

    if (dailyTotal > 0) rankings.push({ userId, username: user.username, steps: dailyTotal });
  }

  return rankings.sort((a, b) => b.steps - a.steps);
}

function getOverallRankings() {
  return Object.entries(stepData)
    .map(([userId, user]) => ({ userId, ...user }))
    .sort((a, b) => b.total - a.total);
}

function roleSelectionText() {
  return SELECTABLE_ROLES.map((role, index) => `${index + 1}. ${role}`).join('\n');
}

async function getStepCategory(guild) {
  return guild.channels.cache.find(
    ch => ch.type === ChannelType.GuildCategory && ch.name === CATEGORY_NAME
  );
}

async function createParticipantChannel(member) {
  const guild = member.guild;
  const category = await getStepCategory(guild);

  if (!category) {
    console.log(`Missing category: ${CATEGORY_NAME}`);
    return;
  }

  const channelName = cleanChannelName(member.user.username);
  let channel = guild.channels.cache.find(ch => ch.name === channelName && ch.parentId === category.id);

  if (!channel) {
    channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AddReactions
          ],
          deny: [PermissionFlagsBits.SendMessages]
        },
        {
          id: member.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AddReactions
          ]
        },
        {
          id: client.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.AddReactions
          ]
        }
      ]
    });
  }

  participants[member.id] = {
    username: member.user.username,
    channelId: channel.id,
    selectedRoles: participants[member.id]?.selectedRoles || []
  };
  saveData();

  await channel.send(
    `👹 The goblin has noticed a new mortal.\n\n` +
    `Welcome, ${member}. Your personal step chamber has been forged.\n\n` +
    `Choose your walking identities by typing:\n` +
    `\`!roles 1 3 5\`\n\n` +
    `You may choose one or multiple roles:\n\n` +
    `${roleSelectionText()}\n\n` +
    `The sacred challenge roles cannot be chosen. They must be earned.`
  );
}

async function assignSelectableRoles(message, numbers) {
  const member = message.member;
  const guild = message.guild;

  const selectedIndexes = [...new Set(numbers)]
    .map(n => parseInt(n, 10))
    .filter(n => n >= 1 && n <= SELECTABLE_ROLES.length);

  if (selectedIndexes.length === 0) {
    message.reply(
      `The goblin squints at your choices. Use numbers like \`!roles 1 3 5\`.\n\n${roleSelectionText()}`
    );
    return;
  }

  const selectedRoleNames = selectedIndexes.map(index => SELECTABLE_ROLES[index - 1]);

  for (const roleName of SELECTABLE_ROLES) {
    const role = findRole(guild, roleName);
    if (role && member.roles.cache.has(role.id)) {
      await member.roles.remove(role).catch(() => {});
    }
  }

  for (const roleName of selectedRoleNames) {
    const role = findRole(guild, roleName);
    if (role) {
      await member.roles.add(role).catch(() => {});
    }
  }

  participants[member.id] = {
    username: member.user.username,
    channelId: participants[member.id]?.channelId || message.channel.id,
    selectedRoles: selectedRoleNames
  };

  saveData();

  message.reply(
    `The goblin accepts your chosen identities:\n\n` +
    `${selectedRoleNames.join('\n')}\n\n` +
    `Wear them with honor... or at least mild effort.`
  );
}

async function updateSacredShoeRole(guild, winnerId) {
  const role = findRole(guild, SACRED_SHOE_ROLE);
  if (!role) return;

  for (const member of role.members.values()) {
    await member.roles.remove(role).catch(() => {});
  }

  const winner = await guild.members.fetch(winnerId).catch(() => null);
  if (winner) {
    await winner.roles.add(role).catch(() => {});
  }
}

async function moveOldVictorToFormerChampion(guild) {
  const victorRole = findRole(guild, TRIAL_VICTOR_ROLE);
  const formerRole = findRole(guild, FORMER_CHAMPION_ROLE);

  if (!victorRole || !formerRole) return;

  for (const member of victorRole.members.values()) {
    await member.roles.remove(victorRole).catch(() => {});
    await member.roles.add(formerRole).catch(() => {});
  }
}

async function assignTrialVictor(guild, winnerId) {
  const victorRole = findRole(guild, TRIAL_VICTOR_ROLE);
  if (!victorRole) return;

  for (const member of victorRole.members.values()) {
    await member.roles.remove(victorRole).catch(() => {});
  }

  const winner = await guild.members.fetch(winnerId).catch(() => null);
  if (winner) {
    await winner.roles.add(victorRole).catch(() => {});
  }
}

function makePrizePairings(overall) {
  const topHalfCount = Math.floor(overall.length / 2);
  const pairings = [];

  for (let i = 0; i < topHalfCount; i++) {
    const winner = overall[i];
    const sponsor = overall[overall.length - 1 - i];

    if (winner && sponsor && winner.userId !== sponsor.userId) {
      pairings.push(`#${i + 1} ${winner.username} receives a prize from #${overall.length - i} ${sponsor.username}`);
    }
  }

  return pairings;
}

function formatOverallStandings() {
  const overall = getOverallRankings();

  if (overall.length === 0) return `No challenge steps have been recorded yet.`;

  return overall
    .map((user, index) => `#${index + 1} ${user.username}: **${user.total}** steps`)
    .join('\n');
}

function makeShoeCeremony(winner) {
  if (!challenge.lastShoeHolderId) {
    return (
      `👹 **THE SACRED SHOE HAS BEEN BESTOWED**\n\n` +
      `The goblin emerges from the shadows clutching the Sacred Shoe.\n\n` +
      `**New Holder:** ${winner.username}\n\n` +
      `${winner.username} has claimed the shoe with **${winner.steps}** steps.\n\n` +
      `"Walk boldly, new holder. The goblin is watching."`
    );
  }

  if (challenge.lastShoeHolderId === winner.userId) {
    return (
      `👹 **THE SACRED SHOE REMAINS CLAIMED**\n\n` +
      `${winner.username} still holds the Sacred Shoe with **${winner.steps}** steps.\n\n` +
      `The goblin narrows his eyes.\n\n` +
      `"Impressive. Annoying, but impressive."`
    );
  }

  return (
    `👹 **THE SACRED SHOE HAS BEEN STOLEN**\n\n` +
    `The goblin storms into the chamber clutching the sacred scroll.\n\n` +
    `**Former Holder:** ${challenge.lastShoeHolderName}\n` +
    `**New Holder:** ${winner.username}\n\n` +
    `The goblin pries the Sacred Shoe from ${challenge.lastShoeHolderName}'s hands and dramatically bestows it upon ${winner.username}.\n\n` +
    `${winner.username} has claimed the shoe with **${winner.steps}** steps.\n\n` +
    `"Walk boldly, new holder. The goblin is watching."`
  );
}

async function postDailyAnnouncement() {
  if (!challenge.active) return;

  const channel = client.channels.cache.get(GOBLIN_CHANNEL_ID);
  if (!channel) return;

  const guild = channel.guild;
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
      `The goblin is disappointed. Deeply. Dramatically.\n\n` +
      `**Current Challenge Standings:**\n${formatOverallStandings()}`
    );
  } else {
    const winner = rankings[0];

    await updateSacredShoeRole(guild, winner.userId);

    const ceremony = makeShoeCeremony(winner);

    let message =
      `@everyone\n\n` +
      `👹 **Morning Goblin Judgment**\n\n` +
      `${mood.line}\n\n` +
      `${ceremony}\n\n` +
      `**Yesterday's Standings:**\n`;

    rankings.forEach((user, index) => {
      message += `#${index + 1} ${user.username}: **${user.steps}** steps\n`;
    });

    message += `\n**Current Challenge Standings:**\n${formatOverallStandings()}\n\n`;
    message += `The goblin has spoken. Continue walking, mortals.`;

    await channel.send(message);

    challenge.lastShoeHolderId = winner.userId;
    challenge.lastShoeHolderName = winner.username;
    saveData();
  }

  if (yesterday >= challenge.endDate && !challenge.finalAnnounced) {
    const overall = getOverallRankings();

    if (overall.length > 0) {
      const champion = overall[0];

      await assignTrialVictor(guild, champion.userId);

      const pairings = makePrizePairings(overall);

      let finalMessage =
        `@everyone\n\n` +
        `👑 **Final Goblin Judgment**\n\n` +
        `The trial has ended. The steps have been counted. The excuses have been ignored.\n\n` +
        `The goblin crowns **${champion.username}** as the **👑 Trial Victor** with **${champion.total}** total steps.\n\n` +
        `**Final Standings:**\n${formatOverallStandings()}\n\n`;

      if (pairings.length > 0) {
        finalMessage +=
          `🎁 **Prize Pairings**\n\n` +
          `${pairings.join('\n')}\n\n` +
          `Reminder: the prize of the winner's choice should not exceed **$15**.\n\n`;
      }

      finalMessage += `The goblin bows slightly... but only slightly.`;

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

  if (lower.includes('funny') || lower.includes('joke') || lower.includes('laugh') || lower.includes('want to hear something funny')) {
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

  if (lower.includes('excuse') || lower.includes('cant walk') || lower.includes("can't walk") || lower.includes("don't want") || lower.includes('dont want') || lower.includes('skip')) {
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
      "`!roles 1 3 5` — choose walking identities\n" +
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
  }, { timezone: TIMEZONE });
});

client.on('guildMemberAdd', async (member) => {
  await createParticipantChannel(member).catch(error => {
    console.error('Failed to create participant channel:', error);
  });
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const args = message.content.trim().split(' ');
  const command = args[0].toLowerCase();
  const lower = message.content.toLowerCase();
  const isMentioned = message.mentions.has(client.user);

  if (isMentioned) {
    if (handleGoblinConversation(message, lower)) return;
  }

  if (command === '!roles') {
    await assignSelectableRoles(message, args.slice(1));
    return;
  }

  if (command === '!goblin' || command === '!whoareyou') {
    message.reply("I am the Accountability Goblin, keeper of steps, judge of mortals, and loyal commander of the sacred shoe.");
    return;
  }

  if (command === '!mood') {
    const mood = getTodayMood();
    message.reply(`Today's goblin mood is **${mood.name}**.\n\n${mood.line}`);
    return;
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

    if (args[2] < args[1]) {
      message.reply("The goblin bonks the calendar... The end date cannot come before the start date, mortal.");
      return;
    }

    pendingChallenge = { startDate: args[1], endDate: args[2] };

    message.reply(
      `The goblin squints at the sacred calendar...\n\n` +
      `You are about to begin a trial from **${formatDate(args[1])}** to **${formatDate(args[2])}**.\n\n` +
      `Type \`!confirmchallenge\` to begin, or \`!cancelchallenge\` to cancel.`
    );
    return;
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

    await moveOldVictorToFormerChampion(message.guild);

    challenge.active = true;
    challenge.startDate = pendingChallenge.startDate;
    challenge.endDate = pendingChallenge.endDate;
    challenge.finalAnnounced = false;
    challenge.lastShoeHolderId = null;
    challenge.lastShoeHolderName = null;
    stepData = {};
    saveData();

    const channel = client.channels.cache.get(GOBLIN_CHANNEL_ID);

    if (channel) {
      channel.send(
        `@everyone\n\n` +
        `👹 **THE GOBLIN'S STEP TRIAL HAS BEEN DECLARED** 👹\n\n` +
        `A new trial shall run from **${formatDate(challenge.startDate)}** to **${formatDate(challenge.endDate)}**.\n\n` +
        `Each morning at **8:00 AM**, the goblin will announce the previous day's standings and the current challenge ranks.\n\n` +
        `Each day, the top walker shall be crowned:\n` +
        `**👹 Holder of the Sacred Shoe**\n\n` +
        `At the end, one will rise above all:\n` +
        `**👑 Trial Victor**\n\n` +
        `Prize rule: top half receives prizes from the bottom half. Rank #1 receives from last place, Rank #2 from second-to-last, and so on. Prize choice should not exceed **$15**.\n\n` +
        `Walk boldly, mortals. The goblin is watching.`
      );
    }

    pendingChallenge = null;
    return;
  }

  if (command === '!cancelchallenge') {
    if (!isAdmin(message)) {
      message.reply("The goblin clutches the parchment... This cancellation is not yours to command, mortal.");
      return;
    }

    pendingChallenge = null;
    message.reply("The goblin burns the mistaken prophecy.");
    return;
  }

  if (command === '!endchallenge') {
    if (!isAdmin(message)) {
      message.reply("The goblin snarls... Know your place.");
      return;
    }

    challenge.active = false;
    saveData();
    message.reply("The goblin declares... The trial has ended.");
    return;
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

    const steps = parseInt(args[1], 10);

    if (!steps || steps < 1) {
      message.reply("The goblin squints... Try again.");
      return;
    }

    const userId = message.author.id;
    const username = message.author.username;
    const mood = getTodayMood();

    if (!stepData[userId]) {
      stepData[userId] = { username, total: 0, entries: [] };
    }

    stepData[userId].username = username;
    stepData[userId].total += steps;
    stepData[userId].entries.push({ steps, date: today });

    saveData();

    if (steps < 1000) {
      message.reply(`${mood.lowSteps} The goblin records **${steps}** steps anyway.`);
    } else {
      message.reply(`${mood.stepPraise} Recorded: **${steps}** steps.`);
    }
    return;
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
    return;
  }

  if (command === '!leaderboard') {
    message.reply(`👹 **Leaderboard** 👹\n\n${formatOverallStandings()}`);
    return;
  }

  if (command === '!challenge') {
    if (!challenge.active) {
      message.reply("The goblin mutters... No trial is currently active.");
      return;
    }

    message.reply(`The current trial runs from **${formatDate(challenge.startDate)}** to **${formatDate(challenge.endDate)}**.`);
    return;
  }

  if (command === '!testdaily') {
    if (!isAdmin(message)) {
      message.reply("The goblin swats your hand away. Only my loyal servant may test the sacred morning judgment.");
      return;
    }

    await postDailyAnnouncement();
    message.reply("The goblin performs a test morning judgment.");
    return;
  }
});

client.login(process.env.TOKEN);
