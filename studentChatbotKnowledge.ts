/** Starter knowledge base for the rule-based Student Chatbot fallback.
 *
 * This file is DATA, not logic: administrators can add, edit, categorize, or
 * remove entries here (or point CHATBOT_KNOWLEDGE_PATH at a JSON file with the
 * same shape) without touching the matching engine in studentChatbot.ts.
 *
 * Conventions:
 * - `keywords` are matched after synonym canonicalization; include common
 *   variants, slang, and both US/UK spellings (enroll/enrol).
 * - `phrases` are matched as substrings of the normalized message.
 * - `{name}` is replaced with the student's name when known.
 * - `verified: true` means the answer is stable product/campus guidance.
 *   Anything policy-, deadline-, or schedule-specific must stay generic and
 *   point at the registrar or official handbook; this bot never invents them.
 */

export type StudentChatbotKnowledgeEntry = {
  id: string;
  category: string;
  verified: boolean;
  /** When set, answering asks a follow-up first instead of replying directly. */
  slot?: string;
  keywords: string[];
  phrases: string[];
  responses: string[];
};

export type StudentChatbotSlot = {
  id: string;
  prompt: string;
  options: Array<{ id: string; keywords: string[]; phrases: string[]; entryId: string }>;
};

export const STUDENT_CHATBOT_SLOTS: StudentChatbotSlot[] = [
  {
    id: 'enrollment_type',
    prompt:
      'I can help with that. Are you asking about the requirements for a new student or a returning student?',
    options: [
      {
        id: 'new',
        keywords: ['new', 'freshman', 'freshmen', 'first-time', 'incoming', 'transfer'],
        phrases: ['new student', 'freshman', 'first time', 'incoming student', 'transferring'],
        entryId: 'enrollment_requirements_new',
      },
      {
        id: 'returning',
        keywords: ['returning', 'continuing', 'old', 'current', 'regular'],
        phrases: ['returning student', 'continuing student', 'current student'],
        entryId: 'enrollment_requirements_returning',
      },
    ],
  },
];

export const STUDENT_CHATBOT_KNOWLEDGE: StudentChatbotKnowledgeEntry[] = [
  {
    id: 'greeting',
    category: 'general',
    verified: true,
    keywords: [
      'hello',
      'hi',
      'hey',
      'yo',
      'sup',
      'morning',
      'afternoon',
      'evening',
      'hiya',
      'howdy',
    ],
    phrases: [
      'good morning',
      'good afternoon',
      'good evening',
      'hey there',
      'hi there',
      'what is up',
    ],
    responses: [
      'Hey{name}! Great to see you. What can I help you with today?',
      'Hello{name}! What do you need help with?',
      'Hi{name}! Ask me about enrollment, classes, study tips, or campus services.',
    ],
  },
  {
    id: 'farewell',
    category: 'general',
    verified: true,
    keywords: ['bye', 'goodbye', 'seeyou', 'later', 'night', 'thanksbye'],
    phrases: ['see you', 'good night', 'talk later', 'got to go', 'gotta go'],
    responses: [
      'Goodbye{name}! Good luck with your classes. I am here if you need anything.',
      'See you later{name}! Hope the rest of your day goes well.',
      'Bye{name}! Come back anytime you have a question.',
    ],
  },
  {
    id: 'thanks',
    category: 'general',
    verified: true,
    keywords: ['thanks', 'thankyou', 'thx', 'ty', 'appreciated', 'grateful'],
    phrases: ['thank you', 'thanks a lot', 'much appreciated'],
    responses: [
      'You are welcome{name}! Anything else I can help with?',
      'Anytime{name}! What else is on your mind?',
      'Glad I could help{name}! Need anything else?',
    ],
  },
  {
    id: 'how_are_you',
    category: 'general',
    verified: true,
    keywords: ['howareyou'],
    phrases: [
      'how are you',
      'how is it going',
      "how's it going",
      'how do you feel',
      'are you okay',
    ],
    responses: [
      'I am running smoothly and ready to help! How are YOU doing today?',
      'Doing great, thanks for asking! What is going on with you?',
      'All systems good here! What can I do for you today?',
    ],
  },
  {
    id: 'who_are_you',
    category: 'general',
    verified: true,
    keywords: ['whoareyou', 'whatdoyoudo', 'yourname'],
    phrases: [
      'who are you',
      'what are you',
      'your name',
      'what do you do',
      'what can you do',
      'are you a robot',
      'are you human',
    ],
    responses: [
      'I am the CourseMates Student Chatbot, a rule-based assistant that answers common student questions. I do not use AI, so my answers come from a fixed knowledge base. What do you need?',
      'I am a built-in student helper here in CourseMates. No AI involved, just programmed answers about enrollment, classes, and campus life. How can I help?',
    ],
  },
  {
    id: 'capabilities',
    category: 'general',
    verified: true,
    keywords: ['help', 'can you help', 'assist', 'support', 'options', 'menu', 'topics'],
    phrases: [
      'can you help',
      'help me',
      'i need help',
      'what can you',
      'show options',
      'list topics',
    ],
    responses: [
      'Of course! I can help with enrollment, subjects and study tips, assignments and exams, schedules, the library, and campus services. Which one is it?',
      'Happy to help! Pick a topic: enrollment, classes, study tips, assignments, exams, schedules, library, or campus services.',
    ],
  },
  {
    id: 'enrollment_process',
    category: 'enrollment',
    verified: false,
    keywords: [
      'enroll',
      'enrol',
      'enrollment',
      'enrolment',
      'register',
      'registration',
      'admission',
      'apply',
    ],
    phrases: [
      'how do i enroll',
      'how to enroll',
      'enrollment process',
      'how do i register',
      'how to register',
      'sign up for classes',
      'how to apply',
    ],
    responses: [
      'Enrollment usually goes like this: confirm your admission offer, submit your requirements, get your study load approved, then claim your class schedule. Are you stuck on the process, the requirements, or your enrollment status?',
      'The general flow is admission confirmation, then requirements, then enlistment in subjects. Which step are you having trouble with: the process, the requirements, or checking your status?',
    ],
  },
  {
    id: 'enrollment_requirements',
    category: 'enrollment',
    verified: false,
    slot: 'enrollment_type',
    keywords: ['requirement', 'requirements', 'document', 'documents', 'papers', 'needed', 'need'],
    phrases: ['what do i need', 'what are the requirements', 'requirements for'],
    responses: [],
  },
  {
    id: 'enrollment_requirements_new',
    category: 'enrollment',
    verified: false,
    keywords: ['freshman', 'newstudent'],
    phrases: ['new student requirements', 'freshman requirements'],
    responses: [
      'New students typically prepare an admission confirmation, birth certificate copy, school records, and ID photos, then follow the registrar checklist. Since requirements change per term, confirm the exact list with your registrar before submitting anything. Want help with the enrollment process too?',
      'For new students it is usually: confirm admission, gather school records and IDs, then submit everything on the registrar schedule. Double-check the official list for this term, since it can change. Anything else about enrollment?',
    ],
  },
  {
    id: 'enrollment_requirements_returning',
    category: 'enrollment',
    verified: false,
    keywords: ['returningstudent'],
    phrases: ['returning student requirements', 'continuing student requirements'],
    responses: [
      'Returning students usually just clear any balances or holds, get grades posted, and enlist in subjects during the enlistment window. Confirm the dates with your registrar so you do not miss the window. Want help planning your schedule?',
      'For returning students it is normally: settle obligations, wait for grades, then enlist in your subjects. Check the official enlistment dates for this term. Can I help with anything else?',
    ],
  },
  {
    id: 'enrollment_status',
    category: 'enrollment',
    verified: false,
    keywords: ['status', 'enlisted', 'verify', 'confirm', 'approved'],
    phrases: [
      'enrollment status',
      'am i enrolled',
      'check my enrollment',
      'my enrollment status',
      'enlistment status',
    ],
    responses: [
      'I cannot look up personal records, but you can check your status in the student portal under enlistment or registration. If it shows a hold or deficiency, the portal usually names the office to visit. Want help with anything else?',
      'Only the official student portal shows your real enrollment status. Log in and look for the registration or enlistment section. If something looks off, contact the registrar directly. What else can I do for you?',
    ],
  },
  {
    id: 'fees',
    category: 'enrollment',
    verified: false,
    keywords: [
      'tuition',
      'fee',
      'fees',
      'payment',
      'pay',
      'balance',
      'finance',
      'billing',
      'scholarship',
      'refund',
      'deadline',
    ],
    phrases: ['how much', 'how to pay', 'tuition fee', 'payment deadline'],
    responses: [
      'I cannot see your personal balance or any payment deadlines, so check the finance or payments section of the student portal for the exact figures. If anything looks wrong, contact the finance office directly. What else can I help with?',
      'For tuition and payments, only the official student portal shows your real balance and due dates. The finance office can confirm anything the portal does not explain. Need help with something else?',
    ],
  },
  {
    id: 'subjects_help',
    category: 'academics',
    verified: false,
    keywords: [
      'subject',
      'subjects',
      'course',
      'courses',
      'class',
      'classes',
      'major',
      'degree',
      'curriculum',
    ],
    phrases: ['what subject', 'which subject', 'choose subject', 'my course', 'my major'],
    responses: [
      'For subject questions, tell me the subject name or code and what is confusing you: the lessons, the requirements, or choosing subjects for next term?',
      'I can help you think through subjects: understanding a topic, picking classes for next term, or handling a difficult professor. Which one is it{name}?',
      'Tell me more: is this about understanding a subject, picking subjects, or managing a heavy load?',
    ],
  },
  {
    id: 'study_tips',
    category: 'academics',
    verified: true,
    keywords: [
      'study',
      'studying',
      'tips',
      'learn',
      'focus',
      'concentrate',
      'memorize',
      'review',
      'pomodoro',
      'habit',
    ],
    phrases: [
      'how to study',
      'study tips',
      'study advice',
      'how do i study',
      'cannot focus',
      "can't focus",
      'how to focus',
    ],
    responses: [
      'Try this: study in 25-minute focused blocks with 5-minute breaks, recall the material from memory instead of re-reading, and review the same topic again after one day. Which subject are you studying{name}?',
      'A simple formula that works: short focused sessions, active recall with flashcards or practice problems, and sleep before an exam instead of cramming all night. What subject is giving you trouble?',
      'Break big topics into tiny daily chunks, test yourself often, and teach the idea to someone else or out loud. That last one exposes gaps fast. What are you working on?',
    ],
  },
  {
    id: 'assignments',
    category: 'academics',
    verified: false,
    keywords: [
      'assignment',
      'homework',
      'project',
      'deadline',
      'submission',
      'submit',
      'essay',
      'report',
      'deadlines',
    ],
    phrases: [
      'my assignment',
      'homework help',
      'how to submit',
      'missed deadline',
      'late submission',
    ],
    responses: [
      'For assignments: start with the rubric, split the work into small daily tasks, and submit early in case the portal acts up. I cannot see your specific assignment, so what part is blocking you?',
      'Tell me where you are stuck: understanding the instructions, starting the work, or submitting it? If you missed a deadline, message your professor right away and ask about late policies.',
    ],
  },
  {
    id: 'exams',
    category: 'academics',
    verified: false,
    keywords: [
      'exam',
      'exams',
      'test',
      'quiz',
      'midterm',
      'finals',
      'boards',
      'failing',
      'grades',
      'grade',
      'gpa',
    ],
    phrases: ['upcoming exam', 'prepare for exam', 'failing grade', 'my grades', 'final exam'],
    responses: [
      'For exams: gather past quizzes and practice under timed conditions, then spend most time on your weakest topics. Sleep beats all-night cramming. Which exam are you preparing for{name}?',
      'Exam game plan: list the topics by confidence, drill the weak ones with practice questions, and do one full timed run before exam day. What subject is the exam for?',
    ],
  },
  {
    id: 'schedule',
    category: 'academics',
    verified: false,
    keywords: [
      'schedule',
      'timetable',
      'time',
      'routine',
      'when',
      'calendar',
      'slot',
      'conflict',
      'class',
    ],
    phrases: ['class schedule', 'my schedule', 'what time', 'timetable'],
    responses: [
      'I cannot see your official class schedule, but it should be in the student portal under registration or enlistment. If two classes conflict, talk to your adviser about section options. Want study-planning tips instead?',
      'Your official schedule lives in the student portal. Screenshot it or copy it into your phone calendar with reminders 15 minutes before each class. Need help organizing study time around it?',
    ],
  },
  {
    id: 'library',
    category: 'campus',
    verified: false,
    keywords: ['library', 'books', 'borrow', 'librarian', 'quiet', 'study area', 'ebook'],
    phrases: ['where is the library', 'borrow books', 'library hours', 'quiet place to study'],
    responses: [
      'The library is your best free resource: quiet floors for deep work, group areas for projects, and librarians who can find sources fast. Check the posted hours at the entrance or the campus page before going. Need study tips too?',
      'For library trips: bring your ID, check the posted borrowing rules, and ask the reference librarian for research help. They are faster than search engines for academic sources. Anything else?',
    ],
  },
  {
    id: 'campus_services',
    category: 'campus',
    verified: false,
    keywords: [
      'dorm',
      'dormitory',
      'housing',
      'cafeteria',
      'canteen',
      'clinic',
      'guidance',
      'counselor',
      'scholarship',
      'registrar',
      'office',
      'id',
      'wifi',
      'parking',
      'shuttle',
    ],
    phrases: [
      'campus services',
      'where is the office',
      'registrar office',
      'guidance office',
      'scholarship',
      'student services',
    ],
    responses: [
      'Common campus stops: the registrar for records and enrollment, guidance for advising, the clinic for health concerns, and student affairs for IDs and scholarships. Tell me which service you need and I will point you in the right direction.',
      'I can point you around: registrar, guidance, library, clinic, or student affairs. Which one are you looking for{name}?',
    ],
  },
  {
    id: 'add_drop',
    category: 'procedures',
    verified: false,
    keywords: ['add', 'drop', 'shift', 'change', 'withdraw', 'transfer', 'shifting', 'dropping'],
    phrases: [
      'add subject',
      'drop subject',
      'change subject',
      'shift course',
      'withdraw subject',
      'drop a class',
    ],
    responses: [
      'Adding or dropping usually has a deadline each term, and dropping after it can affect your record or fees. Check the official academic calendar first, then see your adviser. Do you want to add or drop?',
      'Before adding or dropping: confirm the term deadline in the academic calendar, since late changes can affect grades or fees. Your adviser approves the final change. Which are you planning?',
    ],
  },
  {
    id: 'human_support',
    category: 'general',
    verified: true,
    keywords: [
      'human',
      'agent',
      'staff',
      'contact',
      'complaint',
      'emergency',
      'harassment',
      'report',
    ],
    phrases: [
      'talk to a human',
      'real person',
      'contact support',
      'someone to talk',
      'file a complaint',
      'need help urgently',
    ],
    responses: [
      'I understand you want a real person. I cannot connect you directly, but your campus support desk, guidance office, or registrar can take it from here. If this is urgent or about safety, contact campus security or local emergency services right away.',
      'For things I cannot handle, please reach your campus support desk or guidance counselor directly. In an emergency, always contact campus security or emergency services first.',
    ],
  },
];
