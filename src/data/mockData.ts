import { MatchTopic, AcademicDiscipline, Campus } from '../types';

export const MATCH_TOPICS: MatchTopic[] = [
  {
    id: 'general',
    title: 'Cross-Discipline Discovery',
    category: 'academics',
    icon: 'Sparkles',
    description: 'Meet any fellow Mapúan outside your department for fresh perspective and informal connection.',
    tag: 'All Programs',
  },
  {
    id: 'math-physics',
    title: 'Calculus & Engineering Sciences',
    category: 'academics',
    icon: 'Calculator',
    description: 'Integral calculus, differential equations, physics mechanics, and tough problem set discussions.',
    tag: 'MATH101 / PHYS101',
  },
  {
    id: 'programming-cs',
    title: 'Coding, DSA & Software',
    category: 'tech',
    icon: 'Code2',
    description: 'C++, Python, Java, Data Structures, Web dev, and debugging tricky machine problems.',
    tag: 'CS / IT / CoE',
  },
  {
    id: 'engineering-core',
    title: 'Engineering Core & Design',
    category: 'academics',
    icon: 'Cog',
    description: 'Statics, dynamics, circuits, thermodynamics, CAD drawings, and structural calculations.',
    tag: 'CE / ME / ECE / ChE',
  },
  {
    id: 'thesis-capstone',
    title: 'Thesis & Capstone Ideation',
    category: 'thesis',
    icon: 'GraduationCap',
    description: 'Share project methodologies, hardware component sources, and defense preparation tips.',
    tag: '3rd & 4th Year',
  },
  {
    id: 'internship-career',
    title: 'OJT & Internship Hunt',
    category: 'career',
    icon: 'Briefcase',
    description: 'Company recommendations, resume polish, technical interview prep, and industry leads.',
    tag: 'OJT Prep',
  },
  {
    id: 'campus-food-life',
    title: 'Campus Life & Food Havens',
    category: 'campus',
    icon: 'Coffee',
    description: 'Best cafe study spots in Intramuros and Makati, commute tips, and student hacks.',
    tag: 'Intramuros & Makati',
  },
  {
    id: 'stress-wellness',
    title: 'Term Stress & Venting',
    category: 'stress_relief',
    icon: 'HeartHandshake',
    description: 'Safe, judgment-free peer check-in during midterms and finals hell week.',
    tag: 'Wellness & Chill',
  },
];

export const POPULAR_INTERESTS: string[] = [
  'Coding & Tech',
  'Gaming & Esports',
  'Music & Bands',
  'Anime & Manga',
  'Movies & Series',
  'Coffee & Cafes',
  'Fitness & Gym',
  'Art & Design',
  'Science & Math',
  'Chill & Vent',
  'Books & Literature',
  'Photography',
];

export interface SimulatedPeerPersona {
  handle: string;
  avatar: string;
  discipline?: AcademicDiscipline;
  campus?: Campus;
  interests: string[];
  bio: string;
  defaultIcebreaker: string;
  responseSnippets: {
    greetings: string[];
    academics: string[];
    campus: string[];
    career: string[];
    stress: string[];
    general: string[];
  };
}

export const SIMULATED_PEERS: SimulatedPeerPersona[] = [
  {
    handle: 'Curious Falcon #2847',
    avatar: '🦅',
    discipline: 'Computer Science & IT',
    campus: 'Makati',
    interests: ['Coding & Tech', 'Gaming & Esports', 'Coffee & Cafes'],
    bio: 'Fighting bugs and enjoying chill gaming sessions.',
    defaultIcebreaker: "Hey! What interests got you through this week? Are you into gaming or coding at all?",
    responseSnippets: {
      greetings: [
        "Hey there! Awesome to meet a fellow student. Hope your week is going alright!",
        "Hello! Nice to match with you. What are you usually into outside of classes?",
        "Hi! Glad to connect. I'm just taking a quick study break between coding and gaming."
      ],
      academics: [
        "The pace here really doesn't let up haha! Are you working on any major projects?",
        "One thing that helped me was breaking down tasks into 30-min sprints with good music in the background.",
        "Totally get that! Always nice to meet someone with similar interests."
      ],
      campus: [
        "Finding a quiet coffee spot to listen to lo-fi is my favorite way to recharge.",
        "Honestly, having a solid group of online friends to chat with makes all the difference!"
      ],
      career: [
        "Building cool personal projects and portfolio stuff is what I spend my weekends on.",
        "Networking with fellow students who share the same hobbies is always fun."
      ],
      stress: [
        "Take a breath! You've got this.",
        "I feel that so much. Make sure you hydrate and get some rest!"
      ],
      general: [
        "That's super interesting! What got you interested in that?",
        "Haha exactly! That is so relatable.",
        "That makes total sense! Tell me more."
      ]
    }
  },
  {
    handle: 'Astute Cardinal #8192',
    avatar: '🦁',
    discipline: 'Civil & Environmental Engineering',
    campus: 'Intramuros',
    interests: ['Music & Bands', 'Coffee & Cafes', 'Chill & Vent'],
    bio: 'Big indie music fan and coffee enthusiast.',
    defaultIcebreaker: "Hello! What kind of music or hobbies do you listen to while focusing on study tasks?",
    responseSnippets: {
      greetings: [
        "Kamusta! Great to connect with you anonymously. What kind of music are you into?",
        "Hey! Greetings! How's your week shaping up so far?"
      ],
      academics: [
        "Listening to post-rock and math-rock helps me solve complex math sets so much faster.",
        "Do you prefer studying in absolute silence or with background beats?",
        "Chatting in small anonymous pairs like this is honestly so relaxing."
      ],
      campus: [
        "Grabbing an iced Americano and just sitting outside is my go-to routine.",
        "Finding hidden calm spots is definitely an art form."
      ],
      career: [
        "Balancing side passions with university hustle is definitely the dream.",
        "Gotta stay curious and keep learning new things outside the curriculum!"
      ],
      stress: [
        "Remember to take breaks! Your mental wellbeing always comes first.",
        "Let's put on some good vibes and power through the rest of the day!"
      ],
      general: [
        "Love that interest! It's so cool how much we have in common.",
        "100% agreed! Super glad we matched."
      ]
    }
  },
  {
    handle: 'Quantum Hawk #4019',
    avatar: '⚡',
    discipline: 'Electrical, Electronics & Computer Engineering',
    campus: 'Intramuros',
    interests: ['Science & Math', 'Coding & Tech', 'Anime & Manga'],
    bio: 'Tech tinkerer, anime watcher, and science nerd.',
    defaultIcebreaker: "Hey! Seen any great anime, shows, or tech breakthroughs lately?",
    responseSnippets: {
      greetings: [
        "Hey there! Cool handle! Glad we matched in the queue.",
        "Hi! Fellow nerd here. How's the week treating you?"
      ],
      academics: [
        "Breaking down complex science concepts into everyday analogies is super satisfying.",
        "Are you learning anything new on YouTube or Coursera right now?"
      ],
      campus: [
        "Catching up on seasonal anime episodes between study blocks is my reward system haha.",
        "Pro tip: high caffeine plus good anime OSTs equals maximum focus."
      ],
      career: [
        "Building hardware and coding smart gadgets is where my real excitement lies.",
        "Always excited to meet other students passionate about technology!"
      ],
      stress: [
        "Hang in there! One step at a time.",
        "Don't worry, every tough challenge is just an experience point leveled up."
      ],
      general: [
        "That's a really solid point.",
        "Glad we connected on this! Keep up that great energy."
      ]
    }
  },
  {
    handle: 'Resilient Tamaraw #5521',
    avatar: '📐',
    discipline: 'Architecture & Industrial Design',
    campus: 'Intramuros',
    interests: ['Art & Design', 'Movies & Series', 'Photography'],
    bio: 'Visual artist, cinema buff, and late-night sketcher.',
    defaultIcebreaker: "Hi! What's a movie, series, or visual art style that you've been obsessed with recently?",
    responseSnippets: {
      greetings: [
        "Hello! Nice to meet you. Always excited to meet other creative minds!",
        "Hey! Always happy to connect and chat about art and life."
      ],
      academics: [
        "Design thinking applies to everything, from movies to coding and daily life.",
        "Visual storytelling is so powerful."
      ],
      campus: [
        "Walking around taking street photos is such a great reset after studying.",
        "Finding inspiration in everyday architecture and lighting is so fun."
      ],
      career: [
        "Building a creative portfolio and exploring different mediums is my main drive.",
        "Hoping to collaborate on cool multimedia projects!"
      ],
      stress: [
        "Remember to hydrate and take deep breaths!",
        "We got this! One project down, next one to go."
      ],
      general: [
        "That sounds fascinating! Tell me more about your favorite projects.",
        "Totally. That's why anonymous chat is so refreshing—no ego, just real interests."
      ]
    }
  }
];

export const MAPUA_PROGRAMS: AcademicDiscipline[] = [
  'Computer Science & IT',
  'Civil & Environmental Engineering',
  'Mechanical & Manufacturing Engineering',
  'Electrical, Electronics & Computer Engineering',
  'Architecture & Industrial Design',
  'Business & Management',
  'Media & Visual Arts',
  'Chemical & Materials Engineering',
  'Health & Life Sciences',
];

export const MAPUA_CAMPUSES: Campus[] = [
  'Intramuros',
  'Makati',
  'Laguna',
  'Digital / Online',
];
