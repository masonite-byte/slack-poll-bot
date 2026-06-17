const HELP_TEXT = [
  'Supported slash commands:',
  '/results   - show the current poll results.',
  '/newpoll   - pick and post a poll from a dropdown.',
  '/runoff    - start a runoff poll when tied.',
  '/delete    - permanently delete a custom poll (authors only).',
  '/create    - create a custom poll via a form.',
  '/polls     - list all available custom polls.',
  '/schedule  - show the weekly poll schedule.',
  '/vote      - how to vote.',
  '/about     - about this bot.',
  '/ping      - check that the bot is alive.',
  '/help      - show this help text.',
].join('\n');

const POLL_OPTIONS_TEXT = [
  ':soccer: Soccer',
  ':basketball: Basketball',
  ':flying_disc: Ultimate Frisbee',
  ':volleyball: Volleyball',
  ':athletic_shoe: Hackeysack',
  ':question: Other?????',
].join('\n');

const ABOUT_TEXT = [
  '🤖 *Poll-inator 3000*',
  '',
  'Built by Mason Womack to solve the most pressing problem in the modern workplace: what sport should we play this week?',
  '',
  'Capabilities:',
  "• Posts weekly polls so humans don't have to think",
  '• Counts emoji reactions with suspicious accuracy',
  '• Handles ties through democratic runoff elections',
  '• Supports custom polls created right from Slack',
  '• Runs on Cloudflare because servers cost money',
  '',
  'Powered by Go, Slack, and GitHub Actions.',
  '',
  '_This bot has strong opinions about Ultimate Frisbee._',
].join('\n');

// buildScheduleText fetches custom polls with schedules and builds the /schedule response.
async function buildScheduleText(env) {
  const lines = [
    '📅 *Poll Schedule*',
    '',
    '*Weekly Sports Poll*',
    '• *Monday 9:00 AM CT* — Weekly poll posted',
    '• *Tuesday 5:00 PM CT* — Results posted, voters notified, runoff if tied',
  ];

  let customLines = [];
  try {
    const slugs = await listPolls(env) || [];
    for (const slug of slugs) {
      const data = await getPollData(slug, env);
      if (!data?.schedule) continue;
      const label = data.name || slug;
      customLines.push(`• *${label}* — ${formatSchedule(data.schedule)}`);
    }
  } catch (e) {
    console.error('buildScheduleText: failed to fetch polls', e);
  }

  if (customLines.length) {
    lines.push('', '*Custom Polls*', ...customLines);
  }

  lines.push('', 'All times are Central Time. Polls run automatically — no human required.');
  return lines.join('\n');
}

// formatSchedule converts "monday 09:00" → "Monday 9:00 AM"
function formatSchedule(schedule) {
  const parts = schedule.trim().toLowerCase().split(/\s+/);
  if (parts.length < 2) return schedule;
  const day = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  const [hStr, mStr] = parts[1].split(':');
  const h = parseInt(hStr, 10);
  const m = mStr || '00';
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  const mDisplay = `:${m}`;
  return `${day} ${h12}${mDisplay} ${ampm} CT`;
}

// ── Signature verification ────────────────────────────────────────────────────

async function verifySlackSignature(request, body, signingSecret) {
  const timestamp = request.headers.get('X-Slack-Request-Timestamp');
  const slackSig = request.headers.get('X-Slack-Signature');
  if (!timestamp || !slackSig) return false;

  if (Math.abs(Date.now() / 1000 - parseInt(timestamp, 10)) > 300) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(signingSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const raw = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`v0:${timestamp}:${body}`),
  );
  const computed = 'v0=' + Array.from(new Uint8Array(raw))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return computed === slackSig;
}

// ── GitHub helpers ────────────────────────────────────────────────────────────

async function triggerWorkflow(workflowFile, env, inputs = {}) {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${workflowFile}/dispatches`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'slack-poll-bot',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ ref: 'main', inputs }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`GitHub API ${resp.status}: ${text}`);
  }
}

const NUMBER_EMOJIS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

const WINNER_MESSAGES = [
  "Congratulations... your sheep mentality paid off. *%s* won! 🐑",
  "Democracy has spoken and for once you were on the right side. *%s* won! 🎉",
  "Your vote actually counted for something. Shocking, we know. *%s* won! 🏆",
  "You backed the right horse this time. *%s* won! 🐴",
  "Even a broken clock is right twice a day. *%s* won! ⏰",
  "Popular opinion prevails, and so do you. *%s* won! 🥇",
  "The herd has spoken, and you were proudly part of it. *%s* won! 🎊",
  "You voted with the majority. Truly a courageous act of absolutely no independent thought. *%s* won! 🧠",
  "Incredible. You picked the most popular option. A bold, safe, utterly predictable move. *%s* won! 👏",
  "Science has yet to determine whether you predicted this or just got lucky. Either way, *%s* won! 🔬",
  "Your ancestors are weeping tears of joy. Or they would be, if they cared about this. *%s* won! 👴",
  "Against all odds — well, actually with all odds — *%s* won and so did you! 📊",
  "You voted for *%s* and it won. Please do not let this go to your head. We're begging you. 🙏",
  "The algorithm has determined you made the correct choice this week. Do not expect consistency. *%s* won! 🤖",
];

const LOSER_MESSAGES = [
  "James Maddison sympathizes with you... *%s* won. Your choice didn't make the cut. 💔",
  "The tyranny of the majority strikes again. *%s* won. Your vote was noted... and ignored. 🗳️",
  "Bold choice. Wrong choice. *%s* won. 😬",
  "Not everyone can be right. *%s* won. Better luck next week! 😔",
  "The people have spoken, and they said 'not that'. *%s* won. 😅",
  "Your participation trophy is in the mail. *%s* won. 🏅",
  "History is written by the winners, and you are not in it. *%s* won. 📜",
  "We have reviewed your vote. We have concerns. *%s* won. 🔎",
  "At least you voted. That's genuinely the nicest thing we can say right now. *%s* won. 🕊️",
  "A moment of silence for your pick, which has been decisively rejected by your peers. *%s* won. 🪦",
  "Your taste has been evaluated by a panel of your coworkers and found lacking. *%s* won. 🧑‍⚖️",
  "The ghost of your choice will haunt the break room. *%s* won. 👻",
  "In an alternate universe your pick won. Unfortunately you live in this one. *%s* won. 🌍",
  "Your vote has been carefully considered and ceremonially thrown in the bin. *%s* won. 🗑️",
];

const TIE_MESSAGES = [
  "It's a tie! Democracy has collapsed. A runoff poll is being posted — go finish what you started. 🗳️",
  "Incredible. You and your coworkers managed to be equally wrong. A runoff has been posted. 🤝",
  "The people are divided. A runoff poll is live — please do better this time. ⚔️",
  "Your collective indecision has triggered a runoff. Congratulations on nothing. Go vote again. 🙃",
  "A tie has been detected. Scientists are baffled. A runoff poll awaits you. 🔬",
  "The algorithm is upset. There is a tie. A runoff is being posted. Fix this. 🤖",
  "History will record this as the day your office couldn't make up its mind. Runoff poll is up. 📜",
];

// Auto-generated — do not edit by hand.
// Regenerate: cd scripts && npm install && node generate-emoji-map.mjs
// 1870 entries from gemoji 8.1.0
const UNICODE_TO_SLACK = {
  "#️⃣":"hash",
  "*️⃣":"asterisk",
  "0️⃣":"zero",
  "1️⃣":"one",
  "2️⃣":"two",
  "3️⃣":"three",
  "4️⃣":"four",
  "5️⃣":"five",
  "6️⃣":"six",
  "7️⃣":"seven",
  "8️⃣":"eight",
  "9️⃣":"nine",
  "©️":"copyright",
  "®️":"registered",
  "‼️":"bangbang",
  "⁉️":"interrobang",
  "™️":"tm",
  "ℹ️":"information_source",
  "↔️":"left_right_arrow",
  "↕️":"arrow_up_down",
  "↖️":"arrow_upper_left",
  "↗️":"arrow_upper_right",
  "↘️":"arrow_lower_right",
  "↙️":"arrow_lower_left",
  "↩️":"leftwards_arrow_with_hook",
  "↪️":"arrow_right_hook",
  "⌚":"watch",
  "⌛":"hourglass",
  "⌨️":"keyboard",
  "⏏️":"eject_button",
  "⏩":"fast_forward",
  "⏪":"rewind",
  "⏫":"arrow_double_up",
  "⏬":"arrow_double_down",
  "⏭️":"next_track_button",
  "⏮️":"previous_track_button",
  "⏯️":"play_or_pause_button",
  "⏰":"alarm_clock",
  "⏱️":"stopwatch",
  "⏲️":"timer_clock",
  "⏳":"hourglass_flowing_sand",
  "⏸️":"pause_button",
  "⏹️":"stop_button",
  "⏺️":"record_button",
  "Ⓜ️":"m",
  "▪️":"black_small_square",
  "▫️":"white_small_square",
  "▶️":"arrow_forward",
  "◀️":"arrow_backward",
  "◻️":"white_medium_square",
  "◼️":"black_medium_square",
  "◽":"white_medium_small_square",
  "◾":"black_medium_small_square",
  "☀️":"sunny",
  "☁️":"cloud",
  "☂️":"open_umbrella",
  "☃️":"snowman_with_snow",
  "☄️":"comet",
  "☎️":"phone",
  "☑️":"ballot_box_with_check",
  "☔":"umbrella",
  "☕":"coffee",
  "☘️":"shamrock",
  "☝️":"point_up",
  "☠️":"skull_and_crossbones",
  "☢️":"radioactive",
  "☣️":"biohazard",
  "☦️":"orthodox_cross",
  "☪️":"star_and_crescent",
  "☮️":"peace_symbol",
  "☯️":"yin_yang",
  "☸️":"wheel_of_dharma",
  "☹️":"frowning_face",
  "☺️":"relaxed",
  "♀️":"female_sign",
  "♂️":"male_sign",
  "♈":"aries",
  "♉":"taurus",
  "♊":"gemini",
  "♋":"cancer",
  "♌":"leo",
  "♍":"virgo",
  "♎":"libra",
  "♏":"scorpius",
  "♐":"sagittarius",
  "♑":"capricorn",
  "♒":"aquarius",
  "♓":"pisces",
  "♟️":"chess_pawn",
  "♠️":"spades",
  "♣️":"clubs",
  "♥️":"hearts",
  "♦️":"diamonds",
  "♨️":"hotsprings",
  "♻️":"recycle",
  "♾️":"infinity",
  "♿":"wheelchair",
  "⚒️":"hammer_and_pick",
  "⚓":"anchor",
  "⚔️":"crossed_swords",
  "⚕️":"medical_symbol",
  "⚖️":"balance_scale",
  "⚗️":"alembic",
  "⚙️":"gear",
  "⚛️":"atom_symbol",
  "⚜️":"fleur_de_lis",
  "⚠️":"warning",
  "⚡":"zap",
  "⚧️":"transgender_symbol",
  "⚪":"white_circle",
  "⚫":"black_circle",
  "⚰️":"coffin",
  "⚱️":"funeral_urn",
  "⚽":"soccer",
  "⚾":"baseball",
  "⛄":"snowman",
  "⛅":"partly_sunny",
  "⛈️":"cloud_with_lightning_and_rain",
  "⛎":"ophiuchus",
  "⛏️":"pick",
  "⛑️":"rescue_worker_helmet",
  "⛓️":"chains",
  "⛔":"no_entry",
  "⛩️":"shinto_shrine",
  "⛪":"church",
  "⛰️":"mountain",
  "⛱️":"parasol_on_ground",
  "⛲":"fountain",
  "⛳":"golf",
  "⛴️":"ferry",
  "⛵":"boat",
  "⛷️":"skier",
  "⛸️":"ice_skate",
  "⛹️":"bouncing_ball_person",
  "⛹️‍♀️":"bouncing_ball_woman",
  "⛹️‍♂️":"bouncing_ball_man",
  "⛺":"tent",
  "⛽":"fuelpump",
  "✂️":"scissors",
  "✅":"white_check_mark",
  "✈️":"airplane",
  "✉️":"envelope",
  "✊":"fist_raised",
  "✋":"hand",
  "✌️":"v",
  "✍️":"writing_hand",
  "✏️":"pencil2",
  "✒️":"black_nib",
  "✔️":"heavy_check_mark",
  "✖️":"heavy_multiplication_x",
  "✝️":"latin_cross",
  "✡️":"star_of_david",
  "✨":"sparkles",
  "✳️":"eight_spoked_asterisk",
  "✴️":"eight_pointed_black_star",
  "❄️":"snowflake",
  "❇️":"sparkle",
  "❌":"x",
  "❎":"negative_squared_cross_mark",
  "❓":"question",
  "❔":"grey_question",
  "❕":"grey_exclamation",
  "❗":"exclamation",
  "❣️":"heavy_heart_exclamation",
  "❤️":"heart",
  "❤️‍🔥":"heart_on_fire",
  "❤️‍🩹":"mending_heart",
  "➕":"heavy_plus_sign",
  "➖":"heavy_minus_sign",
  "➗":"heavy_division_sign",
  "➡️":"arrow_right",
  "➰":"curly_loop",
  "➿":"loop",
  "⤴️":"arrow_heading_up",
  "⤵️":"arrow_heading_down",
  "⬅️":"arrow_left",
  "⬆️":"arrow_up",
  "⬇️":"arrow_down",
  "⬛":"black_large_square",
  "⬜":"white_large_square",
  "⭐":"star",
  "⭕":"o",
  "〰️":"wavy_dash",
  "〽️":"part_alternation_mark",
  "㊗️":"congratulations",
  "㊙️":"secret",
  "🀄":"mahjong",
  "🃏":"black_joker",
  "🅰️":"a",
  "🅱️":"b",
  "🅾️":"o2",
  "🅿️":"parking",
  "🆎":"ab",
  "🆑":"cl",
  "🆒":"cool",
  "🆓":"free",
  "🆔":"id",
  "🆕":"new",
  "🆖":"ng",
  "🆗":"ok",
  "🆘":"sos",
  "🆙":"up",
  "🆚":"vs",
  "🇦🇨":"ascension_island",
  "🇦🇩":"andorra",
  "🇦🇪":"united_arab_emirates",
  "🇦🇫":"afghanistan",
  "🇦🇬":"antigua_barbuda",
  "🇦🇮":"anguilla",
  "🇦🇱":"albania",
  "🇦🇲":"armenia",
  "🇦🇴":"angola",
  "🇦🇶":"antarctica",
  "🇦🇷":"argentina",
  "🇦🇸":"american_samoa",
  "🇦🇹":"austria",
  "🇦🇺":"australia",
  "🇦🇼":"aruba",
  "🇦🇽":"aland_islands",
  "🇦🇿":"azerbaijan",
  "🇧🇦":"bosnia_herzegovina",
  "🇧🇧":"barbados",
  "🇧🇩":"bangladesh",
  "🇧🇪":"belgium",
  "🇧🇫":"burkina_faso",
  "🇧🇬":"bulgaria",
  "🇧🇭":"bahrain",
  "🇧🇮":"burundi",
  "🇧🇯":"benin",
  "🇧🇱":"st_barthelemy",
  "🇧🇲":"bermuda",
  "🇧🇳":"brunei",
  "🇧🇴":"bolivia",
  "🇧🇶":"caribbean_netherlands",
  "🇧🇷":"brazil",
  "🇧🇸":"bahamas",
  "🇧🇹":"bhutan",
  "🇧🇻":"bouvet_island",
  "🇧🇼":"botswana",
  "🇧🇾":"belarus",
  "🇧🇿":"belize",
  "🇨🇦":"canada",
  "🇨🇨":"cocos_islands",
  "🇨🇩":"congo_kinshasa",
  "🇨🇫":"central_african_republic",
  "🇨🇬":"congo_brazzaville",
  "🇨🇭":"switzerland",
  "🇨🇮":"cote_divoire",
  "🇨🇰":"cook_islands",
  "🇨🇱":"chile",
  "🇨🇲":"cameroon",
  "🇨🇳":"cn",
  "🇨🇴":"colombia",
  "🇨🇵":"clipperton_island",
  "🇨🇷":"costa_rica",
  "🇨🇺":"cuba",
  "🇨🇻":"cape_verde",
  "🇨🇼":"curacao",
  "🇨🇽":"christmas_island",
  "🇨🇾":"cyprus",
  "🇨🇿":"czech_republic",
  "🇩🇪":"de",
  "🇩🇬":"diego_garcia",
  "🇩🇯":"djibouti",
  "🇩🇰":"denmark",
  "🇩🇲":"dominica",
  "🇩🇴":"dominican_republic",
  "🇩🇿":"algeria",
  "🇪🇦":"ceuta_melilla",
  "🇪🇨":"ecuador",
  "🇪🇪":"estonia",
  "🇪🇬":"egypt",
  "🇪🇭":"western_sahara",
  "🇪🇷":"eritrea",
  "🇪🇸":"es",
  "🇪🇹":"ethiopia",
  "🇪🇺":"eu",
  "🇫🇮":"finland",
  "🇫🇯":"fiji",
  "🇫🇰":"falkland_islands",
  "🇫🇲":"micronesia",
  "🇫🇴":"faroe_islands",
  "🇫🇷":"fr",
  "🇬🇦":"gabon",
  "🇬🇧":"gb",
  "🇬🇩":"grenada",
  "🇬🇪":"georgia",
  "🇬🇫":"french_guiana",
  "🇬🇬":"guernsey",
  "🇬🇭":"ghana",
  "🇬🇮":"gibraltar",
  "🇬🇱":"greenland",
  "🇬🇲":"gambia",
  "🇬🇳":"guinea",
  "🇬🇵":"guadeloupe",
  "🇬🇶":"equatorial_guinea",
  "🇬🇷":"greece",
  "🇬🇸":"south_georgia_south_sandwich_islands",
  "🇬🇹":"guatemala",
  "🇬🇺":"guam",
  "🇬🇼":"guinea_bissau",
  "🇬🇾":"guyana",
  "🇭🇰":"hong_kong",
  "🇭🇲":"heard_mcdonald_islands",
  "🇭🇳":"honduras",
  "🇭🇷":"croatia",
  "🇭🇹":"haiti",
  "🇭🇺":"hungary",
  "🇮🇨":"canary_islands",
  "🇮🇩":"indonesia",
  "🇮🇪":"ireland",
  "🇮🇱":"israel",
  "🇮🇲":"isle_of_man",
  "🇮🇳":"india",
  "🇮🇴":"british_indian_ocean_territory",
  "🇮🇶":"iraq",
  "🇮🇷":"iran",
  "🇮🇸":"iceland",
  "🇮🇹":"it",
  "🇯🇪":"jersey",
  "🇯🇲":"jamaica",
  "🇯🇴":"jordan",
  "🇯🇵":"jp",
  "🇰🇪":"kenya",
  "🇰🇬":"kyrgyzstan",
  "🇰🇭":"cambodia",
  "🇰🇮":"kiribati",
  "🇰🇲":"comoros",
  "🇰🇳":"st_kitts_nevis",
  "🇰🇵":"north_korea",
  "🇰🇷":"kr",
  "🇰🇼":"kuwait",
  "🇰🇾":"cayman_islands",
  "🇰🇿":"kazakhstan",
  "🇱🇦":"laos",
  "🇱🇧":"lebanon",
  "🇱🇨":"st_lucia",
  "🇱🇮":"liechtenstein",
  "🇱🇰":"sri_lanka",
  "🇱🇷":"liberia",
  "🇱🇸":"lesotho",
  "🇱🇹":"lithuania",
  "🇱🇺":"luxembourg",
  "🇱🇻":"latvia",
  "🇱🇾":"libya",
  "🇲🇦":"morocco",
  "🇲🇨":"monaco",
  "🇲🇩":"moldova",
  "🇲🇪":"montenegro",
  "🇲🇫":"st_martin",
  "🇲🇬":"madagascar",
  "🇲🇭":"marshall_islands",
  "🇲🇰":"macedonia",
  "🇲🇱":"mali",
  "🇲🇲":"myanmar",
  "🇲🇳":"mongolia",
  "🇲🇴":"macau",
  "🇲🇵":"northern_mariana_islands",
  "🇲🇶":"martinique",
  "🇲🇷":"mauritania",
  "🇲🇸":"montserrat",
  "🇲🇹":"malta",
  "🇲🇺":"mauritius",
  "🇲🇻":"maldives",
  "🇲🇼":"malawi",
  "🇲🇽":"mexico",
  "🇲🇾":"malaysia",
  "🇲🇿":"mozambique",
  "🇳🇦":"namibia",
  "🇳🇨":"new_caledonia",
  "🇳🇪":"niger",
  "🇳🇫":"norfolk_island",
  "🇳🇬":"nigeria",
  "🇳🇮":"nicaragua",
  "🇳🇱":"netherlands",
  "🇳🇴":"norway",
  "🇳🇵":"nepal",
  "🇳🇷":"nauru",
  "🇳🇺":"niue",
  "🇳🇿":"new_zealand",
  "🇴🇲":"oman",
  "🇵🇦":"panama",
  "🇵🇪":"peru",
  "🇵🇫":"french_polynesia",
  "🇵🇬":"papua_new_guinea",
  "🇵🇭":"philippines",
  "🇵🇰":"pakistan",
  "🇵🇱":"poland",
  "🇵🇲":"st_pierre_miquelon",
  "🇵🇳":"pitcairn_islands",
  "🇵🇷":"puerto_rico",
  "🇵🇸":"palestinian_territories",
  "🇵🇹":"portugal",
  "🇵🇼":"palau",
  "🇵🇾":"paraguay",
  "🇶🇦":"qatar",
  "🇷🇪":"reunion",
  "🇷🇴":"romania",
  "🇷🇸":"serbia",
  "🇷🇺":"ru",
  "🇷🇼":"rwanda",
  "🇸🇦":"saudi_arabia",
  "🇸🇧":"solomon_islands",
  "🇸🇨":"seychelles",
  "🇸🇩":"sudan",
  "🇸🇪":"sweden",
  "🇸🇬":"singapore",
  "🇸🇭":"st_helena",
  "🇸🇮":"slovenia",
  "🇸🇯":"svalbard_jan_mayen",
  "🇸🇰":"slovakia",
  "🇸🇱":"sierra_leone",
  "🇸🇲":"san_marino",
  "🇸🇳":"senegal",
  "🇸🇴":"somalia",
  "🇸🇷":"suriname",
  "🇸🇸":"south_sudan",
  "🇸🇹":"sao_tome_principe",
  "🇸🇻":"el_salvador",
  "🇸🇽":"sint_maarten",
  "🇸🇾":"syria",
  "🇸🇿":"swaziland",
  "🇹🇦":"tristan_da_cunha",
  "🇹🇨":"turks_caicos_islands",
  "🇹🇩":"chad",
  "🇹🇫":"french_southern_territories",
  "🇹🇬":"togo",
  "🇹🇭":"thailand",
  "🇹🇯":"tajikistan",
  "🇹🇰":"tokelau",
  "🇹🇱":"timor_leste",
  "🇹🇲":"turkmenistan",
  "🇹🇳":"tunisia",
  "🇹🇴":"tonga",
  "🇹🇷":"tr",
  "🇹🇹":"trinidad_tobago",
  "🇹🇻":"tuvalu",
  "🇹🇼":"taiwan",
  "🇹🇿":"tanzania",
  "🇺🇦":"ukraine",
  "🇺🇬":"uganda",
  "🇺🇲":"us_outlying_islands",
  "🇺🇳":"united_nations",
  "🇺🇸":"us",
  "🇺🇾":"uruguay",
  "🇺🇿":"uzbekistan",
  "🇻🇦":"vatican_city",
  "🇻🇨":"st_vincent_grenadines",
  "🇻🇪":"venezuela",
  "🇻🇬":"british_virgin_islands",
  "🇻🇮":"us_virgin_islands",
  "🇻🇳":"vietnam",
  "🇻🇺":"vanuatu",
  "🇼🇫":"wallis_futuna",
  "🇼🇸":"samoa",
  "🇽🇰":"kosovo",
  "🇾🇪":"yemen",
  "🇾🇹":"mayotte",
  "🇿🇦":"south_africa",
  "🇿🇲":"zambia",
  "🇿🇼":"zimbabwe",
  "🈁":"koko",
  "🈂️":"sa",
  "🈚":"u7121",
  "🈯":"u6307",
  "🈲":"u7981",
  "🈳":"u7a7a",
  "🈴":"u5408",
  "🈵":"u6e80",
  "🈶":"u6709",
  "🈷️":"u6708",
  "🈸":"u7533",
  "🈹":"u5272",
  "🈺":"u55b6",
  "🉐":"ideograph_advantage",
  "🉑":"accept",
  "🌀":"cyclone",
  "🌁":"foggy",
  "🌂":"closed_umbrella",
  "🌃":"night_with_stars",
  "🌄":"sunrise_over_mountains",
  "🌅":"sunrise",
  "🌆":"city_sunset",
  "🌇":"city_sunrise",
  "🌈":"rainbow",
  "🌉":"bridge_at_night",
  "🌊":"ocean",
  "🌋":"volcano",
  "🌌":"milky_way",
  "🌍":"earth_africa",
  "🌎":"earth_americas",
  "🌏":"earth_asia",
  "🌐":"globe_with_meridians",
  "🌑":"new_moon",
  "🌒":"waxing_crescent_moon",
  "🌓":"first_quarter_moon",
  "🌔":"moon",
  "🌕":"full_moon",
  "🌖":"waning_gibbous_moon",
  "🌗":"last_quarter_moon",
  "🌘":"waning_crescent_moon",
  "🌙":"crescent_moon",
  "🌚":"new_moon_with_face",
  "🌛":"first_quarter_moon_with_face",
  "🌜":"last_quarter_moon_with_face",
  "🌝":"full_moon_with_face",
  "🌞":"sun_with_face",
  "🌟":"star2",
  "🌠":"stars",
  "🌡️":"thermometer",
  "🌤️":"sun_behind_small_cloud",
  "🌥️":"sun_behind_large_cloud",
  "🌦️":"sun_behind_rain_cloud",
  "🌧️":"cloud_with_rain",
  "🌨️":"cloud_with_snow",
  "🌩️":"cloud_with_lightning",
  "🌪️":"tornado",
  "🌫️":"fog",
  "🌬️":"wind_face",
  "🌭":"hotdog",
  "🌮":"taco",
  "🌯":"burrito",
  "🌰":"chestnut",
  "🌱":"seedling",
  "🌲":"evergreen_tree",
  "🌳":"deciduous_tree",
  "🌴":"palm_tree",
  "🌵":"cactus",
  "🌶️":"hot_pepper",
  "🌷":"tulip",
  "🌸":"cherry_blossom",
  "🌹":"rose",
  "🌺":"hibiscus",
  "🌻":"sunflower",
  "🌼":"blossom",
  "🌽":"corn",
  "🌾":"ear_of_rice",
  "🌿":"herb",
  "🍀":"four_leaf_clover",
  "🍁":"maple_leaf",
  "🍂":"fallen_leaf",
  "🍃":"leaves",
  "🍄":"mushroom",
  "🍅":"tomato",
  "🍆":"eggplant",
  "🍇":"grapes",
  "🍈":"melon",
  "🍉":"watermelon",
  "🍊":"tangerine",
  "🍋":"lemon",
  "🍌":"banana",
  "🍍":"pineapple",
  "🍎":"apple",
  "🍏":"green_apple",
  "🍐":"pear",
  "🍑":"peach",
  "🍒":"cherries",
  "🍓":"strawberry",
  "🍔":"hamburger",
  "🍕":"pizza",
  "🍖":"meat_on_bone",
  "🍗":"poultry_leg",
  "🍘":"rice_cracker",
  "🍙":"rice_ball",
  "🍚":"rice",
  "🍛":"curry",
  "🍜":"ramen",
  "🍝":"spaghetti",
  "🍞":"bread",
  "🍟":"fries",
  "🍠":"sweet_potato",
  "🍡":"dango",
  "🍢":"oden",
  "🍣":"sushi",
  "🍤":"fried_shrimp",
  "🍥":"fish_cake",
  "🍦":"icecream",
  "🍧":"shaved_ice",
  "🍨":"ice_cream",
  "🍩":"doughnut",
  "🍪":"cookie",
  "🍫":"chocolate_bar",
  "🍬":"candy",
  "🍭":"lollipop",
  "🍮":"custard",
  "🍯":"honey_pot",
  "🍰":"cake",
  "🍱":"bento",
  "🍲":"stew",
  "🍳":"fried_egg",
  "🍴":"fork_and_knife",
  "🍵":"tea",
  "🍶":"sake",
  "🍷":"wine_glass",
  "🍸":"cocktail",
  "🍹":"tropical_drink",
  "🍺":"beer",
  "🍻":"beers",
  "🍼":"baby_bottle",
  "🍽️":"plate_with_cutlery",
  "🍾":"champagne",
  "🍿":"popcorn",
  "🎀":"ribbon",
  "🎁":"gift",
  "🎂":"birthday",
  "🎃":"jack_o_lantern",
  "🎄":"christmas_tree",
  "🎅":"santa",
  "🎆":"fireworks",
  "🎇":"sparkler",
  "🎈":"balloon",
  "🎉":"tada",
  "🎊":"confetti_ball",
  "🎋":"tanabata_tree",
  "🎌":"crossed_flags",
  "🎍":"bamboo",
  "🎎":"dolls",
  "🎏":"flags",
  "🎐":"wind_chime",
  "🎑":"rice_scene",
  "🎒":"school_satchel",
  "🎓":"mortar_board",
  "🎖️":"medal_military",
  "🎗️":"reminder_ribbon",
  "🎙️":"studio_microphone",
  "🎚️":"level_slider",
  "🎛️":"control_knobs",
  "🎞️":"film_strip",
  "🎟️":"tickets",
  "🎠":"carousel_horse",
  "🎡":"ferris_wheel",
  "🎢":"roller_coaster",
  "🎣":"fishing_pole_and_fish",
  "🎤":"microphone",
  "🎥":"movie_camera",
  "🎦":"cinema",
  "🎧":"headphones",
  "🎨":"art",
  "🎩":"tophat",
  "🎪":"circus_tent",
  "🎫":"ticket",
  "🎬":"clapper",
  "🎭":"performing_arts",
  "🎮":"video_game",
  "🎯":"dart",
  "🎰":"slot_machine",
  "🎱":"8ball",
  "🎲":"game_die",
  "🎳":"bowling",
  "🎴":"flower_playing_cards",
  "🎵":"musical_note",
  "🎶":"notes",
  "🎷":"saxophone",
  "🎸":"guitar",
  "🎹":"musical_keyboard",
  "🎺":"trumpet",
  "🎻":"violin",
  "🎼":"musical_score",
  "🎽":"running_shirt_with_sash",
  "🎾":"tennis",
  "🎿":"ski",
  "🏀":"basketball",
  "🏁":"checkered_flag",
  "🏂":"snowboarder",
  "🏃":"runner",
  "🏃‍♀️":"running_woman",
  "🏃‍♂️":"running_man",
  "🏄":"surfer",
  "🏄‍♀️":"surfing_woman",
  "🏄‍♂️":"surfing_man",
  "🏅":"medal_sports",
  "🏆":"trophy",
  "🏇":"horse_racing",
  "🏈":"football",
  "🏉":"rugby_football",
  "🏊":"swimmer",
  "🏊‍♀️":"swimming_woman",
  "🏊‍♂️":"swimming_man",
  "🏋️":"weight_lifting",
  "🏋️‍♀️":"weight_lifting_woman",
  "🏋️‍♂️":"weight_lifting_man",
  "🏌️":"golfing",
  "🏌️‍♀️":"golfing_woman",
  "🏌️‍♂️":"golfing_man",
  "🏍️":"motorcycle",
  "🏎️":"racing_car",
  "🏏":"cricket_game",
  "🏐":"volleyball",
  "🏑":"field_hockey",
  "🏒":"ice_hockey",
  "🏓":"ping_pong",
  "🏔️":"mountain_snow",
  "🏕️":"camping",
  "🏖️":"beach_umbrella",
  "🏗️":"building_construction",
  "🏘️":"houses",
  "🏙️":"cityscape",
  "🏚️":"derelict_house",
  "🏛️":"classical_building",
  "🏜️":"desert",
  "🏝️":"desert_island",
  "🏞️":"national_park",
  "🏟️":"stadium",
  "🏠":"house",
  "🏡":"house_with_garden",
  "🏢":"office",
  "🏣":"post_office",
  "🏤":"european_post_office",
  "🏥":"hospital",
  "🏦":"bank",
  "🏧":"atm",
  "🏨":"hotel",
  "🏩":"love_hotel",
  "🏪":"convenience_store",
  "🏫":"school",
  "🏬":"department_store",
  "🏭":"factory",
  "🏮":"izakaya_lantern",
  "🏯":"japanese_castle",
  "🏰":"european_castle",
  "🏳️":"white_flag",
  "🏳️‍⚧️":"transgender_flag",
  "🏳️‍🌈":"rainbow_flag",
  "🏴":"black_flag",
  "🏴‍☠️":"pirate_flag",
  "🏴󠁧󠁢󠁥󠁮󠁧󠁿":"england",
  "🏴󠁧󠁢󠁳󠁣󠁴󠁿":"scotland",
  "🏴󠁧󠁢󠁷󠁬󠁳󠁿":"wales",
  "🏵️":"rosette",
  "🏷️":"label",
  "🏸":"badminton",
  "🏹":"bow_and_arrow",
  "🏺":"amphora",
  "🐀":"rat",
  "🐁":"mouse2",
  "🐂":"ox",
  "🐃":"water_buffalo",
  "🐄":"cow2",
  "🐅":"tiger2",
  "🐆":"leopard",
  "🐇":"rabbit2",
  "🐈":"cat2",
  "🐈‍⬛":"black_cat",
  "🐉":"dragon",
  "🐊":"crocodile",
  "🐋":"whale2",
  "🐌":"snail",
  "🐍":"snake",
  "🐎":"racehorse",
  "🐏":"ram",
  "🐐":"goat",
  "🐑":"sheep",
  "🐒":"monkey",
  "🐓":"rooster",
  "🐔":"chicken",
  "🐕":"dog2",
  "🐕‍🦺":"service_dog",
  "🐖":"pig2",
  "🐗":"boar",
  "🐘":"elephant",
  "🐙":"octopus",
  "🐚":"shell",
  "🐛":"bug",
  "🐜":"ant",
  "🐝":"bee",
  "🐞":"lady_beetle",
  "🐟":"fish",
  "🐠":"tropical_fish",
  "🐡":"blowfish",
  "🐢":"turtle",
  "🐣":"hatching_chick",
  "🐤":"baby_chick",
  "🐥":"hatched_chick",
  "🐦":"bird",
  "🐦‍⬛":"black_bird",
  "🐧":"penguin",
  "🐨":"koala",
  "🐩":"poodle",
  "🐪":"dromedary_camel",
  "🐫":"camel",
  "🐬":"dolphin",
  "🐭":"mouse",
  "🐮":"cow",
  "🐯":"tiger",
  "🐰":"rabbit",
  "🐱":"cat",
  "🐲":"dragon_face",
  "🐳":"whale",
  "🐴":"horse",
  "🐵":"monkey_face",
  "🐶":"dog",
  "🐷":"pig",
  "🐸":"frog",
  "🐹":"hamster",
  "🐺":"wolf",
  "🐻":"bear",
  "🐻‍❄️":"polar_bear",
  "🐼":"panda_face",
  "🐽":"pig_nose",
  "🐾":"feet",
  "🐿️":"chipmunk",
  "👀":"eyes",
  "👁️":"eye",
  "👁️‍🗨️":"eye_speech_bubble",
  "👂":"ear",
  "👃":"nose",
  "👄":"lips",
  "👅":"tongue",
  "👆":"point_up_2",
  "👇":"point_down",
  "👈":"point_left",
  "👉":"point_right",
  "👊":"fist_oncoming",
  "👋":"wave",
  "👌":"ok_hand",
  "👍":"+1",
  "👎":"-1",
  "👏":"clap",
  "👐":"open_hands",
  "👑":"crown",
  "👒":"womans_hat",
  "👓":"eyeglasses",
  "👔":"necktie",
  "👕":"shirt",
  "👖":"jeans",
  "👗":"dress",
  "👘":"kimono",
  "👙":"bikini",
  "👚":"womans_clothes",
  "👛":"purse",
  "👜":"handbag",
  "👝":"pouch",
  "👞":"mans_shoe",
  "👟":"athletic_shoe",
  "👠":"high_heel",
  "👡":"sandal",
  "👢":"boot",
  "👣":"footprints",
  "👤":"bust_in_silhouette",
  "👥":"busts_in_silhouette",
  "👦":"boy",
  "👧":"girl",
  "👨":"man",
  "👨‍⚕️":"man_health_worker",
  "👨‍⚖️":"man_judge",
  "👨‍✈️":"man_pilot",
  "👨‍❤️‍👨":"couple_with_heart_man_man",
  "👨‍❤️‍💋‍👨":"couplekiss_man_man",
  "👨‍🌾":"man_farmer",
  "👨‍🍳":"man_cook",
  "👨‍🍼":"man_feeding_baby",
  "👨‍🎓":"man_student",
  "👨‍🎤":"man_singer",
  "👨‍🎨":"man_artist",
  "👨‍🏫":"man_teacher",
  "👨‍🏭":"man_factory_worker",
  "👨‍👦":"family_man_boy",
  "👨‍👦‍👦":"family_man_boy_boy",
  "👨‍👧":"family_man_girl",
  "👨‍👧‍👦":"family_man_girl_boy",
  "👨‍👧‍👧":"family_man_girl_girl",
  "👨‍👨‍👦":"family_man_man_boy",
  "👨‍👨‍👦‍👦":"family_man_man_boy_boy",
  "👨‍👨‍👧":"family_man_man_girl",
  "👨‍👨‍👧‍👦":"family_man_man_girl_boy",
  "👨‍👨‍👧‍👧":"family_man_man_girl_girl",
  "👨‍👩‍👦":"family_man_woman_boy",
  "👨‍👩‍👦‍👦":"family_man_woman_boy_boy",
  "👨‍👩‍👧":"family_man_woman_girl",
  "👨‍👩‍👧‍👦":"family_man_woman_girl_boy",
  "👨‍👩‍👧‍👧":"family_man_woman_girl_girl",
  "👨‍💻":"man_technologist",
  "👨‍💼":"man_office_worker",
  "👨‍🔧":"man_mechanic",
  "👨‍🔬":"man_scientist",
  "👨‍🚀":"man_astronaut",
  "👨‍🚒":"man_firefighter",
  "👨‍🦯":"man_with_probing_cane",
  "👨‍🦰":"red_haired_man",
  "👨‍🦱":"curly_haired_man",
  "👨‍🦲":"bald_man",
  "👨‍🦳":"white_haired_man",
  "👨‍🦼":"man_in_motorized_wheelchair",
  "👨‍🦽":"man_in_manual_wheelchair",
  "👩":"woman",
  "👩‍⚕️":"woman_health_worker",
  "👩‍⚖️":"woman_judge",
  "👩‍✈️":"woman_pilot",
  "👩‍❤️‍👨":"couple_with_heart_woman_man",
  "👩‍❤️‍👩":"couple_with_heart_woman_woman",
  "👩‍❤️‍💋‍👨":"couplekiss_man_woman",
  "👩‍❤️‍💋‍👩":"couplekiss_woman_woman",
  "👩‍🌾":"woman_farmer",
  "👩‍🍳":"woman_cook",
  "👩‍🍼":"woman_feeding_baby",
  "👩‍🎓":"woman_student",
  "👩‍🎤":"woman_singer",
  "👩‍🎨":"woman_artist",
  "👩‍🏫":"woman_teacher",
  "👩‍🏭":"woman_factory_worker",
  "👩‍👦":"family_woman_boy",
  "👩‍👦‍👦":"family_woman_boy_boy",
  "👩‍👧":"family_woman_girl",
  "👩‍👧‍👦":"family_woman_girl_boy",
  "👩‍👧‍👧":"family_woman_girl_girl",
  "👩‍👩‍👦":"family_woman_woman_boy",
  "👩‍👩‍👦‍👦":"family_woman_woman_boy_boy",
  "👩‍👩‍👧":"family_woman_woman_girl",
  "👩‍👩‍👧‍👦":"family_woman_woman_girl_boy",
  "👩‍👩‍👧‍👧":"family_woman_woman_girl_girl",
  "👩‍💻":"woman_technologist",
  "👩‍💼":"woman_office_worker",
  "👩‍🔧":"woman_mechanic",
  "👩‍🔬":"woman_scientist",
  "👩‍🚀":"woman_astronaut",
  "👩‍🚒":"woman_firefighter",
  "👩‍🦯":"woman_with_probing_cane",
  "👩‍🦰":"red_haired_woman",
  "👩‍🦱":"curly_haired_woman",
  "👩‍🦲":"bald_woman",
  "👩‍🦳":"white_haired_woman",
  "👩‍🦼":"woman_in_motorized_wheelchair",
  "👩‍🦽":"woman_in_manual_wheelchair",
  "👪":"family",
  "👫":"couple",
  "👬":"two_men_holding_hands",
  "👭":"two_women_holding_hands",
  "👮":"police_officer",
  "👮‍♀️":"policewoman",
  "👮‍♂️":"policeman",
  "👯":"dancers",
  "👯‍♀️":"dancing_women",
  "👯‍♂️":"dancing_men",
  "👰":"person_with_veil",
  "👰‍♀️":"woman_with_veil",
  "👰‍♂️":"man_with_veil",
  "👱":"blond_haired_person",
  "👱‍♀️":"blond_haired_woman",
  "👱‍♂️":"blond_haired_man",
  "👲":"man_with_gua_pi_mao",
  "👳":"person_with_turban",
  "👳‍♀️":"woman_with_turban",
  "👳‍♂️":"man_with_turban",
  "👴":"older_man",
  "👵":"older_woman",
  "👶":"baby",
  "👷":"construction_worker",
  "👷‍♀️":"construction_worker_woman",
  "👷‍♂️":"construction_worker_man",
  "👸":"princess",
  "👹":"japanese_ogre",
  "👺":"japanese_goblin",
  "👻":"ghost",
  "👼":"angel",
  "👽":"alien",
  "👾":"space_invader",
  "👿":"imp",
  "💀":"skull",
  "💁":"tipping_hand_person",
  "💁‍♀️":"tipping_hand_woman",
  "💁‍♂️":"tipping_hand_man",
  "💂":"guard",
  "💂‍♀️":"guardswoman",
  "💂‍♂️":"guardsman",
  "💃":"woman_dancing",
  "💄":"lipstick",
  "💅":"nail_care",
  "💆":"massage",
  "💆‍♀️":"massage_woman",
  "💆‍♂️":"massage_man",
  "💇":"haircut",
  "💇‍♀️":"haircut_woman",
  "💇‍♂️":"haircut_man",
  "💈":"barber",
  "💉":"syringe",
  "💊":"pill",
  "💋":"kiss",
  "💌":"love_letter",
  "💍":"ring",
  "💎":"gem",
  "💏":"couplekiss",
  "💐":"bouquet",
  "💑":"couple_with_heart",
  "💒":"wedding",
  "💓":"heartbeat",
  "💔":"broken_heart",
  "💕":"two_hearts",
  "💖":"sparkling_heart",
  "💗":"heartpulse",
  "💘":"cupid",
  "💙":"blue_heart",
  "💚":"green_heart",
  "💛":"yellow_heart",
  "💜":"purple_heart",
  "💝":"gift_heart",
  "💞":"revolving_hearts",
  "💟":"heart_decoration",
  "💠":"diamond_shape_with_a_dot_inside",
  "💡":"bulb",
  "💢":"anger",
  "💣":"bomb",
  "💤":"zzz",
  "💥":"boom",
  "💦":"sweat_drops",
  "💧":"droplet",
  "💨":"dash",
  "💩":"hankey",
  "💪":"muscle",
  "💫":"dizzy",
  "💬":"speech_balloon",
  "💭":"thought_balloon",
  "💮":"white_flower",
  "💯":"100",
  "💰":"moneybag",
  "💱":"currency_exchange",
  "💲":"heavy_dollar_sign",
  "💳":"credit_card",
  "💴":"yen",
  "💵":"dollar",
  "💶":"euro",
  "💷":"pound",
  "💸":"money_with_wings",
  "💹":"chart",
  "💺":"seat",
  "💻":"computer",
  "💼":"briefcase",
  "💽":"minidisc",
  "💾":"floppy_disk",
  "💿":"cd",
  "📀":"dvd",
  "📁":"file_folder",
  "📂":"open_file_folder",
  "📃":"page_with_curl",
  "📄":"page_facing_up",
  "📅":"date",
  "📆":"calendar",
  "📇":"card_index",
  "📈":"chart_with_upwards_trend",
  "📉":"chart_with_downwards_trend",
  "📊":"bar_chart",
  "📋":"clipboard",
  "📌":"pushpin",
  "📍":"round_pushpin",
  "📎":"paperclip",
  "📏":"straight_ruler",
  "📐":"triangular_ruler",
  "📑":"bookmark_tabs",
  "📒":"ledger",
  "📓":"notebook",
  "📔":"notebook_with_decorative_cover",
  "📕":"closed_book",
  "📖":"book",
  "📗":"green_book",
  "📘":"blue_book",
  "📙":"orange_book",
  "📚":"books",
  "📛":"name_badge",
  "📜":"scroll",
  "📝":"memo",
  "📞":"telephone_receiver",
  "📟":"pager",
  "📠":"fax",
  "📡":"satellite",
  "📢":"loudspeaker",
  "📣":"mega",
  "📤":"outbox_tray",
  "📥":"inbox_tray",
  "📦":"package",
  "📧":"email",
  "📨":"incoming_envelope",
  "📩":"envelope_with_arrow",
  "📪":"mailbox_closed",
  "📫":"mailbox",
  "📬":"mailbox_with_mail",
  "📭":"mailbox_with_no_mail",
  "📮":"postbox",
  "📯":"postal_horn",
  "📰":"newspaper",
  "📱":"iphone",
  "📲":"calling",
  "📳":"vibration_mode",
  "📴":"mobile_phone_off",
  "📵":"no_mobile_phones",
  "📶":"signal_strength",
  "📷":"camera",
  "📸":"camera_flash",
  "📹":"video_camera",
  "📺":"tv",
  "📻":"radio",
  "📼":"vhs",
  "📽️":"film_projector",
  "📿":"prayer_beads",
  "🔀":"twisted_rightwards_arrows",
  "🔁":"repeat",
  "🔂":"repeat_one",
  "🔃":"arrows_clockwise",
  "🔄":"arrows_counterclockwise",
  "🔅":"low_brightness",
  "🔆":"high_brightness",
  "🔇":"mute",
  "🔈":"speaker",
  "🔉":"sound",
  "🔊":"loud_sound",
  "🔋":"battery",
  "🔌":"electric_plug",
  "🔍":"mag",
  "🔎":"mag_right",
  "🔏":"lock_with_ink_pen",
  "🔐":"closed_lock_with_key",
  "🔑":"key",
  "🔒":"lock",
  "🔓":"unlock",
  "🔔":"bell",
  "🔕":"no_bell",
  "🔖":"bookmark",
  "🔗":"link",
  "🔘":"radio_button",
  "🔙":"back",
  "🔚":"end",
  "🔛":"on",
  "🔜":"soon",
  "🔝":"top",
  "🔞":"underage",
  "🔟":"keycap_ten",
  "🔠":"capital_abcd",
  "🔡":"abcd",
  "🔢":"1234",
  "🔣":"symbols",
  "🔤":"abc",
  "🔥":"fire",
  "🔦":"flashlight",
  "🔧":"wrench",
  "🔨":"hammer",
  "🔩":"nut_and_bolt",
  "🔪":"hocho",
  "🔫":"gun",
  "🔬":"microscope",
  "🔭":"telescope",
  "🔮":"crystal_ball",
  "🔯":"six_pointed_star",
  "🔰":"beginner",
  "🔱":"trident",
  "🔲":"black_square_button",
  "🔳":"white_square_button",
  "🔴":"red_circle",
  "🔵":"large_blue_circle",
  "🔶":"large_orange_diamond",
  "🔷":"large_blue_diamond",
  "🔸":"small_orange_diamond",
  "🔹":"small_blue_diamond",
  "🔺":"small_red_triangle",
  "🔻":"small_red_triangle_down",
  "🔼":"arrow_up_small",
  "🔽":"arrow_down_small",
  "🕉️":"om",
  "🕊️":"dove",
  "🕋":"kaaba",
  "🕌":"mosque",
  "🕍":"synagogue",
  "🕎":"menorah",
  "🕐":"clock1",
  "🕑":"clock2",
  "🕒":"clock3",
  "🕓":"clock4",
  "🕔":"clock5",
  "🕕":"clock6",
  "🕖":"clock7",
  "🕗":"clock8",
  "🕘":"clock9",
  "🕙":"clock10",
  "🕚":"clock11",
  "🕛":"clock12",
  "🕜":"clock130",
  "🕝":"clock230",
  "🕞":"clock330",
  "🕟":"clock430",
  "🕠":"clock530",
  "🕡":"clock630",
  "🕢":"clock730",
  "🕣":"clock830",
  "🕤":"clock930",
  "🕥":"clock1030",
  "🕦":"clock1130",
  "🕧":"clock1230",
  "🕯️":"candle",
  "🕰️":"mantelpiece_clock",
  "🕳️":"hole",
  "🕴️":"business_suit_levitating",
  "🕵️":"detective",
  "🕵️‍♀️":"female_detective",
  "🕵️‍♂️":"male_detective",
  "🕶️":"dark_sunglasses",
  "🕷️":"spider",
  "🕸️":"spider_web",
  "🕹️":"joystick",
  "🕺":"man_dancing",
  "🖇️":"paperclips",
  "🖊️":"pen",
  "🖋️":"fountain_pen",
  "🖌️":"paintbrush",
  "🖍️":"crayon",
  "🖐️":"raised_hand_with_fingers_splayed",
  "🖕":"middle_finger",
  "🖖":"vulcan_salute",
  "🖤":"black_heart",
  "🖥️":"desktop_computer",
  "🖨️":"printer",
  "🖱️":"computer_mouse",
  "🖲️":"trackball",
  "🖼️":"framed_picture",
  "🗂️":"card_index_dividers",
  "🗃️":"card_file_box",
  "🗄️":"file_cabinet",
  "🗑️":"wastebasket",
  "🗒️":"spiral_notepad",
  "🗓️":"spiral_calendar",
  "🗜️":"clamp",
  "🗝️":"old_key",
  "🗞️":"newspaper_roll",
  "🗡️":"dagger",
  "🗣️":"speaking_head",
  "🗨️":"left_speech_bubble",
  "🗯️":"right_anger_bubble",
  "🗳️":"ballot_box",
  "🗺️":"world_map",
  "🗻":"mount_fuji",
  "🗼":"tokyo_tower",
  "🗽":"statue_of_liberty",
  "🗾":"japan",
  "🗿":"moyai",
  "😀":"grinning",
  "😁":"grin",
  "😂":"joy",
  "😃":"smiley",
  "😄":"smile",
  "😅":"sweat_smile",
  "😆":"laughing",
  "😇":"innocent",
  "😈":"smiling_imp",
  "😉":"wink",
  "😊":"blush",
  "😋":"yum",
  "😌":"relieved",
  "😍":"heart_eyes",
  "😎":"sunglasses",
  "😏":"smirk",
  "😐":"neutral_face",
  "😑":"expressionless",
  "😒":"unamused",
  "😓":"sweat",
  "😔":"pensive",
  "😕":"confused",
  "😖":"confounded",
  "😗":"kissing",
  "😘":"kissing_heart",
  "😙":"kissing_smiling_eyes",
  "😚":"kissing_closed_eyes",
  "😛":"stuck_out_tongue",
  "😜":"stuck_out_tongue_winking_eye",
  "😝":"stuck_out_tongue_closed_eyes",
  "😞":"disappointed",
  "😟":"worried",
  "😠":"angry",
  "😡":"rage",
  "😢":"cry",
  "😣":"persevere",
  "😤":"triumph",
  "😥":"disappointed_relieved",
  "😦":"frowning",
  "😧":"anguished",
  "😨":"fearful",
  "😩":"weary",
  "😪":"sleepy",
  "😫":"tired_face",
  "😬":"grimacing",
  "😭":"sob",
  "😮":"open_mouth",
  "😮‍💨":"face_exhaling",
  "😯":"hushed",
  "😰":"cold_sweat",
  "😱":"scream",
  "😲":"astonished",
  "😳":"flushed",
  "😴":"sleeping",
  "😵":"dizzy_face",
  "😵‍💫":"face_with_spiral_eyes",
  "😶":"no_mouth",
  "😶‍🌫️":"face_in_clouds",
  "😷":"mask",
  "😸":"smile_cat",
  "😹":"joy_cat",
  "😺":"smiley_cat",
  "😻":"heart_eyes_cat",
  "😼":"smirk_cat",
  "😽":"kissing_cat",
  "😾":"pouting_cat",
  "😿":"crying_cat_face",
  "🙀":"scream_cat",
  "🙁":"slightly_frowning_face",
  "🙂":"slightly_smiling_face",
  "🙃":"upside_down_face",
  "🙄":"roll_eyes",
  "🙅":"no_good",
  "🙅‍♀️":"no_good_woman",
  "🙅‍♂️":"no_good_man",
  "🙆":"ok_person",
  "🙆‍♀️":"ok_woman",
  "🙆‍♂️":"ok_man",
  "🙇":"bow",
  "🙇‍♀️":"bowing_woman",
  "🙇‍♂️":"bowing_man",
  "🙈":"see_no_evil",
  "🙉":"hear_no_evil",
  "🙊":"speak_no_evil",
  "🙋":"raising_hand",
  "🙋‍♀️":"raising_hand_woman",
  "🙋‍♂️":"raising_hand_man",
  "🙌":"raised_hands",
  "🙍":"frowning_person",
  "🙍‍♀️":"frowning_woman",
  "🙍‍♂️":"frowning_man",
  "🙎":"pouting_face",
  "🙎‍♀️":"pouting_woman",
  "🙎‍♂️":"pouting_man",
  "🙏":"pray",
  "🚀":"rocket",
  "🚁":"helicopter",
  "🚂":"steam_locomotive",
  "🚃":"railway_car",
  "🚄":"bullettrain_side",
  "🚅":"bullettrain_front",
  "🚆":"train2",
  "🚇":"metro",
  "🚈":"light_rail",
  "🚉":"station",
  "🚊":"tram",
  "🚋":"train",
  "🚌":"bus",
  "🚍":"oncoming_bus",
  "🚎":"trolleybus",
  "🚏":"busstop",
  "🚐":"minibus",
  "🚑":"ambulance",
  "🚒":"fire_engine",
  "🚓":"police_car",
  "🚔":"oncoming_police_car",
  "🚕":"taxi",
  "🚖":"oncoming_taxi",
  "🚗":"car",
  "🚘":"oncoming_automobile",
  "🚙":"blue_car",
  "🚚":"truck",
  "🚛":"articulated_lorry",
  "🚜":"tractor",
  "🚝":"monorail",
  "🚞":"mountain_railway",
  "🚟":"suspension_railway",
  "🚠":"mountain_cableway",
  "🚡":"aerial_tramway",
  "🚢":"ship",
  "🚣":"rowboat",
  "🚣‍♀️":"rowing_woman",
  "🚣‍♂️":"rowing_man",
  "🚤":"speedboat",
  "🚥":"traffic_light",
  "🚦":"vertical_traffic_light",
  "🚧":"construction",
  "🚨":"rotating_light",
  "🚩":"triangular_flag_on_post",
  "🚪":"door",
  "🚫":"no_entry_sign",
  "🚬":"smoking",
  "🚭":"no_smoking",
  "🚮":"put_litter_in_its_place",
  "🚯":"do_not_litter",
  "🚰":"potable_water",
  "🚱":"non-potable_water",
  "🚲":"bike",
  "🚳":"no_bicycles",
  "🚴":"bicyclist",
  "🚴‍♀️":"biking_woman",
  "🚴‍♂️":"biking_man",
  "🚵":"mountain_bicyclist",
  "🚵‍♀️":"mountain_biking_woman",
  "🚵‍♂️":"mountain_biking_man",
  "🚶":"walking",
  "🚶‍♀️":"walking_woman",
  "🚶‍♂️":"walking_man",
  "🚷":"no_pedestrians",
  "🚸":"children_crossing",
  "🚹":"mens",
  "🚺":"womens",
  "🚻":"restroom",
  "🚼":"baby_symbol",
  "🚽":"toilet",
  "🚾":"wc",
  "🚿":"shower",
  "🛀":"bath",
  "🛁":"bathtub",
  "🛂":"passport_control",
  "🛃":"customs",
  "🛄":"baggage_claim",
  "🛅":"left_luggage",
  "🛋️":"couch_and_lamp",
  "🛌":"sleeping_bed",
  "🛍️":"shopping",
  "🛎️":"bellhop_bell",
  "🛏️":"bed",
  "🛐":"place_of_worship",
  "🛑":"stop_sign",
  "🛒":"shopping_cart",
  "🛕":"hindu_temple",
  "🛖":"hut",
  "🛗":"elevator",
  "🛜":"wireless",
  "🛝":"playground_slide",
  "🛞":"wheel",
  "🛟":"ring_buoy",
  "🛠️":"hammer_and_wrench",
  "🛡️":"shield",
  "🛢️":"oil_drum",
  "🛣️":"motorway",
  "🛤️":"railway_track",
  "🛥️":"motor_boat",
  "🛩️":"small_airplane",
  "🛫":"flight_departure",
  "🛬":"flight_arrival",
  "🛰️":"artificial_satellite",
  "🛳️":"passenger_ship",
  "🛴":"kick_scooter",
  "🛵":"motor_scooter",
  "🛶":"canoe",
  "🛷":"sled",
  "🛸":"flying_saucer",
  "🛹":"skateboard",
  "🛺":"auto_rickshaw",
  "🛻":"pickup_truck",
  "🛼":"roller_skate",
  "🟠":"orange_circle",
  "🟡":"yellow_circle",
  "🟢":"green_circle",
  "🟣":"purple_circle",
  "🟤":"brown_circle",
  "🟥":"red_square",
  "🟦":"blue_square",
  "🟧":"orange_square",
  "🟨":"yellow_square",
  "🟩":"green_square",
  "🟪":"purple_square",
  "🟫":"brown_square",
  "🟰":"heavy_equals_sign",
  "🤌":"pinched_fingers",
  "🤍":"white_heart",
  "🤎":"brown_heart",
  "🤏":"pinching_hand",
  "🤐":"zipper_mouth_face",
  "🤑":"money_mouth_face",
  "🤒":"face_with_thermometer",
  "🤓":"nerd_face",
  "🤔":"thinking",
  "🤕":"face_with_head_bandage",
  "🤖":"robot",
  "🤗":"hugs",
  "🤘":"metal",
  "🤙":"call_me_hand",
  "🤚":"raised_back_of_hand",
  "🤛":"fist_left",
  "🤜":"fist_right",
  "🤝":"handshake",
  "🤞":"crossed_fingers",
  "🤟":"love_you_gesture",
  "🤠":"cowboy_hat_face",
  "🤡":"clown_face",
  "🤢":"nauseated_face",
  "🤣":"rofl",
  "🤤":"drooling_face",
  "🤥":"lying_face",
  "🤦":"facepalm",
  "🤦‍♀️":"woman_facepalming",
  "🤦‍♂️":"man_facepalming",
  "🤧":"sneezing_face",
  "🤨":"raised_eyebrow",
  "🤩":"star_struck",
  "🤪":"zany_face",
  "🤫":"shushing_face",
  "🤬":"cursing_face",
  "🤭":"hand_over_mouth",
  "🤮":"vomiting_face",
  "🤯":"exploding_head",
  "🤰":"pregnant_woman",
  "🤱":"breast_feeding",
  "🤲":"palms_up_together",
  "🤳":"selfie",
  "🤴":"prince",
  "🤵":"person_in_tuxedo",
  "🤵‍♀️":"woman_in_tuxedo",
  "🤵‍♂️":"man_in_tuxedo",
  "🤶":"mrs_claus",
  "🤷":"shrug",
  "🤷‍♀️":"woman_shrugging",
  "🤷‍♂️":"man_shrugging",
  "🤸":"cartwheeling",
  "🤸‍♀️":"woman_cartwheeling",
  "🤸‍♂️":"man_cartwheeling",
  "🤹":"juggling_person",
  "🤹‍♀️":"woman_juggling",
  "🤹‍♂️":"man_juggling",
  "🤺":"person_fencing",
  "🤼":"wrestling",
  "🤼‍♀️":"women_wrestling",
  "🤼‍♂️":"men_wrestling",
  "🤽":"water_polo",
  "🤽‍♀️":"woman_playing_water_polo",
  "🤽‍♂️":"man_playing_water_polo",
  "🤾":"handball_person",
  "🤾‍♀️":"woman_playing_handball",
  "🤾‍♂️":"man_playing_handball",
  "🤿":"diving_mask",
  "🥀":"wilted_flower",
  "🥁":"drum",
  "🥂":"clinking_glasses",
  "🥃":"tumbler_glass",
  "🥄":"spoon",
  "🥅":"goal_net",
  "🥇":"1st_place_medal",
  "🥈":"2nd_place_medal",
  "🥉":"3rd_place_medal",
  "🥊":"boxing_glove",
  "🥋":"martial_arts_uniform",
  "🥌":"curling_stone",
  "🥍":"lacrosse",
  "🥎":"softball",
  "🥏":"flying_disc",
  "🥐":"croissant",
  "🥑":"avocado",
  "🥒":"cucumber",
  "🥓":"bacon",
  "🥔":"potato",
  "🥕":"carrot",
  "🥖":"baguette_bread",
  "🥗":"green_salad",
  "🥘":"shallow_pan_of_food",
  "🥙":"stuffed_flatbread",
  "🥚":"egg",
  "🥛":"milk_glass",
  "🥜":"peanuts",
  "🥝":"kiwi_fruit",
  "🥞":"pancakes",
  "🥟":"dumpling",
  "🥠":"fortune_cookie",
  "🥡":"takeout_box",
  "🥢":"chopsticks",
  "🥣":"bowl_with_spoon",
  "🥤":"cup_with_straw",
  "🥥":"coconut",
  "🥦":"broccoli",
  "🥧":"pie",
  "🥨":"pretzel",
  "🥩":"cut_of_meat",
  "🥪":"sandwich",
  "🥫":"canned_food",
  "🥬":"leafy_green",
  "🥭":"mango",
  "🥮":"moon_cake",
  "🥯":"bagel",
  "🥰":"smiling_face_with_three_hearts",
  "🥱":"yawning_face",
  "🥲":"smiling_face_with_tear",
  "🥳":"partying_face",
  "🥴":"woozy_face",
  "🥵":"hot_face",
  "🥶":"cold_face",
  "🥷":"ninja",
  "🥸":"disguised_face",
  "🥹":"face_holding_back_tears",
  "🥺":"pleading_face",
  "🥻":"sari",
  "🥼":"lab_coat",
  "🥽":"goggles",
  "🥾":"hiking_boot",
  "🥿":"flat_shoe",
  "🦀":"crab",
  "🦁":"lion",
  "🦂":"scorpion",
  "🦃":"turkey",
  "🦄":"unicorn",
  "🦅":"eagle",
  "🦆":"duck",
  "🦇":"bat",
  "🦈":"shark",
  "🦉":"owl",
  "🦊":"fox_face",
  "🦋":"butterfly",
  "🦌":"deer",
  "🦍":"gorilla",
  "🦎":"lizard",
  "🦏":"rhinoceros",
  "🦐":"shrimp",
  "🦑":"squid",
  "🦒":"giraffe",
  "🦓":"zebra",
  "🦔":"hedgehog",
  "🦕":"sauropod",
  "🦖":"t-rex",
  "🦗":"cricket",
  "🦘":"kangaroo",
  "🦙":"llama",
  "🦚":"peacock",
  "🦛":"hippopotamus",
  "🦜":"parrot",
  "🦝":"raccoon",
  "🦞":"lobster",
  "🦟":"mosquito",
  "🦠":"microbe",
  "🦡":"badger",
  "🦢":"swan",
  "🦣":"mammoth",
  "🦤":"dodo",
  "🦥":"sloth",
  "🦦":"otter",
  "🦧":"orangutan",
  "🦨":"skunk",
  "🦩":"flamingo",
  "🦪":"oyster",
  "🦫":"beaver",
  "🦬":"bison",
  "🦭":"seal",
  "🦮":"guide_dog",
  "🦯":"probing_cane",
  "🦴":"bone",
  "🦵":"leg",
  "🦶":"foot",
  "🦷":"tooth",
  "🦸":"superhero",
  "🦸‍♀️":"superhero_woman",
  "🦸‍♂️":"superhero_man",
  "🦹":"supervillain",
  "🦹‍♀️":"supervillain_woman",
  "🦹‍♂️":"supervillain_man",
  "🦺":"safety_vest",
  "🦻":"ear_with_hearing_aid",
  "🦼":"motorized_wheelchair",
  "🦽":"manual_wheelchair",
  "🦾":"mechanical_arm",
  "🦿":"mechanical_leg",
  "🧀":"cheese",
  "🧁":"cupcake",
  "🧂":"salt",
  "🧃":"beverage_box",
  "🧄":"garlic",
  "🧅":"onion",
  "🧆":"falafel",
  "🧇":"waffle",
  "🧈":"butter",
  "🧉":"mate",
  "🧊":"ice_cube",
  "🧋":"bubble_tea",
  "🧌":"troll",
  "🧍":"standing_person",
  "🧍‍♀️":"standing_woman",
  "🧍‍♂️":"standing_man",
  "🧎":"kneeling_person",
  "🧎‍♀️":"kneeling_woman",
  "🧎‍♂️":"kneeling_man",
  "🧏":"deaf_person",
  "🧏‍♀️":"deaf_woman",
  "🧏‍♂️":"deaf_man",
  "🧐":"monocle_face",
  "🧑":"adult",
  "🧑‍⚕️":"health_worker",
  "🧑‍⚖️":"judge",
  "🧑‍✈️":"pilot",
  "🧑‍🌾":"farmer",
  "🧑‍🍳":"cook",
  "🧑‍🍼":"person_feeding_baby",
  "🧑‍🎄":"mx_claus",
  "🧑‍🎓":"student",
  "🧑‍🎤":"singer",
  "🧑‍🎨":"artist",
  "🧑‍🏫":"teacher",
  "🧑‍🏭":"factory_worker",
  "🧑‍💻":"technologist",
  "🧑‍💼":"office_worker",
  "🧑‍🔧":"mechanic",
  "🧑‍🔬":"scientist",
  "🧑‍🚀":"astronaut",
  "🧑‍🚒":"firefighter",
  "🧑‍🤝‍🧑":"people_holding_hands",
  "🧑‍🦯":"person_with_probing_cane",
  "🧑‍🦰":"person_red_hair",
  "🧑‍🦱":"person_curly_hair",
  "🧑‍🦲":"person_bald",
  "🧑‍🦳":"person_white_hair",
  "🧑‍🦼":"person_in_motorized_wheelchair",
  "🧑‍🦽":"person_in_manual_wheelchair",
  "🧒":"child",
  "🧓":"older_adult",
  "🧔":"bearded_person",
  "🧔‍♀️":"woman_beard",
  "🧔‍♂️":"man_beard",
  "🧕":"woman_with_headscarf",
  "🧖":"sauna_person",
  "🧖‍♀️":"sauna_woman",
  "🧖‍♂️":"sauna_man",
  "🧗":"climbing",
  "🧗‍♀️":"climbing_woman",
  "🧗‍♂️":"climbing_man",
  "🧘":"lotus_position",
  "🧘‍♀️":"lotus_position_woman",
  "🧘‍♂️":"lotus_position_man",
  "🧙":"mage",
  "🧙‍♀️":"mage_woman",
  "🧙‍♂️":"mage_man",
  "🧚":"fairy",
  "🧚‍♀️":"fairy_woman",
  "🧚‍♂️":"fairy_man",
  "🧛":"vampire",
  "🧛‍♀️":"vampire_woman",
  "🧛‍♂️":"vampire_man",
  "🧜":"merperson",
  "🧜‍♀️":"mermaid",
  "🧜‍♂️":"merman",
  "🧝":"elf",
  "🧝‍♀️":"elf_woman",
  "🧝‍♂️":"elf_man",
  "🧞":"genie",
  "🧞‍♀️":"genie_woman",
  "🧞‍♂️":"genie_man",
  "🧟":"zombie",
  "🧟‍♀️":"zombie_woman",
  "🧟‍♂️":"zombie_man",
  "🧠":"brain",
  "🧡":"orange_heart",
  "🧢":"billed_cap",
  "🧣":"scarf",
  "🧤":"gloves",
  "🧥":"coat",
  "🧦":"socks",
  "🧧":"red_envelope",
  "🧨":"firecracker",
  "🧩":"jigsaw",
  "🧪":"test_tube",
  "🧫":"petri_dish",
  "🧬":"dna",
  "🧭":"compass",
  "🧮":"abacus",
  "🧯":"fire_extinguisher",
  "🧰":"toolbox",
  "🧱":"bricks",
  "🧲":"magnet",
  "🧳":"luggage",
  "🧴":"lotion_bottle",
  "🧵":"thread",
  "🧶":"yarn",
  "🧷":"safety_pin",
  "🧸":"teddy_bear",
  "🧹":"broom",
  "🧺":"basket",
  "🧻":"roll_of_paper",
  "🧼":"soap",
  "🧽":"sponge",
  "🧾":"receipt",
  "🧿":"nazar_amulet",
  "🩰":"ballet_shoes",
  "🩱":"one_piece_swimsuit",
  "🩲":"swim_brief",
  "🩳":"shorts",
  "🩴":"thong_sandal",
  "🩵":"light_blue_heart",
  "🩶":"grey_heart",
  "🩷":"pink_heart",
  "🩸":"drop_of_blood",
  "🩹":"adhesive_bandage",
  "🩺":"stethoscope",
  "🩻":"x_ray",
  "🩼":"crutch",
  "🪀":"yo_yo",
  "🪁":"kite",
  "🪂":"parachute",
  "🪃":"boomerang",
  "🪄":"magic_wand",
  "🪅":"pinata",
  "🪆":"nesting_dolls",
  "🪇":"maracas",
  "🪈":"flute",
  "🪐":"ringed_planet",
  "🪑":"chair",
  "🪒":"razor",
  "🪓":"axe",
  "🪔":"diya_lamp",
  "🪕":"banjo",
  "🪖":"military_helmet",
  "🪗":"accordion",
  "🪘":"long_drum",
  "🪙":"coin",
  "🪚":"carpentry_saw",
  "🪛":"screwdriver",
  "🪜":"ladder",
  "🪝":"hook",
  "🪞":"mirror",
  "🪟":"window",
  "🪠":"plunger",
  "🪡":"sewing_needle",
  "🪢":"knot",
  "🪣":"bucket",
  "🪤":"mouse_trap",
  "🪥":"toothbrush",
  "🪦":"headstone",
  "🪧":"placard",
  "🪨":"rock",
  "🪩":"mirror_ball",
  "🪪":"identification_card",
  "🪫":"low_battery",
  "🪬":"hamsa",
  "🪭":"folding_hand_fan",
  "🪮":"hair_pick",
  "🪯":"khanda",
  "🪰":"fly",
  "🪱":"worm",
  "🪲":"beetle",
  "🪳":"cockroach",
  "🪴":"potted_plant",
  "🪵":"wood",
  "🪶":"feather",
  "🪷":"lotus",
  "🪸":"coral",
  "🪹":"empty_nest",
  "🪺":"nest_with_eggs",
  "🪻":"hyacinth",
  "🪼":"jellyfish",
  "🪽":"wing",
  "🪿":"goose",
  "🫀":"anatomical_heart",
  "🫁":"lungs",
  "🫂":"people_hugging",
  "🫃":"pregnant_man",
  "🫄":"pregnant_person",
  "🫅":"person_with_crown",
  "🫎":"moose",
  "🫏":"donkey",
  "🫐":"blueberries",
  "🫑":"bell_pepper",
  "🫒":"olive",
  "🫓":"flatbread",
  "🫔":"tamale",
  "🫕":"fondue",
  "🫖":"teapot",
  "🫗":"pouring_liquid",
  "🫘":"beans",
  "🫙":"jar",
  "🫚":"ginger_root",
  "🫛":"pea_pod",
  "🫠":"melting_face",
  "🫡":"saluting_face",
  "🫢":"face_with_open_eyes_and_hand_over_mouth",
  "🫣":"face_with_peeking_eye",
  "🫤":"face_with_diagonal_mouth",
  "🫥":"dotted_line_face",
  "🫦":"biting_lip",
  "🫧":"bubbles",
  "🫨":"shaking_face",
  "🫰":"hand_with_index_finger_and_thumb_crossed",
  "🫱":"rightwards_hand",
  "🫲":"leftwards_hand",
  "🫳":"palm_down_hand",
  "🫴":"palm_up_hand",
  "🫵":"index_pointing_at_the_viewer",
  "🫶":"heart_hands",
  "🫷":"leftwards_pushing_hand",
  "🫸":"rightwards_pushing_hand",
};

// Normalises a poll display name to a filename-safe slug, e.g. "Summer Sports" → "summer-sports".
function slugify(name) {
  return name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

// Builds Block Kit blocks for a button-mode poll, reflecting current vote counts.
// counts: { [optionIndex]: voteCount }
function buildButtonPollBlocks(pollData, counts, slug) {
  const blocks = [];
  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*📊 ${pollData.name}*` } });
  const preamble = pollData.preamble || 'Click a button to cast your vote:';
  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `@channel: ${preamble}` } });
  for (let i = 0; i < pollData.options.length; i++) {
    const emoji = (pollData.emojis && pollData.emojis[i]) || NUMBER_EMOJIS[i] || 'question';
    const count = counts[i] || 0;
    const voteText = count === 1 ? '1 vote' : `${count} votes`;
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `    :${emoji}: ${pollData.options[i]}` },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: voteText },
        style: 'primary',
        action_id: 'poll_vote',
        value: `${slug}:${i}`,
      },
    });
  }
  if (pollData.description) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: pollData.description } });
  }
  blocks.push({
    type: 'context',
    block_id: 'poll_marker',
    elements: [{ type: 'mrkdwn', text: `poll_marker:${slug}` }],
  });
  return blocks;
}

async function postButtonPollResults(slug, pollData, channelId, userId, env) {
  const prefix = `votes:${slug}:${channelId}:`;
  const { keys } = await env.POLL_VOTES.list({ prefix });

  const allVotes = {};
  let messageTs = null;
  for (const key of keys) {
    const votes = (await env.POLL_VOTES.get(key.name, 'json')) || {};
    Object.assign(allVotes, votes);
    messageTs = key.name.substring(prefix.length);
  }

  const counts = {};
  for (const v of Object.values(allVotes)) counts[v] = (counts[v] || 0) + 1;

  // Build results array sorted by count descending (matches Go BuildResultsBlocks order)
  const results = pollData.options.map((label, i) => ({
    emoji: (pollData.emojis && pollData.emojis[i]) || NUMBER_EMOJIS[i] || 'question',
    label,
    count: counts[i] || 0,
  })).sort((a, b) => b.count - a.count);

  const maxCount = results[0].count;
  const winners = results.filter(r => r.count === maxCount).map(r => r.label);

  let summary;
  if (maxCount <= 0) {
    summary = '@channel: No votes have been cast yet.';
  } else if (winners.length === 1) {
    summary = `@channel: Top event: ${winners[0]}.`;
  } else {
    summary = `@channel: It's a tie between ${winners.join(' and ')}.`;
  }

  // Blocks matching Go's BuildResultsBlocks exactly
  const blocks = [
    { type: 'section', text: { type: 'mrkdwn', text: '📊 *Final Poll Results Are In!*' } },
    ...results.map(r => ({
      type: 'section',
      text: { type: 'mrkdwn', text: `    :${r.emoji}: ${r.label} — ${r.count} vote${r.count !== 1 ? 's' : ''}` },
    })),
    { type: 'section', text: { type: 'mrkdwn', text: summary } },
  ];

  // Fallback text matching Go's BuildResults format
  const fallbackLines = ['📊 *Final Poll Results Are In!*'];
  for (const r of results) {
    fallbackLines.push(`    :${r.emoji}: ${r.label} received ${r.count} votes`);
  }
  fallbackLines.push(summary.replace('@channel: ', ''));

  await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel: channelId, text: fallbackLines.join('\n'), blocks }),
  });

  if (messageTs) {
    await fetch('https://slack.com/api/chat.delete', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: channelId, ts: messageTs }),
    });
  }

  if (maxCount > 0) {
    const isTie = winners.length > 1;
    const winnerLabel = winners.join(' and ');
    const winningLabels = new Set(winners);
    await Promise.allSettled(Object.entries(allVotes).map(async ([voterUserId, optionIndex]) => {
      const votedLabel = pollData.options[parseInt(optionIndex)];
      let msg;
      if (isTie) {
        msg = TIE_MESSAGES[Math.floor(Math.random() * TIE_MESSAGES.length)];
      } else if (winningLabels.has(votedLabel)) {
        msg = WINNER_MESSAGES[Math.floor(Math.random() * WINNER_MESSAGES.length)].replace('%s', winnerLabel);
      } else {
        msg = LOSER_MESSAGES[Math.floor(Math.random() * LOSER_MESSAGES.length)].replace('%s', winnerLabel);
      }
      const openRes = await fetch('https://slack.com/api/conversations.open', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ users: voterUserId }),
      });
      const { channel } = await openRes.json();
      if (!channel?.id) return;
      await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: channel.id, text: msg }),
      });
    }));
  }
}

function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function ghHeaders(env) {
  return {
    'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'slack-poll-bot',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function pollFileExists(slug, env) {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/polls/${slug}.json`;
  const resp = await fetch(url, { headers: ghHeaders(env) });
  return resp.ok;
}

async function commitPollFile(slug, name, options, emojis, preamble, description, authorId, votingMode, schedule, channelId, env) {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/polls/${slug}.json`;
  const pollData = { name, options, emojis, author_id: authorId };
  if (preamble) pollData.preamble = preamble;
  if (description) pollData.description = description;
  if (votingMode && votingMode !== 'reaction') pollData.voting_mode = votingMode;
  if (schedule) pollData.schedule = schedule.toLowerCase().trim();
  if (channelId) pollData.channel_id = channelId;
  const content = JSON.stringify(pollData, null, 2);
  const put = await fetch(url, {
    method: 'PUT',
    headers: { ...ghHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `Add poll: ${slug}`,
      content: toBase64(content),
      branch: 'main',
    }),
  });
  if (!put.ok) {
    const text = await put.text();
    throw new Error(`GitHub API ${put.status}: ${text}`);
  }
}

async function listPolls(env) {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/polls`;
  const resp = await fetch(url, { headers: ghHeaders(env) });
  if (resp.status === 404) return [];
  if (!resp.ok) return null; // error
  const files = await resp.json();
  return files
    .filter(f => f.type === 'file' && f.name.endsWith('.json'))
    .map(f => f.name.replace(/\.json$/, ''));
}

async function getPollData(slug, env) {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/polls/${slug}.json`;
  const resp = await fetch(url, { headers: ghHeaders(env) });
  if (!resp.ok) return null;
  const file = await resp.json();
  return JSON.parse(atob(file.content.replace(/\n/g, '')));
}

async function deletePollFile(slug, env) {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/polls/${slug}.json`;
  const getResp = await fetch(url, { headers: ghHeaders(env) });
  if (!getResp.ok) throw new Error(`Poll not found: ${slug}`);
  const { sha } = await getResp.json();
  const delResp = await fetch(url, {
    method: 'DELETE',
    headers: { ...ghHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `Delete poll: ${slug}`, sha, branch: 'main' }),
  });
  if (!delResp.ok) {
    const text = await delResp.text();
    throw new Error(`GitHub API ${delResp.status}: ${text}`);
  }
}

// ── Slack API helpers ─────────────────────────────────────────────────────────

async function openModal(triggerId, channelId, userId, env) {
  const modal = {
    type: 'modal',
    callback_id: 'create_poll',
    private_metadata: JSON.stringify({ channel_id: channelId, user_id: userId }),
    title: { type: 'plain_text', text: 'Create a Poll' },
    submit: { type: 'plain_text', text: 'Create' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'poll_name',
        label: { type: 'plain_text', text: 'Poll Name' },
        element: {
          type: 'plain_text_input',
          action_id: 'value',
          placeholder: { type: 'plain_text', text: 'e.g. Summer Sports' },
        },
      },
      {
        type: 'input',
        block_id: 'poll_preamble',
        label: { type: 'plain_text', text: 'Intro (optional)' },
        optional: true,
        element: {
          type: 'plain_text_input',
          action_id: 'value',
          multiline: true,
          placeholder: { type: 'plain_text', text: 'What question are you asking? Shown above the options.\ne.g. "What should we do for the company outing?"' },
        },
      },
      {
        type: 'input',
        block_id: 'poll_options',
        label: { type: 'plain_text', text: 'Options (one per line, up to 9)' },
        hint: { type: 'plain_text', text: 'One option per line. Optionally prefix with a raw emoji (e.g. ⚽ Soccer) or a shortcode in colons (e.g. :name: Soccer) to set the reaction. Without a prefix, options are auto-numbered 1️⃣ 2️⃣ 3️⃣.' },
        element: {
          type: 'plain_text_input',
          action_id: 'value',
          multiline: true,
          placeholder: { type: 'plain_text', text: '⚽ Soccer\n🏀 Basketball\nSwimming\nPickleball' },
        },
      },
      {
        type: 'input',
        block_id: 'poll_description',
        label: { type: 'plain_text', text: 'Description (optional)' },
        optional: true,
        element: {
          type: 'plain_text_input',
          action_id: 'value',
          multiline: true,
          placeholder: { type: 'plain_text', text: 'Add context or rules for voters — shown below the options in the poll.' },
        },
      },
      {
        type: 'input',
        block_id: 'voting_mode',
        label: { type: 'plain_text', text: 'Voting Method' },
        element: {
          type: 'radio_buttons',
          action_id: 'value',
          initial_option: { text: { type: 'plain_text', text: 'Reaction-based — voters react with emojis' }, value: 'reaction' },
          options: [
            {
              text: { type: 'plain_text', text: 'Reaction-based — voters react with emojis' },
              value: 'reaction',
            },
            {
              text: { type: 'plain_text', text: 'Button-based — voters click buttons, live counts shown' },
              value: 'button',
            },
          ],
        },
      },
      {
        type: 'input',
        block_id: 'poll_schedule',
        label: { type: 'plain_text', text: 'Recurring Schedule (optional)' },
        optional: true,
        hint: { type: 'plain_text', text: 'Day and time in CT (24-hour clock). Leave blank for manual posting only.' },
        element: {
          type: 'plain_text_input',
          action_id: 'value',
          placeholder: { type: 'plain_text', text: 'e.g. monday 09:00' },
        },
      },
    ],
  };

  const resp = await fetch('https://slack.com/api/views.open', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ trigger_id: triggerId, view: modal }),
  });
  const data = await resp.json();
  if (!data.ok) throw new Error(`views.open failed: ${data.error}`);
}

async function openPostPollModal(triggerId, channelId, userId, polls, env) {
  const options = [
    { text: { type: 'plain_text', text: '🏃 Weekly Sports Poll' }, value: 'weekly' },
    ...polls.map(slug => ({
      text: { type: 'plain_text', text: slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') },
      value: slug,
    })),
  ];

  const modal = {
    type: 'modal',
    callback_id: 'post_poll',
    private_metadata: JSON.stringify({ channel_id: channelId, user_id: userId }),
    title: { type: 'plain_text', text: 'Post a Poll' },
    submit: { type: 'plain_text', text: 'Post' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'poll_select',
        label: { type: 'plain_text', text: 'Which poll would you like to post?' },
        element: {
          type: 'static_select',
          action_id: 'value',
          placeholder: { type: 'plain_text', text: 'Select a poll…' },
          options,
        },
      },
    ],
  };

  const resp = await fetch('https://slack.com/api/views.open', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ trigger_id: triggerId, view: modal }),
  });
  const data = await resp.json();
  if (!data.ok) throw new Error(`views.open failed: ${data.error}`);
}

async function openResultsModal(triggerId, channelId, userId, polls, env) {
  const options = [
    { text: { type: 'plain_text', text: '🏃 Weekly Sports Poll' }, value: 'weekly' },
    ...polls.map(slug => ({
      text: { type: 'plain_text', text: slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') },
      value: slug,
    })),
  ];

  const modal = {
    type: 'modal',
    callback_id: 'post_results',
    private_metadata: JSON.stringify({ channel_id: channelId, user_id: userId }),
    title: { type: 'plain_text', text: 'Post Results' },
    submit: { type: 'plain_text', text: 'Post Results' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'poll_select',
        label: { type: 'plain_text', text: 'Which poll are you posting results for?' },
        element: {
          type: 'static_select',
          action_id: 'value',
          placeholder: { type: 'plain_text', text: 'Select a poll…' },
          options,
        },
      },
    ],
  };

  const resp = await fetch('https://slack.com/api/views.open', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ trigger_id: triggerId, view: modal }),
  });
  const data = await resp.json();
  if (!data.ok) throw new Error(`views.open failed: ${data.error}`);
}

async function openRunoffModal(triggerId, channelId, userId, polls, env) {
  const options = [
    { text: { type: 'plain_text', text: '🏃 Weekly Sports Poll' }, value: 'weekly' },
    ...polls.map(slug => ({
      text: { type: 'plain_text', text: slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') },
      value: slug,
    })),
  ];

  const modal = {
    type: 'modal',
    callback_id: 'run_runoff',
    private_metadata: JSON.stringify({ channel_id: channelId, user_id: userId }),
    title: { type: 'plain_text', text: 'Run a Runoff' },
    submit: { type: 'plain_text', text: 'Run Runoff' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: 'This will check the selected poll for a tie and post a runoff if one is detected.' },
      },
      {
        type: 'input',
        block_id: 'poll_select',
        label: { type: 'plain_text', text: 'Which poll has a tie?' },
        element: {
          type: 'static_select',
          action_id: 'value',
          placeholder: { type: 'plain_text', text: 'Select a poll…' },
          options,
        },
      },
    ],
  };

  const resp = await fetch('https://slack.com/api/views.open', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ trigger_id: triggerId, view: modal }),
  });
  const data = await resp.json();
  if (!data.ok) throw new Error(`views.open failed: ${data.error}`);
}

async function openDeleteModal(triggerId, channelId, userId, polls, env) {
  const options = polls.map(slug => ({
    text: { type: 'plain_text', text: slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') },
    value: slug,
  }));

  const modal = {
    type: 'modal',
    callback_id: 'delete_poll',
    private_metadata: JSON.stringify({ channel_id: channelId, user_id: userId }),
    title: { type: 'plain_text', text: 'Delete a Poll' },
    submit: { type: 'plain_text', text: 'Continue' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: "You'll be asked to confirm before anything is deleted." },
      },
      {
        type: 'input',
        block_id: 'poll_select',
        label: { type: 'plain_text', text: 'Which poll would you like to delete?' },
        element: {
          type: 'static_select',
          action_id: 'value',
          placeholder: { type: 'plain_text', text: 'Select a poll…' },
          options,
        },
      },
    ],
  };

  const resp = await fetch('https://slack.com/api/views.open', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ trigger_id: triggerId, view: modal }),
  });
  const data = await resp.json();
  if (!data.ok) throw new Error(`views.open failed: ${data.error}`);
}

async function sendDeleteConfirmationDM(userId, slug, pollName, env) {
  const resp = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      channel: userId,
      text: `Delete the "${pollName}" poll?`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `🗑️ Are you sure you want to permanently delete the *${pollName}* poll? This cannot be undone.`,
          },
        },
        {
          type: 'actions',
          block_id: 'delete_confirm_actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Yes, Delete' },
              style: 'danger',
              action_id: 'delete_poll_confirm',
              value: slug,
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Cancel' },
              action_id: 'delete_poll_cancel',
              value: slug,
            },
          ],
        },
      ],
    }),
  });
  const data = await resp.json();
  if (!data.ok) throw new Error(`chat.postMessage failed: ${data.error}`);
}

async function updateMessage(channelId, ts, text, env) {
  await fetch('https://slack.com/api/chat.update', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ channel: channelId, ts, text, blocks: [] }),
  });
}

async function postEphemeral(channelId, userId, text, env) {
  await fetch('https://slack.com/api/chat.postEphemeral', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ channel: channelId, user: userId, text }),
  });
}

// ── Response helpers ──────────────────────────────────────────────────────────

function ephemeral(text, status = 200) {
  return new Response(JSON.stringify({ response_type: 'ephemeral', text }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function modalError(blockId, message) {
  return new Response(
    JSON.stringify({ response_action: 'errors', errors: { [blockId]: message } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

// ── Interaction handler (modal submissions) ───────────────────────────────────

async function handleInteraction(request, env) {
  const body = await request.text();

  if (!await verifySlackSignature(request, body, env.SLACK_SIGNING_SECRET)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const params = new URLSearchParams(body);
  const payload = JSON.parse(params.get('payload') || '{}');

  // ── block_actions: button clicks (e.g. delete confirmation DM) ──────────────
  if (payload.type === 'block_actions') {
    const action = payload.actions?.[0];
    const channelId = payload.channel?.id;
    const messageTs = payload.message?.ts;

    if (action?.action_id === 'delete_poll_confirm') {
      const slug = action.value;
      const work = async () => {
        try {
          await deletePollFile(slug, env);
          await updateMessage(channelId, messageTs, `✅ Poll *${slug}* has been permanently deleted.`, env);
        } catch (e) {
          console.error('delete_poll_confirm error:', e);
          await updateMessage(channelId, messageTs, `❌ Failed to delete poll: ${e.message}`, env);
        }
      };
      if (typeof env._ctx?.waitUntil === 'function') env._ctx.waitUntil(work());
    } else if (action?.action_id === 'delete_poll_cancel') {
      const slug = action.value;
      const work = async () => {
        await updateMessage(channelId, messageTs, `Deletion of *${slug}* cancelled.`, env);
      };
      if (typeof env._ctx?.waitUntil === 'function') env._ctx.waitUntil(work());
    } else if (action?.action_id === 'poll_vote') {
      const [slug, optIdxStr] = action.value.split(':');
      const optIdx = parseInt(optIdxStr, 10);
      const userId = payload.user?.id;

      const work = async () => {
        try {
          const pollData = await getPollData(slug, env);
          if (!pollData) { console.error('poll_vote: poll not found:', slug); return; }

          const kvKey = `votes:${slug}:${channelId}:${messageTs}`;
          const existing = (await env.POLL_VOTES.get(kvKey, 'json')) || {};

          if (existing[userId] === optIdx) {
            delete existing[userId]; // toggle off
          } else {
            existing[userId] = optIdx; // set or change vote
          }
          await env.POLL_VOTES.put(kvKey, JSON.stringify(existing));

          const counts = {};
          for (const v of Object.values(existing)) counts[v] = (counts[v] || 0) + 1;

          const blocks = buildButtonPollBlocks(pollData, counts, slug);
          await fetch('https://slack.com/api/chat.update', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ channel: channelId, ts: messageTs, text: `📊 ${pollData.name}`, blocks }),
          });
        } catch (e) {
          console.error('poll_vote error:', e);
        }
      };
      if (typeof env._ctx?.waitUntil === 'function') env._ctx.waitUntil(work());
    }

    return new Response('', { status: 200 });
  }

  if (payload.type !== 'view_submission') return new Response('', { status: 200 });

  const callbackId = payload.view?.callback_id;
  let meta = {};
  try { meta = JSON.parse(payload.view.private_metadata || '{}'); } catch {}

  // ── post_poll: user selected a poll to post ───────────────────────────────
  if (callbackId === 'post_poll') {
    const selected = payload.view.state.values.poll_select?.value?.selected_option?.value || '';
    const inputs = { channel_id: meta.channel_id || '' };
    if (selected && selected !== 'weekly') inputs.poll_name = selected;

    const dispatchPromise = triggerWorkflow('post_poll.yml', env, inputs)
      .then(() => {
        if (meta.channel_id && meta.user_id) {
          const label = selected === 'weekly' ? 'Weekly Sports Poll' : selected;
          return postEphemeral(meta.channel_id, meta.user_id, `📊 *${label}* is being posted to the channel!`, env);
        }
      })
      .catch(err => {
        console.error('post_poll dispatch error:', err);
        if (meta.channel_id && meta.user_id) {
          return postEphemeral(meta.channel_id, meta.user_id, '❌ Failed to post poll. Please try again.', env);
        }
      });

    if (typeof env._ctx?.waitUntil === 'function') env._ctx.waitUntil(dispatchPromise);
    return new Response('', { status: 200 });
  }

  // ── post_results: user selected a poll to post results for ───────────────
  if (callbackId === 'post_results') {
    const selected = payload.view.state.values.poll_select?.value?.selected_option?.value || '';
    const channelId = meta.channel_id || '';
    const userId = meta.user_id || '';

    const work = async () => {
      try {
        if (selected && selected !== 'weekly') {
          const pollData = await getPollData(selected, env);
          if (pollData?.voting_mode === 'button') {
            await postButtonPollResults(selected, pollData, channelId, userId, env);
            return;
          }
        }
        await triggerWorkflow('post_results.yml', env, { channel_id: channelId });
        if (channelId && userId) {
          await postEphemeral(channelId, userId, '📊 Results are being computed and will be posted shortly. The poll will be removed once done.', env);
        }
      } catch (err) {
        console.error('post_results error:', err);
        if (channelId && userId) {
          await postEphemeral(channelId, userId, '❌ Failed to post results. Please try again.', env);
        }
      }
    };
    if (typeof env._ctx?.waitUntil === 'function') env._ctx.waitUntil(work());
    return new Response('', { status: 200 });
  }

  // ── delete_poll: user selected a poll to delete ──────────────────────────
  if (callbackId === 'delete_poll') {
    const selected = payload.view.state.values.poll_select?.value?.selected_option?.value || '';
    const userId = payload.user?.id;

    const work = async () => {
      try {
        const pollData = await getPollData(selected, env);
        if (!pollData) {
          await postEphemeral(meta.channel_id, userId, `❌ Poll \`${selected}\` not found.`, env);
          return;
        }
        if (pollData.author_id && pollData.author_id !== userId && userId !== env.ADMIN_USER_ID) {
          await postEphemeral(meta.channel_id, userId, `❌ Only the poll author can delete it.`, env);
          return;
        }
        await sendDeleteConfirmationDM(userId, selected, pollData.name, env);
      } catch (e) {
        console.error('delete_poll flow error:', e);
        await postEphemeral(meta.channel_id, userId, '❌ Failed to process deletion. Please try again.', env);
      }
    };
    if (typeof env._ctx?.waitUntil === 'function') env._ctx.waitUntil(work());
    return new Response('', { status: 200 });
  }

  // ── run_runoff: user selected a poll to run a runoff for ────────────────
  if (callbackId === 'run_runoff') {
    const selected = payload.view.state.values.poll_select?.value?.selected_option?.value || '';
    const inputs = { channel_id: meta.channel_id || '' };
    if (selected && selected !== 'weekly') inputs.poll_name = selected;

    const dispatchPromise = triggerWorkflow('runoff.yml', env, inputs)
      .then(() => {
        if (meta.channel_id && meta.user_id) {
          return postEphemeral(meta.channel_id, meta.user_id, '🗳️ Checking for ties and posting a runoff poll if needed. Check the channel shortly.', env);
        }
      })
      .catch(err => {
        console.error('run_runoff dispatch error:', err);
        if (meta.channel_id && meta.user_id) {
          return postEphemeral(meta.channel_id, meta.user_id, '❌ Failed to trigger runoff. Please try again.', env);
        }
      });

    if (typeof env._ctx?.waitUntil === 'function') env._ctx.waitUntil(dispatchPromise);
    return new Response('', { status: 200 });
  }

  // ── create_poll: user submitted a new poll form ───────────────────────────
  if (callbackId !== 'create_poll') return new Response('', { status: 200 });

  const values = payload.view.state.values;
  const nameRaw = values.poll_name?.value?.value?.trim() || '';
  const preambleRaw = values.poll_preamble?.value?.value?.trim() || '';
  const optionsRaw = values.poll_options?.value?.value?.trim() || '';
  const descriptionRaw = values.poll_description?.value?.value?.trim() || '';
  const votingModeRaw = values.voting_mode?.value?.selected_option?.value || 'reaction';
  const scheduleRaw = values.poll_schedule?.value?.value?.trim() || '';

  if (!nameRaw) return modalError('poll_name', 'Poll name is required.');

  if (scheduleRaw) {
    const schedulePattern = /^(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+\d{1,2}:\d{2}(\s+(CT|CDT|CST))?$/i;
    if (!schedulePattern.test(scheduleRaw)) {
      return modalError('poll_schedule', 'Use format: weekday HH:MM (e.g. monday 09:00)');
    }
  }

  const options = [];
  const emojis = [];
  for (const line of optionsRaw.split('\n').map(l => l.trim()).filter(Boolean)) {
    // :emoji_name: Label
    const namedMatch = line.match(/^:([a-z0-9_+\-]+):\s*(.+)$/);
    if (namedMatch) {
      emojis.push(namedMatch[1]);
      options.push(namedMatch[2].trim());
      continue;
    }
    // Raw unicode emoji + Label (e.g. "⚽ Soccer" or "😊 Happy")
    const unicodeMatch = line.match(/^(\p{Extended_Pictographic}️?)\s+(.+)$/u);
    if (unicodeMatch) {
      const name = UNICODE_TO_SLACK[unicodeMatch[1]] || UNICODE_TO_SLACK[unicodeMatch[1].replace(/️$/, '')];
      emojis.push(name || NUMBER_EMOJIS[options.length] || 'question');
      options.push(unicodeMatch[2].trim());
      continue;
    }
    // No emoji prefix — numbered fallback
    emojis.push(NUMBER_EMOJIS[options.length] || 'question');
    options.push(line);
  }

  if (options.length < 2) return modalError('poll_options', 'Please enter at least 2 options.');
  if (options.length > 9) return modalError('poll_options', 'Maximum 9 options allowed.');

  const slug = slugify(nameRaw);
  if (!slug) return modalError('poll_name', 'Poll name must contain at least one letter or number.');

  if (await pollFileExists(slug, env)) {
    return modalError('poll_name', `A poll named "${nameRaw}" already exists. Choose a different name.`);
  }

  const commitPromise = commitPollFile(slug, nameRaw, options, emojis, preambleRaw, descriptionRaw, payload.user?.id, votingModeRaw, scheduleRaw, meta.channel_id || '', env)
    .then(() => {
      if (meta.channel_id && meta.user_id) {
        return postEphemeral(
          meta.channel_id,
          meta.user_id,
          `✅ Poll *${nameRaw}* saved! It will appear in \`/newpoll\` next time.`,
          env,
        );
      }
    })
    .catch(err => {
      console.error('commitPollFile error:', err);
      if (meta.channel_id && meta.user_id) {
        return postEphemeral(meta.channel_id, meta.user_id, '❌ Failed to save poll. Please try again.', env);
      }
    });

  if (typeof env._ctx?.waitUntil === 'function') env._ctx.waitUntil(commitPromise);

  // Returning empty 200 closes the modal immediately.
  return new Response('', { status: 200 });
}

// ── Slash command handler ─────────────────────────────────────────────────────

async function handleSlashCommand(request, env) {
  const body = await request.text();

  if (!await verifySlackSignature(request, body, env.SLACK_SIGNING_SECRET)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const params = new URLSearchParams(body);
  const command = params.get('command');
  const channelId = params.get('channel_id') || '';
  const userId = params.get('user_id') || '';
  const triggerId = params.get('trigger_id') || '';
  const text = (params.get('text') || '').trim();

  switch (command) {
    case '/help':
      return ephemeral(HELP_TEXT);

    case '/vote':
      return ephemeral([
        '🗳️ *How to Vote (Yes, We Know You Need This Explained)*',
        '',
        "Voting is done via emoji reactions. It is, objectively, the simplest possible interaction a human can perform — and yet, here we are.",
        '',
        '*Step 1:* Find the poll in the channel. It\'s the big block of text that starts with 📊. You\'ve probably scrolled past it already.',
        '',
        '*Step 2:* Hover over the poll message and click the emoji button (the little 🙂 that appears on the right). On mobile, long-press the message like you\'re trying to intimidate it.',
        '',
        '*Step 3:* Find and select the emoji that matches your choice. For the weekly poll, your options are:',
        POLL_OPTIONS_TEXT,
        '',
        'For custom polls, the options are numbered — use 1️⃣ 2️⃣ 3️⃣ etc., exactly as shown in the poll message. The labels are right there. Read them.',
        '',
        '*Step 4:* That\'s it. You\'re done. There is no step 5. Please rejoin society.',
        '',
        '_One reaction per option. Voting for everything is not a strategy, it\'s a cry for help. Use `/results` to watch your pick lose in real time._',
      ].join('\n'));

    case '/results': {
      const resultsWork = async () => {
        try {
          const polls = await listPolls(env) || [];
          await openResultsModal(triggerId, channelId, userId, polls, env);
        } catch (e) {
          console.error('results modal error:', e);
          await postEphemeral(channelId, userId, '❌ Failed to open results selector. Please try again.', env);
        }
      };
      const rp = resultsWork();
      if (typeof env._ctx?.waitUntil === 'function') env._ctx.waitUntil(rp);
      return new Response('', { status: 200 });
    }

    case '/newpoll': {
      const newpollWork = async () => {
        try {
          const polls = await listPolls(env) || [];
          await openPostPollModal(triggerId, channelId, userId, polls, env);
        } catch (e) {
          console.error('newpoll modal error:', e);
          await postEphemeral(channelId, userId, '❌ Failed to open poll selector. Please try again.', env);
        }
      };
      const np = newpollWork();
      if (typeof env._ctx?.waitUntil === 'function') env._ctx.waitUntil(np);
      return new Response('', { status: 200 });
    }

    case '/runoff': {
      const runoffWork = async () => {
        try {
          const polls = await listPolls(env) || [];
          await openRunoffModal(triggerId, channelId, userId, polls, env);
        } catch (e) {
          console.error('runoff modal error:', e);
          await postEphemeral(channelId, userId, '❌ Failed to open runoff selector. Please try again.', env);
        }
      };
      const rof = runoffWork();
      if (typeof env._ctx?.waitUntil === 'function') env._ctx.waitUntil(rof);
      return new Response('', { status: 200 });
    }

    case '/delete': {
      const deleteWork = async () => {
        try {
          const polls = await listPolls(env) || [];
          if (polls.length === 0) {
            await postEphemeral(channelId, userId, 'No custom polls to delete. Use `/create` to make one.', env);
            return;
          }
          await openDeleteModal(triggerId, channelId, userId, polls, env);
        } catch (e) {
          console.error('delete modal error:', e);
          await postEphemeral(channelId, userId, '❌ Failed to open delete selector. Please try again.', env);
        }
      };
      const dp = deleteWork();
      if (typeof env._ctx?.waitUntil === 'function') env._ctx.waitUntil(dp);
      return new Response('', { status: 200 });
    }

    case '/create': {
      const createWork = async () => {
        try {
          await openModal(triggerId, channelId, userId, env);
        } catch (e) {
          console.error('modal open error:', e);
          await postEphemeral(channelId, userId, '❌ Failed to open poll creation form. Please try again.', env);
        }
      };
      const cp = createWork();
      if (typeof env._ctx?.waitUntil === 'function') env._ctx.waitUntil(cp);
      return new Response('', { status: 200 });
    }

    case '/polls': {
      try {
        const polls = await listPolls(env);
        if (polls === null) return ephemeral('Failed to fetch polls. Please try again.');
        const lines = ['• `weekly` — 🏃 Weekly Sports Poll', ...polls.map(p => `• \`${p}\``)];
        return ephemeral(`📋 *Available Polls*\n\n${lines.join('\n')}\n\nUse \`/newpoll\` to post one or \`/create\` to add a custom poll.`);
      } catch (e) {
        console.error('polls list error:', e);
        return ephemeral('Failed to fetch polls. Please try again.');
      }
    }

    case '/schedule': {
      const schedWork = async () => {
        try {
          const text = await buildScheduleText(env);
          await postEphemeral(channelId, userId, text, env);
        } catch (e) {
          console.error('schedule error:', e);
          await postEphemeral(channelId, userId, '❌ Failed to fetch schedule. Please try again.', env);
        }
      };
      const sp = schedWork();
      if (typeof env._ctx?.waitUntil === 'function') env._ctx.waitUntil(sp);
      return new Response('', { status: 200 });
    }

    case '/about':
      return ephemeral(ABOUT_TEXT);

    case '/ping':
      return ephemeral('pong 🏓');

    default:
      return ephemeral('Unsupported slash command. Use /help to see available commands.');
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    env._ctx = ctx; // expose waitUntil for the interaction handler
    const { pathname } = new URL(request.url);

    if (request.method === 'POST') {
      if (pathname === '/slack/commands') return handleSlashCommand(request, env);
      if (pathname === '/slack/interactions') return handleInteraction(request, env);
    }
    return new Response('Not found', { status: 404 });
  },

};

// Named exports for unit testing — Cloudflare Workers ignore these; only the default export matters.
export { formatSchedule, buildButtonPollBlocks, slugify };
