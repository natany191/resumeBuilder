import { GoogleGenerativeAI } from '@google/generative-ai';
import { useAppStore } from '../store/useAppStore';

const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
console.log('API Key loaded:', apiKey ? 'Yes' : 'No');
if (!apiKey) throw new Error('VITE_GEMINI_API_KEY is not set in environment variables');

const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

// ---------------- Language detection ----------------
const detectLanguage = (text: string): 'he' | 'en' =>
  /[֐-׿]/.test(text) ? 'he' : 'en';

// ---------------- Types ----------------
interface RawAIResumeData {
  operation?: string;
  experience?: any;
  skills?: string[];
  removeSkills?: string[];
  removeExperiences?: string[];
  clearSections?: string[];
  summary?: string;
  completeResume?: any;
}

interface NormalizedResumePatch {
  operation: 'patch' | 'replace' | 'reset';
  experience?: {
    id?: string;
    company?: string;
    title?: string;
    duration?: string;
    description?: string[];
  };
  skills?: string[];
  removeSkills?: string[];
  removeExperiences?: string[];
  clearSections?: string[];
  summary?: string;
  completeResume?: any;
}

// ---------------- Parsing helpers ----------------
const safeJsonParse = (raw: string): any | null => {
  try {
    return JSON.parse(raw);
  } catch {
    const cleaned = raw
      .replace(/^[\s`]+|[\s`]+$/g, '')
      .replace(/[“”]/g, '"')
      .replace(/,\s*([}\]])/g, '$1');
    try { return JSON.parse(cleaned); } catch { return null; }
  }
};

const extractJsonBlock = (text: string): { data: any | null; error?: string } => {
  // 1. Full tagged block
  const pair = text.match(/\[RESUME_DATA\]([\s\S]*?)\[\/RESUME_DATA\]/i);
  if (pair) {
    const parsed = safeJsonParse(pair[1].trim());
    return { data: parsed, error: parsed ? undefined : 'Tagged JSON not parseable' };
  }

  // 2. Opening tag only -> attempt to find balanced braces after it
  const openIdx = text.search(/\[RESUME_DATA\]/i);
  if (openIdx !== -1) {
    const after = text.slice(openIdx + '[RESUME_DATA]'.length);
    const braceStart = after.indexOf('{');
    if (braceStart !== -1) {
      let depth = 0;
      for (let i = braceStart; i < after.length; i++) {
        if (after[i] === '{') depth++;
        else if (after[i] === '}') {
          depth--;
          if (depth === 0) {
            const candidate = after.slice(braceStart, i + 1);
            const parsed = safeJsonParse(candidate);
            if (parsed) return { data: parsed, error: 'Missing closing tag, recovered JSON' };
            break;
          }
        }
      }
    }
    return { data: null, error: 'Opening tag without JSON' };
  }

  // 3. Fenced block
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    const parsed = safeJsonParse(fence[1].trim());
    return { data: parsed, error: parsed ? undefined : 'Fenced JSON not parseable' };
  }

  // 4. First top-level object fallback
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    const parsed = safeJsonParse(braceMatch[0]);
    if (parsed) return { data: parsed, error: 'Used untagged JSON fallback' };
  }

  return { data: null, error: 'No JSON found' };
};

const normalizeResumeData = (raw: RawAIResumeData): NormalizedResumePatch => {
  const patch: NormalizedResumePatch = {
    operation: raw.operation === 'replace' || raw.operation === 'reset'
      ? raw.operation
      : 'patch'
  };

  // Experience normalization: accept "experience", "experiences" or nested forms
  let expSource: any = raw.experience ?? null;

  // If top-level object contains work/education keys, try to find them
  if (!expSource && raw && typeof raw === 'object') {
    const possibleContainers = ['experience', 'experiences', 'work', 'education', 'job', 'role', 'position'];
    for (const key of possibleContainers) {
      if ((raw as any)[key]) {
        expSource = (raw as any)[key];
        break;
      }
    }
  }

  if (Array.isArray(expSource)) expSource = expSource[0];

  if (expSource && typeof expSource === 'object') {
    // If the object itself wraps an array under common nested keys, unwrap
    const nestedKey = ['education', 'work', 'job', 'role', 'position', 'experiences', 'experience']
      .find(k => expSource[k]);
    if (nestedKey) {
      expSource = expSource[nestedKey];
      if (Array.isArray(expSource)) expSource = expSource[0];
    }

    if (expSource && typeof expSource === 'object') {
      // Normalize description to array (accept string or array)
      let desc: string[] = [];
      if (Array.isArray(expSource.description)) desc = expSource.description;
      else if (typeof expSource.description === 'string') {
        // split lines / bullets / semicolons / commas, keep non-empty
        desc = expSource.description
          .split(/[\r\n•;,-]{1,}/)
          .map((s: string) => s.trim())
          .filter(Boolean);
      }

      patch.experience = {
        id: expSource.id,
        company: (expSource.company || expSource.companyName || expSource.employer || '').trim(),
        title: (expSource.title || expSource.position || '').trim(),
        duration: expSource.duration || expSource.period || undefined,
        description: Array.isArray(desc) ? desc : []
      };
    }
  }

  if (Array.isArray(raw.skills)) patch.skills = raw.skills;
  if (Array.isArray(raw.removeSkills)) patch.removeSkills = raw.removeSkills;
  if (Array.isArray(raw.removeExperiences)) patch.removeExperiences = raw.removeExperiences;
  if (Array.isArray(raw.clearSections)) patch.clearSections = raw.clearSections;
  if (typeof raw.summary === 'string') patch.summary = raw.summary;
  if (raw.operation === 'replace' && raw.completeResume) {
    patch.completeResume = raw.completeResume;
  }

  return patch;
};

// ---------------- Apply patch to Zustand store ----------------
export const applyResumePatch = (patch: NormalizedResumePatch) => {
  const {
    addOrUpdateExperience,
    addSkills,
    removeSkills,
    replaceEntireResume,
    resetResume,
    removeExperience,
    clearAllExperiences,
    clearAllSkills,
    setSummary,
    clearSummary
  } = useAppStore.getState();

  console.log('Applying resume patch:', patch);

  // Operation-level
  if (patch.operation === 'reset') {
    resetResume();
    return;
  }

  if (patch.operation === 'replace' && patch.completeResume) {
    replaceEntireResume({
      experiences: patch.completeResume.experiences || [],
      skills: patch.completeResume.skills || [],
      summary: patch.completeResume.summary || ''
    });
    return;
  }

  // Clears
  if (patch.clearSections?.includes('experiences')) clearAllExperiences();
  if (patch.clearSections?.includes('skills')) clearAllSkills();
  if (patch.clearSections?.includes('summary')) clearSummary();

  // Experience add/update
  if (patch.experience?.company) {
    addOrUpdateExperience({
      id: patch.experience.id,
      company: patch.experience.company,
      title: patch.experience.title || '',
      duration: patch.experience.duration || '',
      description: patch.experience.description || []
    });
  }

  // Remove experiences
  patch.removeExperiences?.forEach(key => removeExperience(key));

  // Skills
  if (patch.skills && patch.skills.length) addSkills(patch.skills);
  if (patch.removeSkills && patch.removeSkills.length) removeSkills(patch.removeSkills);

  // Summary
  if (typeof patch.summary === 'string' && patch.summary.trim()) {
    setSummary(patch.summary.trim());
  }
};

// ---------------- Prompt builder ----------------
type Experience = { company: string; title?: string; duration?: string; description?: string[] };
type Resume = { experiences?: Experience[]; skills?: string[]; summary?: string };

const getSystemPrompt = (
  language: string,
  userContext: any,
  resume: Resume,
  chatMessages?: any[]
) => {
  const currentExperiences: Experience[] = resume?.experiences || [];
  const currentSkills: string[] = resume?.skills || [];
  const currentSummary: string = resume?.summary || '';
  const targetJobPosting: string = userContext?.targetJobPosting || '';

  let conversationMemory = '';

  if (chatMessages?.length) {
    const aiQ = chatMessages.filter(m => m.type === 'ai').slice(-12).map(m => m.content);
    const userA = chatMessages.filter(m => m.type === 'user').slice(-12).map(m => m.content);
    conversationMemory = language === 'he'
      ? `זיכרון שיחה:
שאלות AI: ${aiQ.join(' | ')}
תשובות משתמש: ${userA.join(' | ')}`
      : `CONVERSATION MEMORY:
AI questions: ${aiQ.join(' | ')}
User answers: ${userA.join(' | ')}`;
  }

  const baseEnglish = `You are a decisive resume-building assistant. ALWAYS output a [RESUME_DATA] block (even if only one field changes).
Current resume:
Experiences(${currentExperiences.length}): ${currentExperiences.map(e => e.company + (e.title ? `(${e.title})` : '')).join(', ')}
Skills: ${currentSkills.join(', ')}
Summary: ${currentSummary || '(empty)'}
User: ${userContext?.fullName || 'User'} (${userContext?.currentRole || 'role unknown'})`;

  const baseHebrew = `אתה עוזר לבניית קורות חיים. תמיד החזר בלוק [RESUME_DATA] (גם אם שדה יחיד משתנה).
קורות חיים נוכחיים:
ניסיון (${currentExperiences.length}): ${currentExperiences.map(e => e.company + (e.title ? `(${e.title})` : '')).join(', ')}
כישורים: ${currentSkills.join(', ')}
תקציר: ${currentSummary || '(ריק)'}
משתמש: ${userContext?.fullName || 'משתמש'} (${userContext?.currentRole || 'תפקיד לא ידוע'})`;

  const jobContext = targetJobPosting
    ? (language === 'he'
        ? `התאם את הכל למשרה:\n${targetJobPosting}`
        : `Tailor everything to this job posting:\n${targetJobPosting}`)
    : '';

  const rulesEn = `
RESPONSE RULES:
- <= 6 lines narrative before the data block.
- Ask ONE clarifying question if needed.
- ALWAYS include [RESUME_DATA] with operation ("patch" unless full replacement or reset).
- Provide only changed fields.
- DO NOT mention the exact target role title or company names from the job posting inside the summary or bullet descriptions. Keep content role-agnostic. Company names only appear in the structured "company" field.

FORMAT EXAMPLE:
[RESUME_DATA]
{
  "operation": "patch",
  "experience": {
    "company": "Harvard University",
    "title": "BSc in Computer Science",
    "duration": "2021-2025",
    "description": ["Built CNN project achieving 99% MNIST accuracy"]
  },
  "skills": ["Deep Learning","CNN"],
  "summary": "Computer science graduate focused on ML."
}
[/RESUME_DATA]`;

  const rulesHe = `
כללי תגובה:
- עד 6 שורות טקסט לפני בלוק הנתונים.
- שאלה אחת בלבד.
- תמיד [RESUME_DATA] עם operation ("patch" אלא אם החלפה מלאה או reset).
- החזר רק שדות שעודכנו.

דוגמה:
[RESUME_DATA]
{
  "operation": "patch",
  "experience": {
    "company": "Harvard University",
    "title": "BSc in Computer Science",
    "duration": "2021-2025",
    "description": ["בניית פרויקט CNN עם 99% דיוק MNIST"]
  },
  "skills": ["Deep Learning","CNN"]
}
[/RESUME_DATA]`;

  return language === 'he'
    ? `${baseHebrew}\n${conversationMemory}\n${jobContext}\n${rulesHe}`
    : `${baseEnglish}\n${conversationMemory}\n${jobContext}\n${rulesEn}`;
};

// ---------------- Public API ----------------
export const sendMessageToAI = async (
  message: string,
  userContext?: any,
  resumeData?: Resume,
  chatMessages?: any[]
) => {
  console.log('sendMessageToAI called with:', { message, userContext, resumeData, chatMessages });

  try {
    const lang = detectLanguage(message);
    console.log('Detected language:', lang);
    const systemPrompt = getSystemPrompt(lang, userContext, resumeData || {}, chatMessages);

    const fullPrompt = `${systemPrompt}

User message: "${message}"

Remember: ALWAYS include [RESUME_DATA] even for single-field updates.`;

    const result = await model.generateContent(fullPrompt);
    const response = await result.response;
    const text = response.text();

    console.log('Raw AI text:', text);

    let conversationMessage = text.trim();
    let resumeUpdates: NormalizedResumePatch | undefined;

    const { data: parsedData, error: parseError } = extractJsonBlock(text);
    if (parseError) console.warn('Resume parse note:', parseError);

    if (parsedData) {
      console.log('Raw parsed JSON:', parsedData);
      resumeUpdates = normalizeResumeData(parsedData);
      conversationMessage = conversationMessage
        .replace(/\[RESUME_DATA\][\s\S]*?\[\/RESUME_DATA\]/i, '')
        .replace(/```(?:json)?[\s\S]*?```/i, '')
        .trim();
      applyResumePatch(resumeUpdates);
    } else {
      console.warn('No parsable resume block found.', parseError);
    }

    return { message: conversationMessage, resumeUpdates: resumeUpdates || {} };
  } catch (error) {
    console.error('AI error:', error);
    return {
      message: error instanceof Error ? `API Error: ${error.message}` : 'Unknown API error.',
      resumeUpdates: {}
    };
  }
};

