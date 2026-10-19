import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import './tz.js';
import { createServer } from './app.js';
import { claudeExtractor } from './homework.js';

const port = Number(process.env.PORT) || 3000;
const dataDir = path.resolve(process.env.DATA_DIR || 'data');
const reminderHour = Number(process.env.REMINDER_HOUR ?? 9);
const configFile = path.join(dataDir, 'config.json');

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configFile, 'utf8'));
  } catch {
    return {};
  }
}

/** FAMILY_CODE env var, else the code saved on first run, else ask for one and save it. */
async function familyCode() {
  if (process.env.FAMILY_CODE) return process.env.FAMILY_CODE;
  const saved = readConfig().familyCode;
  if (saved) return saved;
  if (!process.stdin.isTTY) {
    console.error('FAMILY_CODE 환경 변수를 설정하세요. 예: FAMILY_CODE=우리집1234 npm start');
    process.exit(1);
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('처음 실행이네요! 가족이 앱에서 가입할 때 입력할 "가족 코드"를 정해주세요.');
  let code = '';
  while (code.length < 4) {
    code = (await rl.question('가족 코드 (4자 이상): ')).trim();
  }
  rl.close();
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify({ ...readConfig(), familyCode: code }, null, 2));
  console.log(`저장했습니다. 바꾸려면 ${configFile} 파일을 지우고 다시 실행하세요.\n`);
  return code;
}

/** Addresses of this PC on the home network, to type into the app. */
function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address);
}

const code = await familyCode();
// Cloudflare relay for calls (optional): data/config.json { "turnKeyId": "...", "turnKeyToken": "..." }
const config = readConfig();
const turn = {
  keyId: process.env.TURN_KEY_ID || config.turnKeyId,
  token: process.env.TURN_KEY_API_TOKEN || config.turnKeyToken,
};
// Homework notices in the family chat → 📚 list (optional), using Claude Code signed in on this PC:
// data/config.json { "homework": { "authors": ["mom"], "children": { "유호": "uho", "유이": "uiui" }, "assignee": "uiui",
//                                   "model": "sonnet", "effort": "medium" } }
const homework = config.homework?.authors?.length
  ? {
      authors: config.homework.authors,
      children: config.homework.children,
      assignee: config.homework.assignee,
      extract: claudeExtractor(config.homework),
    }
  : undefined;
createServer({ familyCode: code, dataDir, reminderHour, turn, homework }).listen(port, () => {
  const addresses = lanAddresses();
  console.log('========================================');
  console.log(' 가족 메신저 서버가 켜졌습니다');
  console.log('========================================');
  if (addresses.length) {
    console.log(' 휴대폰 앱의 "서버 주소"에 입력하세요:');
    for (const a of addresses) console.log(`   ${a}:${port}`);
  } else {
    console.log(` 이 PC의 IP 주소와 포트 ${port} 을(를) 앱에 입력하세요.`);
  }
  console.log(` 가족 코드: ${code}`);
  console.log(` 데이터 저장 위치: ${dataDir}`);
  console.log(` 통화 중계(Cloudflare TURN): ${turn.keyId && turn.token ? '켜짐' : '꺼짐 (같은 와이파이 등 직접 연결만)'}`);
  console.log(` 숙제 자동 등록: ${homework ? `켜짐 (${homework.authors.join(', ')} → ${Object.keys(homework.children ?? {}).join('·') || homework.assignee || '-'})` : '꺼짐'}`);
  console.log(' 이 창을 닫으면 서버가 꺼집니다.');
  console.log('========================================');
});
