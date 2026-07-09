import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';

export const maxDuration = 60;

// ── Firebase ──
const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const db = getFirestore(app);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });

// ── Constants ──
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const STALE_SERVE_MS = 12 * 60 * 60 * 1000; // 12 hours — serve stale, skip refresh
const SUMMARY_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days for individual AI summaries
const MAX_BILLS = 50; // Max bills to cache per state
const MAX_AI_PER_REQUEST = 15; // Max bills to AI-summarize in one request

// ── AI Prompt ──
const STATE_BILL_PROMPT = `You are an expert, neutral, nonpartisan civic analyst specializing in state legislation.
Summarize each state bill. For the "generalSummary" field, explain the SPECIFIC policy change in 2 sentences max.
NEVER write vague summaries like "addresses issues related to X" or "deals with matters concerning Y".
Explain what the bill CREATES, FUNDS, BANS, REQUIRES, or CHANGES. Use plain English a normal person can understand.

For "impactLevel", classify:
- "High Impact": Bills affecting daily life — taxes, healthcare, housing, education, environment, policing, guns, immigration, water, insurance, rent.
- "Moderate Impact": Bills affecting specific industries or groups — regulatory changes, agency funding, infrastructure.
- "Low Impact": Symbolic — naming, designating, honoring, recognition, awareness.

For "status", classify based on the latestAction:
- "Introduced": Only if action says "introduced" or "read first time".
- "In Committee": "referred to committee", "hearing scheduled", "ordered to be reported".
- "Reported": "placed on calendar", "reported by committee".
- "Passed House": "passed assembly", "passed house", "third reading".
- "Passed Senate": "passed senate".
- "Passed Both Chambers": Passed both chambers.
- "Signed into Law": "signed", "chaptered", "enacted".
- "Failed": "failed", "vetoed", "died in committee".
Do NOT label a bill "Introduced" if it has progressed past introduction.

Return ONLY valid JSON:
{ "bills": [ { "id": "...", "shortTitle": "...", "generalSummary": "...", "impactLevel": "...", "status": "..." } ] }`;

// ── Zip → State mapping ──
const zipToState = {
    '005': 'NY', '006': 'PR', '007': 'PR', '008': 'VI', '009': 'PR',
    '010': 'MA', '011': 'MA', '012': 'MA', '013': 'MA', '014': 'MA',
    '015': 'MA', '016': 'MA', '017': 'MA', '018': 'MA', '019': 'MA',
    '020': 'MA', '021': 'MA', '022': 'MA', '023': 'MA', '024': 'MA',
    '025': 'MA', '026': 'MA', '027': 'MA',
    '028': 'RI', '029': 'RI',
    '030': 'NH', '031': 'NH', '032': 'NH', '033': 'NH', '034': 'NH',
    '035': 'NH', '036': 'NH', '037': 'NH', '038': 'NH',
    '039': 'ME', '040': 'ME', '041': 'ME', '042': 'ME', '043': 'ME',
    '044': 'ME', '045': 'ME', '046': 'ME', '047': 'ME', '048': 'ME',
    '049': 'ME',
    '050': 'VT', '051': 'VT', '052': 'VT', '053': 'VT', '054': 'VT',
    '055': 'VT', '056': 'VT', '057': 'VT', '058': 'VT', '059': 'VT',
    '060': 'CT', '061': 'CT', '062': 'CT', '063': 'CT', '064': 'CT',
    '065': 'CT', '066': 'CT', '067': 'CT', '068': 'CT', '069': 'CT',
    '070': 'NJ', '071': 'NJ', '072': 'NJ', '073': 'NJ', '074': 'NJ',
    '075': 'NJ', '076': 'NJ', '077': 'NJ', '078': 'NJ', '079': 'NJ',
    '080': 'NJ', '081': 'NJ', '082': 'NJ', '083': 'NJ', '084': 'NJ',
    '085': 'NJ', '086': 'NJ', '087': 'NJ', '088': 'NJ', '089': 'NJ',
    '100': 'NY', '101': 'NY', '102': 'NY', '103': 'NY', '104': 'NY',
    '105': 'NY', '106': 'NY', '107': 'NY', '108': 'NY', '109': 'NY',
    '110': 'NY', '111': 'NY', '112': 'NY', '113': 'NY', '114': 'NY',
    '115': 'NY', '116': 'NY', '117': 'NY', '118': 'NY', '119': 'NY',
    '120': 'NY', '121': 'NY', '122': 'NY', '123': 'NY', '124': 'NY',
    '125': 'NY', '126': 'NY', '127': 'NY', '128': 'NY', '129': 'NY',
    '130': 'NY', '131': 'NY', '132': 'NY', '133': 'NY', '134': 'NY',
    '135': 'NY', '136': 'NY', '137': 'NY', '138': 'NY', '139': 'NY',
    '140': 'NY', '141': 'NY', '142': 'NY', '143': 'NY', '144': 'NY',
    '145': 'NY', '146': 'NY', '147': 'NY', '148': 'NY', '149': 'NY',
    '150': 'PA', '151': 'PA', '152': 'PA', '153': 'PA', '154': 'PA',
    '155': 'PA', '156': 'PA', '157': 'PA', '158': 'PA', '159': 'PA',
    '160': 'PA', '161': 'PA', '162': 'PA', '163': 'PA', '164': 'PA',
    '165': 'PA', '166': 'PA', '167': 'PA', '168': 'PA', '169': 'PA',
    '170': 'PA', '171': 'PA', '172': 'PA', '173': 'PA', '174': 'PA',
    '175': 'PA', '176': 'PA', '177': 'PA', '178': 'PA', '179': 'PA',
    '180': 'PA', '181': 'PA', '182': 'PA', '183': 'PA', '184': 'PA',
    '185': 'PA', '186': 'PA', '187': 'PA', '188': 'PA', '189': 'PA',
    '190': 'PA', '191': 'PA', '192': 'PA', '193': 'PA', '194': 'PA',
    '195': 'PA', '196': 'PA',
    '197': 'DE', '198': 'DE', '199': 'DE',
    '200': 'DC', '201': 'VA', '202': 'DC', '203': 'DC', '204': 'DC',
    '205': 'DC', '206': 'MD', '207': 'MD', '208': 'MD', '209': 'MD',
    '210': 'MD', '211': 'MD', '212': 'MD', '214': 'MD', '215': 'MD',
    '216': 'MD', '217': 'MD', '218': 'MD', '219': 'MD',
    '220': 'VA', '221': 'VA', '222': 'VA', '223': 'VA', '224': 'VA',
    '225': 'VA', '226': 'VA', '227': 'VA', '228': 'VA', '229': 'VA',
    '230': 'VA', '231': 'VA', '232': 'VA', '233': 'VA', '234': 'VA',
    '235': 'VA', '236': 'VA', '237': 'VA', '238': 'VA', '239': 'VA',
    '240': 'VA', '241': 'VA', '242': 'VA', '243': 'VA', '244': 'VA',
    '245': 'VA', '246': 'VA',
    '247': 'WV', '248': 'WV', '249': 'WV', '250': 'WV', '251': 'WV',
    '252': 'WV', '253': 'WV', '254': 'WV', '255': 'WV', '256': 'WV',
    '257': 'WV', '258': 'WV', '259': 'WV', '260': 'WV', '261': 'WV',
    '262': 'WV', '263': 'WV', '264': 'WV', '265': 'WV', '266': 'WV',
    '267': 'WV', '268': 'WV',
    '270': 'NC', '271': 'NC', '272': 'NC', '273': 'NC', '274': 'NC',
    '275': 'NC', '276': 'NC', '277': 'NC', '278': 'NC', '279': 'NC',
    '280': 'NC', '281': 'NC', '282': 'NC', '283': 'NC', '284': 'NC',
    '285': 'NC', '286': 'NC', '287': 'NC', '288': 'NC', '289': 'NC',
    '290': 'SC', '291': 'SC', '292': 'SC', '293': 'SC', '294': 'SC',
    '295': 'SC', '296': 'SC', '297': 'SC', '298': 'SC', '299': 'SC',
    '300': 'GA', '301': 'GA', '302': 'GA', '303': 'GA', '304': 'GA',
    '305': 'GA', '306': 'GA', '307': 'GA', '308': 'GA', '309': 'GA',
    '310': 'GA', '311': 'GA', '312': 'GA', '313': 'GA', '314': 'GA',
    '315': 'GA', '316': 'GA', '317': 'GA', '318': 'GA', '319': 'GA',
    '320': 'FL', '321': 'FL', '322': 'FL', '323': 'FL', '324': 'FL',
    '325': 'FL', '326': 'FL', '327': 'FL', '328': 'FL', '329': 'FL',
    '330': 'FL', '331': 'FL', '332': 'FL', '333': 'FL', '334': 'FL',
    '335': 'FL', '336': 'FL', '337': 'FL', '338': 'FL', '339': 'FL',
    '340': 'AA', '341': 'FL', '342': 'FL', '344': 'FL', '346': 'FL',
    '347': 'FL', '349': 'FL',
    '350': 'AL', '351': 'AL', '352': 'AL', '354': 'AL', '355': 'AL',
    '356': 'AL', '357': 'AL', '358': 'AL', '359': 'AL', '360': 'AL',
    '361': 'AL', '362': 'AL', '363': 'AL', '364': 'AL', '365': 'AL',
    '366': 'AL', '367': 'AL', '368': 'AL',
    '369': 'MS',
    '370': 'TN', '371': 'TN', '372': 'TN', '373': 'TN', '374': 'TN',
    '375': 'TN', '376': 'TN', '377': 'TN', '378': 'TN', '379': 'TN',
    '380': 'TN', '381': 'TN', '382': 'TN', '383': 'TN', '384': 'TN',
    '385': 'TN',
    '386': 'MS', '387': 'MS', '388': 'MS', '389': 'MS', '390': 'MS',
    '391': 'MS', '392': 'MS', '393': 'MS', '394': 'MS', '395': 'MS',
    '396': 'MS', '397': 'MS',
    '400': 'KY', '401': 'KY', '402': 'KY', '403': 'KY', '404': 'KY',
    '405': 'KY', '406': 'KY', '407': 'KY', '408': 'KY', '409': 'KY',
    '410': 'KY', '411': 'KY', '412': 'KY', '413': 'KY', '414': 'KY',
    '415': 'KY', '416': 'KY', '417': 'KY', '418': 'KY',
    '420': 'OH', '421': 'OH', '422': 'OH', '423': 'OH', '424': 'OH',
    '425': 'OH', '426': 'OH', '427': 'OH', '428': 'OH', '429': 'OH',
    '430': 'OH', '431': 'OH', '432': 'OH', '433': 'OH', '434': 'OH',
    '435': 'OH', '436': 'OH', '437': 'OH', '438': 'OH', '439': 'OH',
    '440': 'OH', '441': 'OH', '442': 'OH', '443': 'OH', '444': 'OH',
    '445': 'OH', '446': 'OH', '447': 'OH', '448': 'OH', '449': 'OH',
    '450': 'OH', '451': 'OH', '452': 'OH', '453': 'OH', '454': 'OH',
    '455': 'OH', '456': 'OH', '457': 'OH', '458': 'OH',
    '460': 'IN', '461': 'IN', '462': 'IN', '463': 'IN', '464': 'IN',
    '465': 'IN', '466': 'IN', '467': 'IN', '468': 'IN', '469': 'IN',
    '470': 'IN', '471': 'IN', '472': 'IN', '473': 'IN', '474': 'IN',
    '475': 'IN', '476': 'IN', '477': 'IN', '478': 'IN', '479': 'IN',
    '480': 'MI', '481': 'MI', '482': 'MI', '483': 'MI', '484': 'MI',
    '485': 'MI', '486': 'MI', '487': 'MI', '488': 'MI', '489': 'MI',
    '490': 'MI', '491': 'MI', '492': 'MI', '493': 'MI', '494': 'MI',
    '495': 'MI', '496': 'MI', '497': 'MI', '498': 'MI', '499': 'MI',
    '500': 'IA', '501': 'IA', '502': 'IA', '503': 'IA', '504': 'IA',
    '505': 'IA', '506': 'IA', '507': 'IA', '508': 'IA', '509': 'IA',
    '510': 'IA', '511': 'IA', '512': 'IA', '513': 'IA', '514': 'IA',
    '515': 'IA', '516': 'IA', '520': 'IA', '521': 'IA', '522': 'IA',
    '523': 'IA', '524': 'IA', '525': 'IA', '526': 'IA', '527': 'IA',
    '528': 'IA',
    '530': 'WI', '531': 'WI', '532': 'WI', '534': 'WI', '535': 'WI',
    '537': 'WI', '538': 'WI', '539': 'WI', '540': 'WI', '541': 'WI',
    '542': 'WI', '543': 'WI', '544': 'WI', '545': 'WI', '546': 'WI',
    '547': 'WI', '548': 'WI', '549': 'WI',
    '550': 'MN', '551': 'MN', '553': 'MN', '554': 'MN', '555': 'MN',
    '556': 'MN', '557': 'MN', '558': 'MN', '559': 'MN', '560': 'MN',
    '561': 'MN', '562': 'MN', '563': 'MN', '564': 'MN', '565': 'MN',
    '566': 'MN', '567': 'MN',
    '570': 'SD', '571': 'SD', '572': 'SD', '573': 'SD', '574': 'SD',
    '575': 'SD', '576': 'SD', '577': 'SD',
    '580': 'ND', '581': 'ND', '582': 'ND', '583': 'ND', '584': 'ND',
    '585': 'ND', '586': 'ND', '587': 'ND', '588': 'ND',
    '590': 'MT', '591': 'MT', '592': 'MT', '593': 'MT', '594': 'MT',
    '595': 'MT', '596': 'MT', '597': 'MT', '598': 'MT', '599': 'MT',
    '600': 'IL', '601': 'IL', '602': 'IL', '603': 'IL', '604': 'IL',
    '605': 'IL', '606': 'IL', '607': 'IL', '608': 'IL', '609': 'IL',
    '610': 'IL', '611': 'IL', '612': 'IL', '613': 'IL', '614': 'IL',
    '615': 'IL', '616': 'IL', '617': 'IL', '618': 'IL', '619': 'IL',
    '620': 'IL', '622': 'IL', '623': 'IL', '624': 'IL', '625': 'IL',
    '626': 'IL', '627': 'IL', '628': 'IL', '629': 'IL',
    '630': 'MO', '631': 'MO', '633': 'MO', '634': 'MO', '635': 'MO',
    '636': 'MO', '637': 'MO', '638': 'MO', '639': 'MO', '640': 'MO',
    '641': 'MO', '644': 'MO', '645': 'MO', '646': 'MO', '647': 'MO',
    '648': 'MO', '649': 'MO', '650': 'MO', '651': 'MO', '652': 'MO',
    '653': 'MO', '654': 'MO', '655': 'MO', '656': 'MO', '657': 'MO',
    '658': 'MO',
    '660': 'KS', '661': 'KS', '662': 'KS', '664': 'KS', '665': 'KS',
    '666': 'KS', '667': 'KS', '668': 'KS', '669': 'KS', '670': 'KS',
    '671': 'KS', '672': 'KS', '673': 'KS', '674': 'KS', '675': 'KS',
    '676': 'KS', '677': 'KS', '678': 'KS', '679': 'KS',
    '680': 'NE', '681': 'NE', '683': 'NE', '684': 'NE', '685': 'NE',
    '686': 'NE', '687': 'NE', '688': 'NE', '689': 'NE', '690': 'NE',
    '691': 'NE', '692': 'NE', '693': 'NE',
    '700': 'LA', '701': 'LA', '703': 'LA', '704': 'LA', '705': 'LA',
    '706': 'LA', '707': 'LA', '708': 'LA', '710': 'LA', '711': 'LA',
    '712': 'LA', '713': 'LA', '714': 'LA',
    '716': 'AR', '717': 'AR', '718': 'AR', '719': 'AR', '720': 'AR',
    '721': 'AR', '722': 'AR', '723': 'AR', '724': 'AR', '725': 'AR',
    '726': 'AR', '727': 'AR', '728': 'AR', '729': 'AR',
    '730': 'OK', '731': 'OK', '734': 'OK', '735': 'OK', '736': 'OK',
    '737': 'OK', '738': 'OK', '739': 'OK', '740': 'OK', '741': 'OK',
    '743': 'OK', '744': 'OK', '745': 'OK', '746': 'OK', '747': 'OK',
    '748': 'OK', '749': 'OK',
    '750': 'TX', '751': 'TX', '752': 'TX', '753': 'TX', '754': 'TX',
    '755': 'TX', '756': 'TX', '757': 'TX', '758': 'TX', '759': 'TX',
    '760': 'TX', '761': 'TX', '762': 'TX', '763': 'TX', '764': 'TX',
    '765': 'TX', '766': 'TX', '767': 'TX', '768': 'TX', '769': 'TX',
    '770': 'TX', '771': 'TX', '772': 'TX', '773': 'TX', '774': 'TX',
    '775': 'TX', '776': 'TX', '777': 'TX', '778': 'TX', '779': 'TX',
    '780': 'TX', '781': 'TX', '782': 'TX', '783': 'TX', '784': 'TX',
    '785': 'TX', '786': 'TX', '787': 'TX', '788': 'TX', '789': 'TX',
    '790': 'TX', '791': 'TX', '792': 'TX', '793': 'TX', '794': 'TX',
    '795': 'TX', '796': 'TX', '797': 'TX', '798': 'TX', '799': 'TX',
    '800': 'CO', '801': 'CO', '802': 'CO', '803': 'CO', '804': 'CO',
    '805': 'CO', '806': 'CO', '807': 'CO', '808': 'CO', '809': 'CO',
    '810': 'CO', '811': 'CO', '812': 'CO', '813': 'CO', '814': 'CO',
    '815': 'CO', '816': 'CO',
    '820': 'WY', '821': 'WY', '822': 'WY', '823': 'WY', '824': 'WY',
    '825': 'WY', '826': 'WY', '827': 'WY', '828': 'WY', '829': 'WY',
    '830': 'WY', '831': 'WY',
    '832': 'ID', '833': 'ID', '834': 'ID', '835': 'ID', '836': 'ID',
    '837': 'ID', '838': 'ID',
    '840': 'UT', '841': 'UT', '842': 'UT', '843': 'UT', '844': 'UT',
    '845': 'UT', '846': 'UT', '847': 'UT',
    '850': 'AZ', '851': 'AZ', '852': 'AZ', '853': 'AZ', '855': 'AZ',
    '856': 'AZ', '857': 'AZ', '859': 'AZ', '860': 'AZ',
    '863': 'NM', '864': 'NM', '865': 'NM',
    '870': 'NM', '871': 'NM', '873': 'NM', '874': 'NM', '875': 'NM',
    '877': 'NM', '878': 'NM', '879': 'NM', '880': 'NM', '881': 'NM',
    '882': 'NM', '883': 'NM', '884': 'NM',
    '889': 'NV', '890': 'NV', '891': 'NV', '893': 'NV', '894': 'NV',
    '895': 'NV', '897': 'NV', '898': 'NV',
    '900': 'CA', '901': 'CA', '902': 'CA', '903': 'CA', '904': 'CA',
    '905': 'CA', '906': 'CA', '907': 'CA', '908': 'CA', '910': 'CA',
    '911': 'CA', '912': 'CA', '913': 'CA', '914': 'CA', '915': 'CA',
    '916': 'CA', '917': 'CA', '918': 'CA', '919': 'CA', '920': 'CA',
    '921': 'CA', '922': 'CA', '923': 'CA', '924': 'CA', '925': 'CA',
    '926': 'CA', '927': 'CA', '928': 'CA', '930': 'CA', '931': 'CA',
    '932': 'CA', '933': 'CA', '934': 'CA', '935': 'CA', '936': 'CA',
    '937': 'CA', '938': 'CA', '939': 'CA', '940': 'CA', '941': 'CA',
    '942': 'CA', '943': 'CA', '944': 'CA', '945': 'CA', '946': 'CA',
    '947': 'CA', '948': 'CA', '949': 'CA', '950': 'CA', '951': 'CA',
    '952': 'CA', '953': 'CA', '954': 'CA', '955': 'CA', '956': 'CA',
    '957': 'CA', '958': 'CA', '959': 'CA', '960': 'CA', '961': 'CA',
    '967': 'HI', '968': 'HI',
    '970': 'OR', '971': 'OR', '972': 'OR', '973': 'OR', '974': 'OR',
    '975': 'OR', '976': 'OR', '977': 'OR', '978': 'OR', '979': 'OR',
    '980': 'WA', '981': 'WA', '982': 'WA', '983': 'WA', '984': 'WA',
    '985': 'WA', '986': 'WA', '988': 'WA', '989': 'WA', '990': 'WA',
    '991': 'WA', '992': 'WA', '993': 'WA', '994': 'WA',
    '995': 'AK', '996': 'AK', '997': 'AK', '998': 'AK', '999': 'AK',
};

const stateNames = {
    'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas',
    'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware',
    'DC': 'District of Columbia', 'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii',
    'ID': 'Idaho', 'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa',
    'KS': 'Kansas', 'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine',
    'MD': 'Maryland', 'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota',
    'MS': 'Mississippi', 'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska',
    'NV': 'Nevada', 'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico',
    'NY': 'New York', 'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio',
    'OK': 'Oklahoma', 'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island',
    'SC': 'South Carolina', 'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas',
    'UT': 'Utah', 'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington',
    'WV': 'West Virginia', 'WI': 'Wisconsin', 'WY': 'Wyoming',
};

function getStateFromZip(zipCode) {
    const prefix = zipCode.substring(0, 3);
    return zipToState[prefix] || null;
}

// ── Firestore cache helpers ──

async function getStateFeedCache(stateAbbr) {
    try {
        const snap = await getDoc(doc(db, 'stateFeedCache', stateAbbr));
        if (!snap.exists()) return null;
        return snap.data();
    } catch { return null; }
}

async function saveStateFeedCache(stateAbbr, items, stateName) {
    try {
        await setDoc(doc(db, 'stateFeedCache', stateAbbr), {
            items: items.slice(0, MAX_BILLS),
            stateName,
            cachedAt: Date.now(),
        });
    } catch (e) {
        console.warn(`[state-feed] Cache save failed (${stateAbbr}):`, e.message);
    }
}

async function getCachedSummary(id) {
    try {
        const snap = await getDoc(doc(db, 'billSummaries', id));
        if (!snap.exists()) return null;
        const data = snap.data();
        if (Date.now() - (data.cachedAt || 0) > SUMMARY_CACHE_TTL_MS) return null;
        return data;
    } catch { return null; }
}

async function cacheSummary(id, data) {
    try { await setDoc(doc(db, 'billSummaries', id), { ...data, cachedAt: Date.now() }); }
    catch (e) { console.warn('[state-feed] Summary cache write failed:', e.message); }
}

// ── AI summarization ──

async function summarizeWithAI(bills, stateAbbr, stateName) {
    if (bills.length === 0) return [];

    const startTime = Date.now();
    const billTexts = bills.map(b =>
        `ID: ${b.id}\nTitle: ${b.originalTitle}\nState: ${stateName}\nLatest Action: ${b.latestAction}\nDate: ${b.date}\nAbstract: ${b.fullSummary || 'None'}`
    ).join('\n---\n');

    try {
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            temperature: 0.3,
            max_tokens: 3000,
            messages: [
                { role: 'system', content: STATE_BILL_PROMPT },
                { role: 'user', content: `Summarize these ${stateName} state bills:\n\n${billTexts}` },
            ],
        });

        let parsed;
        try {
            const raw = completion.choices[0].message.content
                .replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
            parsed = JSON.parse(raw);
        } catch (parseErr) {
            console.warn('[state-feed] AI response parse failed:', parseErr.message);
            return [];
        }

        const aiResults = parsed.bills || [];
        console.log(`[state-feed] AI summarized ${aiResults.length}/${bills.length} bills in ${Date.now() - startTime}ms`);
        return aiResults;
    } catch (e) {
        console.error('[state-feed] AI call failed:', e.message);
        return [];
    }
}

// ── Transform OpenStates bill to FeedCard format ──

function transformBill(bill, stateAbbr, stateName) {
    const abstract = bill.abstracts && bill.abstracts.length > 0 ? bill.abstracts[0].abstract : '';
    return {
        id: `state-${stateAbbr}-${bill.identifier}`,
        shortTitle: bill.title.length > 60 ? bill.title.substring(0, 57) + '...' : bill.title,
        originalTitle: bill.title,
        url: bill.openstates_url || '',
        type: 'Bill',
        level: 'State',
        state: stateAbbr,
        stateName: stateName,
        date: bill.latest_action_date || bill.first_action_date || '',
        latestActionDate: bill.latest_action_date || bill.first_action_date || '',
        generalSummary: '', // Will be filled by AI
        fullSummary: abstract || '',
        impactLevel: 'Moderate Impact', // Will be overridden by AI
        status: 'Introduced', // Will be overridden by AI
        latestAction: bill.latest_action_description || '',
        tagImpacts: {},
        sponsors: [],
        locationMatches: [stateAbbr],
        likes: 0,
        dislikes: 0,
        subjects: bill.subject || [],
        billIdentifier: bill.identifier,
    };
}

// ── Main handler ──

export async function POST(request) {
    try {
        const { zipCode, page, perPage } = await request.json();

        if (!zipCode) {
            return NextResponse.json({ error: 'Zip code required' }, { status: 400 });
        }

        const stateAbbr = getStateFromZip(zipCode);
        if (!stateAbbr || !stateNames[stateAbbr]) {
            return NextResponse.json({ error: 'Could not determine state from zip code' }, { status: 400 });
        }

        const stateName = stateNames[stateAbbr];
        const apiKey = process.env.OPENSTATES_API_KEY;

        if (!apiKey) {
            return NextResponse.json({ error: 'OpenStates API key not configured' }, { status: 500 });
        }

        const pageNum = page || 1;
        const itemsPerPage = perPage || 15;

        // ── Step 1: Check Firestore cache ──
        const cached = await getStateFeedCache(stateAbbr);
        const now = Date.now();

        if (cached && cached.items && cached.items.length > 0) {
            const age = now - (cached.cachedAt || 0);

            if (age < CACHE_TTL_MS) {
                // Fresh cache — serve immediately
                console.log(`[state-feed] ${stateAbbr}: serving from fresh cache (${(age / 60000).toFixed(0)}min old, ${cached.items.length} items)`);
                const start = (pageNum - 1) * itemsPerPage;
                const pageItems = cached.items.slice(start, start + itemsPerPage);
                return NextResponse.json({
                    items: pageItems,
                    hasMore: start + itemsPerPage < cached.items.length,
                    nextPage: pageNum + 1,
                    state: stateAbbr,
                    stateName,
                    totalItems: cached.items.length,
                });
            }

            if (age < STALE_SERVE_MS) {
                // Stale but usable — serve stale, don't block on refresh
                console.log(`[state-feed] ${stateAbbr}: serving stale cache (${(age / 3600000).toFixed(1)}h old), refresh deferred`);
                const start = (pageNum - 1) * itemsPerPage;
                const pageItems = cached.items.slice(start, start + itemsPerPage);
                return NextResponse.json({
                    items: pageItems,
                    hasMore: start + itemsPerPage < cached.items.length,
                    nextPage: pageNum + 1,
                    state: stateAbbr,
                    stateName,
                    totalItems: cached.items.length,
                });
            }
        }

        // ── Step 2: Fetch fresh from OpenStates ──
        // OpenStates caps per_page at 20, so fetch 3 pages in parallel to get ~60 bills
        console.log(`[state-feed] ${stateAbbr}: cache miss or expired, fetching from OpenStates...`);

        const makeUrl = (pg) => `https://v3.openstates.org/bills?jurisdiction=${stateName}&sort=updated_desc&per_page=20&page=${pg}&include=abstracts&apikey=${apiKey}`;

        const pageResults = await Promise.allSettled([
            fetch(makeUrl(1), { signal: AbortSignal.timeout(12000) }).then(r => r.ok ? r.json() : Promise.reject(r.status)),
            fetch(makeUrl(2), { signal: AbortSignal.timeout(12000) }).then(r => r.ok ? r.json() : Promise.reject(r.status)),
            fetch(makeUrl(3), { signal: AbortSignal.timeout(12000) }).then(r => r.ok ? r.json() : Promise.reject(r.status)),
        ]);

        const rawBills = [];
        for (const result of pageResults) {
            if (result.status === 'fulfilled' && result.value.results) {
                rawBills.push(...result.value.results);
            }
        }

        if (rawBills.length === 0) {
            // All pages failed — try stale cache
            if (cached && cached.items && cached.items.length > 0) {
                console.log(`[state-feed] ${stateAbbr}: all pages failed, falling back to stale cache`);
                const start = (pageNum - 1) * itemsPerPage;
                const pageItems = cached.items.slice(start, start + itemsPerPage);
                return NextResponse.json({
                    items: pageItems,
                    hasMore: start + itemsPerPage < cached.items.length,
                    nextPage: pageNum + 1,
                    state: stateAbbr,
                    stateName,
                    totalItems: cached.items.length,
                });
            }
        }

        console.log(`[state-feed] ${stateAbbr}: fetched ${rawBills.length} bills from OpenStates (${pageResults.filter(r => r.status === 'fulfilled').length}/3 pages)`);

        if (rawBills.length === 0) {
            return NextResponse.json({
                items: [],
                hasMore: false,
                nextPage: 1,
                state: stateAbbr,
                stateName,
                totalItems: 0,
            });
        }

        // ── Step 3: Transform bills ──
        const items = rawBills.map(bill => transformBill(bill, stateAbbr, stateName));

        // ── Step 4: Check for existing AI summaries ──
        const summaryLookups = await Promise.all(items.map(item => getCachedSummary(item.id)));

        const needsAI = [];
        items.forEach((item, i) => {
            if (summaryLookups[i]) {
                // Use cached AI summary
                item.generalSummary = summaryLookups[i].generalSummary || item.generalSummary;
                item.impactLevel = summaryLookups[i].impactLevel || item.impactLevel;
                item.status = summaryLookups[i].status || item.status;
                item.shortTitle = summaryLookups[i].shortTitle || item.shortTitle;
            } else {
                needsAI.push(item);
            }
        });

        console.log(`[state-feed] ${stateAbbr}: ${items.length - needsAI.length} cached, ${needsAI.length} need AI`);

        // ── Step 5: AI-summarize uncached bills ──
        if (needsAI.length > 0) {
            const toProcess = needsAI.slice(0, MAX_AI_PER_REQUEST);
            const aiResults = await summarizeWithAI(toProcess, stateAbbr, stateName);

            // Match AI results back to items and cache them
            const aiMap = {};
            aiResults.forEach(r => { if (r.id) aiMap[r.id] = r; });

            await Promise.all(toProcess.map(item => {
                const ai = aiMap[item.id];
                if (ai) {
                    item.generalSummary = ai.generalSummary || item.fullSummary || `${item.originalTitle} — a ${stateName} state bill.`;
                    item.impactLevel = ai.impactLevel || item.impactLevel;
                    item.status = ai.status || item.status;
                    item.shortTitle = ai.shortTitle || item.shortTitle;
                    return cacheSummary(item.id, {
                        generalSummary: item.generalSummary,
                        impactLevel: item.impactLevel,
                        status: item.status,
                        shortTitle: item.shortTitle,
                    });
                } else {
                    // AI didn't return this bill — use fallback
                    item.generalSummary = item.fullSummary || `${item.originalTitle} — a ${stateName} state bill.`;
                    return Promise.resolve();
                }
            }));

            // Any bills beyond the cap — give them fallback summaries
            needsAI.slice(MAX_AI_PER_REQUEST).forEach(item => {
                item.generalSummary = item.fullSummary || `${item.originalTitle} — a ${stateName} state bill.`;
            });
        }

        // ── Step 6: Cache the full index ──
        await saveStateFeedCache(stateAbbr, items, stateName);

        // ── Step 7: Paginate and return ──
        const start = (pageNum - 1) * itemsPerPage;
        const pageItems = items.slice(start, start + itemsPerPage);

        return NextResponse.json({
            items: pageItems,
            hasMore: start + itemsPerPage < items.length,
            nextPage: pageNum + 1,
            state: stateAbbr,
            stateName,
            totalItems: items.length,
        });

    } catch (error) {
        console.error('[state-feed] Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
