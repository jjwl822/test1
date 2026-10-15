import path from 'node:path';
import { createServer } from './app.js';

const port = Number(process.env.PORT) || 3000;
const familyCode = process.env.FAMILY_CODE;
const dataDir = path.resolve(process.env.DATA_DIR || 'data');

if (!familyCode) {
  console.error('FAMILY_CODE 환경 변수를 설정하세요. 예: FAMILY_CODE=우리집1234 npm start');
  process.exit(1);
}

createServer({ familyCode, dataDir }).listen(port, () => {
  console.log(`가족 메신저 서버 실행 중: http://0.0.0.0:${port} (데이터: ${dataDir})`);
});
