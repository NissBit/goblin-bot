require('dotenv').config();
const fs = require('fs');
const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');

const GOBLIN_CHANNEL_ID = '1500025967588937831';
const DATA_FILE = './goblin-data.json';

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
  endDate: null
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
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

function todayKey() {
  return new Date().toISOString().split('T')[0];
}

client.once('ready', () => {
  loadData();
  console.log(`Goblin is awake as ${client.user.tag}`);
});

client.on('messageCreate', (message) => {
  if (message.author.bot) return;

  const args = message.content.trim().split(' ');
  const command = args[0].toLowerCase();

  // START CHALLENGE
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

    if (end < start) {
      message.reply("The goblin bonks the calendar... The end date cannot come before the start date, mortal.");
      return;
    }

    pendingChallenge = {
      startDate: args[1],
      endDate: args[2]
    };

    message.reply(
      `The goblin squints at the sacred calendar...\n\n` +
      `You are about to begin a trial from **${formatDate(start)}** to **${formatDate(end)}**.\n\n` +
      `Type \`!confirmchallenge\` to begin, or \`!cancelchallenge\` to cancel.`
    );
  }

  // CONFIRM CHALLENGE
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
    stepData = {};
    saveData();

    const channel = client.channels.cache.get(GOBLIN_CHANNEL_ID);

    if (channel) {
      channel.send(
        `@everyone\n\n` +
        `👹 **THE GOBLIN'S STEP TRIAL HAS BEEN DECLARED** 👹\n\n` +
        `A new trial shall run from **${formatDate(challenge.startDate)}** to **${formatDate(challenge.endDate)}**.\n\n` +
        `Each day, the top walker shall be crowned:\n` +
        `👹 **Holder of the Sacred Shoe** 👟\n\n` +
        `At the end, one will rise above all:\n` +
        `👑 **Trial Victor** 👑\n\n` +
        `Walk boldly, mortals. The goblin is watching.`
      );
    }

    pendingChallenge = null;
  }

  // CANCEL
  if (command === '!cancelchallenge') {
    if (!isAdmin(message)) {
      message.reply("The goblin clutches the parchment... This cancellation is not yours to command, mortal.");
      return;
    }

    pendingChallenge = null;
    message.reply("The goblin burns the mistaken prophecy.");
  }

  // END
  if (command === '!endchallenge') {
    if (!isAdmin(message)) {
      message.reply("The goblin snarls... Know your place.");
      return;
    }

    challenge.active = false;
    saveData();

    message.reply("The goblin declares... The trial has ended.");
  }

  // STEPS
  if (command === '!steps') {
    if (!challenge.active) {
      message.reply("The goblin scoffs... There is no active trial.");
      return;
    }

    const steps = parseInt(args[1]);
    if (!steps || steps < 1) {
      message.reply("The goblin squints... Try again.");
      return;
    }

    const userId = message.author.id;
    const username = message.author.username;
    const date = todayKey();

    if (!stepData[userId]) {
      stepData[userId] = { username, total: 0, entries: [] };
    }

    stepData[userId].total += steps;
    stepData[userId].entries.push({ steps, date });

    saveData();

    message.reply(
      steps < 1000
        ? `The goblin records ${steps}... tiny effort.`
        : `The goblin records ${steps}. Acceptable.`
    );
  }

  // UNDO
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

  // LEADERBOARD
  if (command === '!leaderboard') {
    const rankings = Object.values(stepData).sort((a, b) => b.total - a.total);

    if (rankings.length === 0) {
      message.reply("No steps yet.");
      return;
    }

    let msg = "👹 Leaderboard 👹\n\n";
    rankings.forEach((u, i) => {
      msg += `#${i + 1} ${u.username}: ${u.total}\n`;
    });

    message.reply(msg);
  }
});

client.login(process.env.TOKEN);
