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

function formatDate(date) {
  return new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: TIMEZONE
  });
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

  const yesterday = getYesterdayKey();
  const rankings = getDailyRankings(yesterday);

  if (rankings.length === 0) {
    await channel.send(
      `@everyone\n\n` +
      `The goblin awakens and checks yesterday's scroll...\n\n` +
      `No steps were submitted for **${formatDate(yesterday)}**.\n\n` +
      `The goblin is disappointed. Deeply. Dramatically.`
    );
  } else {
    const winner = rankings[0];

    let message =
      `@everyone\n\n` +
      `👹 **Morning Goblin Judgment**\n\n` +
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

    if (!stepData[userId]) {
      stepData[userId] = { username, total: 0, entries: [] };
    }

    stepData[userId].username = username;
    stepData[userId].total += steps;
    stepData[userId].entries.push({ steps, date });

    saveData();

    message.reply(
      steps < 1000
        ? `The goblin records ${steps}... tiny effort.`
        : `The goblin records ${steps}. Acceptable.`
    );
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

    message.reply(`The goblin erases ${last.steps} steps.`);
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
