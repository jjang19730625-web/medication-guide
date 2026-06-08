require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const IS_OPENROUTER = API_KEY.startsWith('sk-or-');
const HAS_API_KEY = !!API_KEY && API_KEY !== '여기에_API_키를_입력하세요';

function getAgeGroup(age) {
  if (age <= 5)  return { label: '영유아 (보호자용)', style: '보호자분께 드리는 설명입니다. 아이가 이해할 수 있도록 매우 쉽고 따뜻한 말투로, 반드시 어른이 복용을 도와주어야 함을 강조해주세요.' };
  if (age <= 12) return { label: '어린이', style: '초등학생이 이해할 수 있는 쉬운 단어로, 친근하고 재미있게 설명해주세요. 이모지를 적절히 사용해 친근하게.' };
  if (age <= 19) return { label: '청소년', style: '중고등학생이 이해할 수 있는 말투로, 너무 어렵지 않게 하지만 정확하게 설명해주세요.' };
  if (age <= 64) return { label: '성인', style: '일반 성인 환자에게 설명하듯이, 의학 용어는 괄호 안에 쉬운 설명을 덧붙여 알기 쉽게 설명해주세요.' };
  return { label: '어르신', style: '어르신께 설명하듯이 매우 쉽고 간결하게, 가장 중요한 것 위주로만 설명해주세요.' };
}

const DEMO_DATA = {
  drugName: '타이레놀 (아세트아미노펜)',
  efficacy: '[데모] 열을 내려주고 통증을 줄여주는 약이에요. 두통, 치통, 근육통, 감기로 인한 발열에 많이 사용합니다.',
  dosage: '보통 하루 3~4회, 4~6시간 간격으로 복용합니다. 식후에 드시면 위장 자극이 줄어들어요.',
  sideEffects: ['속이 메스껍거나 소화가 안 될 수 있어요 → 식후에 복용하거나 소량의 음식과 함께 드세요', '드물게 피부에 발진이 생길 수 있어요 → 발진이 생기면 복용을 중단하고 병원에 오세요', '장기 복용 시 간에 부담이 갈 수 있어요 → 지시된 용량을 꼭 지켜주세요'],
  tips: '술을 마시는 날에는 복용을 피해주세요. 다른 감기약과 함께 먹으면 성분이 겹칠 수 있으니 약사에게 꼭 확인하세요.',
  warning: '눈이 노래지거나 소변 색이 짙어지면 즉시 병원에 오세요. 온몸에 두드러기가 나거나 숨쉬기 힘들면 응급실로 가세요.',
};

function buildPrompt(name, age, medication, ageGroup) {
  return `당신은 병동 간호사로서 환자에게 복약지도를 하고 있습니다.
환자 정보: ${name}님, ${age}세 (${ageGroup.label})
복용 약품: ${medication}

${ageGroup.style}

아래 JSON 형식으로 정확히 응답해주세요. 다른 텍스트 없이 JSON만 반환하세요:
{
  "drugName": "약품의 정식 이름 (상품명이면 성분명도 함께)",
  "efficacy": "이 약이 무엇을 하는 약인지, 어떤 증상에 쓰이는지 2~3문장으로",
  "dosage": "어떻게, 언제, 얼마나 복용하는지. 식전/식후, 복용 간격, 주의사항 포함. 3~4문장으로",
  "sideEffects": ["부작용1 → 이럴 때는 이렇게", "부작용2 → 이럴 때는 이렇게", "부작용3 → 이럴 때는 이렇게"],
  "tips": "이 약을 복용할 때 꼭 기억해야 할 팁 1~2가지",
  "warning": "즉시 병원에 와야 하는 위험 증상 1~2가지"
}`;
}

async function callAnthropic(prompt) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: API_KEY });
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });
  return msg.content[0].text.trim();
}

async function callOpenRouter(prompt) {
  const OpenAI = require('openai').default;
  const client = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: API_KEY,
    defaultHeaders: { 'HTTP-Referer': 'http://localhost:3002', 'X-Title': 'Medication Guide' },
  });
  const res = await client.chat.completions.create({
    model: 'anthropic/claude-sonnet-4-5',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });
  return res.choices[0].message.content.trim();
}

app.get('/api/status', (req, res) => {
  res.json({ hasApiKey: HAS_API_KEY, mode: IS_OPENROUTER ? 'openrouter' : 'anthropic' });
});

app.post('/api/medication', async (req, res) => {
  const { name, age, medication } = req.body;
  if (!name || !age || !medication) {
    return res.status(400).json({ error: '이름, 나이, 약품명을 모두 입력해주세요.' });
  }

  const ageGroup = getAgeGroup(parseInt(age));

  if (!HAS_API_KEY) {
    return res.json({ success: true, demo: true, name, age, ageGroup: ageGroup.label, ...DEMO_DATA });
  }

  const prompt = buildPrompt(name, age, medication, ageGroup);

  try {
    const text = IS_OPENROUTER ? await callOpenRouter(prompt) : await callAnthropic(prompt);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON 파싱 실패');
    const data = JSON.parse(jsonMatch[0]);
    res.json({ success: true, name, age, ageGroup: ageGroup.label, ...data });
  } catch (err) {
    console.error(err.message);
    const status = err.status || err.statusCode || 0;
    if (status === 402) {
      // 크레딧 부족 → 데모 데이터로 폴백하여 앱이 계속 동작하게 함
      return res.json({ success: true, demo: true, creditsEmpty: true, name, age, ageGroup: ageGroup.label, ...DEMO_DATA });
    }
    if (status === 401) {
      return res.status(401).json({ error: 'API 키가 유효하지 않습니다. .env 파일의 ANTHROPIC_API_KEY를 확인해주세요.' });
    }
    if (status === 429) {
      return res.status(429).json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' });
    }
    res.status(500).json({ error: `오류: ${err.message}` });
  }
});

// Vercel 서버리스: module.exports로 app을 내보냄
module.exports = app;

// 로컬 개발 시에만 직접 listen
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3002;
  app.listen(PORT, () => {
    const mode = !HAS_API_KEY ? '데모 모드' : IS_OPENROUTER ? 'OpenRouter 모드' : 'Anthropic 모드';
    console.log(`✅ 복약지도서 서버 실행 중: http://localhost:${PORT}  [${mode}]`);
  });
}
