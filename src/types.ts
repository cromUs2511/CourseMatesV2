export type Campus = 'Intramuros' | 'Makati' | 'Laguna' | 'Digital / Online';

export type AcademicDiscipline =
  | 'Computer Science & IT'
  | 'Civil & Environmental Engineering'
  | 'Mechanical & Manufacturing Engineering'
  | 'Electrical, Electronics & Computer Engineering'
  | 'Architecture & Industrial Design'
  | 'Business & Management'
  | 'Media & Visual Arts'
  | 'Chemical & Materials Engineering'
  | 'Health & Life Sciences';

export interface StudentSession {
  id: string;
  email: string;
  isVerified: boolean;
  isSchoolVerified?: boolean;
  hashedStudentId?: string;
  campus?: Campus;
  discipline?: AcademicDiscipline;
  interests: string[];
  sessionHandle: string; // e.g. "Astute Cardinal #8192"
  sessionAvatar: string; // emoji or avatar icon ID
  token: string;
  createdAt: number;
  authProvider?: 'microsoft_entra_id' | 'institutional_sso' | 'demo';
}

export interface MatchTopic {
  id: string;
  title: string;
  category: 'academics' | 'campus' | 'career' | 'stress_relief' | 'tech' | 'thesis';
  icon: string;
  description: string;
  tag: string;
}

export interface ChatMessage {
  id: string;
  senderHandle: string;
  senderAvatar: string;
  isMe: boolean;
  text: string;
  timestamp: number;
  type?: 'text' | 'icebreaker' | 'code' | 'system' | 'ai_summary' | 'study_timer';
  codeLanguage?: string;
  reactions?: Record<string, number>;
}

export interface ActivePeerInfo {
  sessionId: string;
  handle: string;
  avatar: string;
  campus?: Campus;
  discipline?: AcademicDiscipline;
  interests: string[];
  topic: string;
  matchedAt: number;
  isSimulated?: boolean;
}

export interface StudyGroupRoom {
  id: string;
  title: string;
  topic: string;
  subjectCode: string;
  membersCount: number;
  maxMembers: number;
  campus: Campus;
  activeTopicDescription: string;
  createdAt: number;
}

export interface InstitutionalAnalytics {
  activeMatchesNow: number;
  todayMatchedStudents: number;
  crossDisciplineRate: number; // e.g. 78%
  avgSessionDurationMins: number; // e.g. 11.4 mins
  satisfactionNps: number; // e.g. 56
  stressReliefRating: number; // e.g. 88%
  topSubjects: { name: string; count: number; percentage: number }[];
  campusBreakdown: { campus: Campus; activeCount: number }[];
  weeklyTrend: { day: string; sessions: number; crossMatches: number }[];
}

export interface AiIcebreakerResponse {
  icebreakers: string[];
  topicSuggestions: string[];
  encouragingNote: string;
}

export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  youtubeUrl: string;
  youtubeVideoId: string;
  category: 'lofi' | 'ambient' | 'piano' | 'synthwave' | 'chill' | 'classical' | 'custom';
  duration?: string;
  thumbnail?: string;
}
