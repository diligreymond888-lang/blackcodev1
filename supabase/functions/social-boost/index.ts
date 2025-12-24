import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BASE_URL = "https://zefame-free.com/api_free.php";
const PROXY_URL = "https://zefame-free.com/tiktok_proxy.php";

// Service IDs
const SERVICES = {
  TIKTOK_VIEWS: 229,
  TIKTOK_LIKES: 232,
  TIKTOK_FOLLOWERS: 228,
  TELEGRAM_VIEWS: 248,
  FACEBOOK_SHARES: 244,
};

const HEADERS = {
  "accept": "application/json, text/javascript, */*; q=0.01",
  "accept-encoding": "gzip, deflate, br, zstd",
  "accept-language": "en-US,en;q=0.9,fil;q=0.8",
  "origin": "https://zefame.com",
  "referer": "https://zefame.com/",
  "sec-ch-ua": '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "cross-site",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36"
};

function generateDeviceId(): string {
  return crypto.randomUUID();
}

function extractVideoId(tiktokUrl: string): string | null {
  try {
    const url = new URL(tiktokUrl);
    const pathParts = url.pathname.split('/');
    
    for (let i = 0; i < pathParts.length; i++) {
      if (pathParts[i] === 'video' && i + 1 < pathParts.length) {
        return pathParts[i + 1].split('?')[0];
      }
    }
    return null;
  } catch {
    return null;
  }
}

function extractUsername(tiktokUrl: string): string | null {
  try {
    const url = new URL(tiktokUrl);
    const pathParts = url.pathname.split('/');
    
    for (const part of pathParts) {
      if (part.startsWith('@')) {
        return part.substring(1);
      }
    }
    return null;
  } catch {
    return null;
  }
}

// TikTok Video Check
async function checkVideoId(tiktokUrl: string): Promise<{ success: boolean; videoId?: string; error?: string }> {
  console.log(`[Step 1] Checking video ID for: ${tiktokUrl}`);
  
  try {
    const formData = new URLSearchParams();
    formData.append("action", "checkVideoId");
    formData.append("link", tiktokUrl);
    
    const response = await fetch(BASE_URL, {
      method: "POST",
      headers: { ...HEADERS, "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body: formData.toString(),
    });
    
    const result = await response.json();
    console.log("checkVideoId response:", JSON.stringify(result));
    
    if (result.success || result.status === 'success') {
      const videoId = result.data?.videoId || result.videoId;
      if (videoId) {
        return { success: true, videoId };
      }
    }
    
    return { success: false, error: result.message || "Failed to validate video ID" };
  } catch (error) {
    console.error("Error checking video ID:", error);
    return { success: false, error: String(error) };
  }
}

// Check service availability for video
async function checkVideoServiceAvailability(videoId: string, serviceId: number, deviceId: string): Promise<{ allowed: boolean; message?: string; timeLeft?: number }> {
  console.log(`[Step 2] Checking service availability for video ${videoId}`);
  
  try {
    const params = new URLSearchParams({
      action: "check",
      device: deviceId,
      service: serviceId.toString(),
      videoId: videoId,
    });
    
    const response = await fetch(`${BASE_URL}?${params.toString()}`, {
      method: "GET",
      headers: HEADERS,
    });
    
    const result = await response.json();
    console.log("checkVideoServiceAvailability response:", JSON.stringify(result));
    
    if (result.success || result.status === 'success') {
      const allowed = result.data?.allowed || result.available || false;
      return { allowed, message: result.message || result.data?.message };
    }
    
    // Return the actual message from the API
    const message = result.message || result.data?.message || "Service not available";
    const timeLeft = result.data?.timeLeft;
    return { allowed: false, message, timeLeft };
  } catch (error) {
    console.error("Error checking service availability:", error);
    return { allowed: false, message: String(error) };
  }
}

// Place video order (views/likes)
async function placeVideoOrder(tiktokUrl: string, videoId: string, serviceId: number, deviceId: string): Promise<{ success: boolean; orderId?: string; error?: string }> {
  console.log(`[Step 3] Placing order for video ${videoId}`);
  
  try {
    const formData = new URLSearchParams();
    formData.append("action", "order");
    formData.append("service", serviceId.toString());
    formData.append("link", tiktokUrl);
    formData.append("uuid", deviceId);
    formData.append("videoId", videoId);
    
    const response = await fetch(`${BASE_URL}?action=order`, {
      method: "POST",
      headers: { ...HEADERS, "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body: formData.toString(),
    });
    
    const result = await response.json();
    console.log("placeVideoOrder response:", JSON.stringify(result));
    
    if (result.success) {
      return { success: true, orderId: result.data?.orderId || "N/A" };
    }
    
    return { success: false, error: result.message || "Failed to place order" };
  } catch (error) {
    console.error("Error placing order:", error);
    return { success: false, error: String(error) };
  }
}

// TikTok Username Check via Proxy
async function checkUsernameProxy(username: string): Promise<{ success: boolean; nickname?: string; followers?: number; error?: string }> {
  console.log(`[Step 1] Checking username via proxy: ${username}`);
  
  try {
    const params = new URLSearchParams({ username });
    
    const response = await fetch(`${PROXY_URL}?${params.toString()}`, {
      method: "GET",
      headers: { ...HEADERS, accept: "*/*" },
    });
    
    const result = await response.json();
    console.log("checkUsernameProxy response:", JSON.stringify(result));
    
    if (result.statusCode === 0 || result.status_code === 0 || result.userInfo) {
      const userInfo = result.userInfo?.user || {};
      const stats = result.userInfo?.stats || {};
      return {
        success: true,
        nickname: userInfo.nickname || "N/A",
        followers: stats.followerCount || 0,
      };
    }
    
    return { success: false, error: result.status_msg || "Failed to validate username" };
  } catch (error) {
    console.error("Error checking username:", error);
    return { success: false, error: String(error) };
  }
}

// Check account service availability
async function checkAccountServiceAvailability(username: string, serviceId: number, deviceId: string): Promise<{ allowed: boolean; message?: string; timeLeft?: number }> {
  console.log(`[Step 2] Checking service availability for account ${username}`);
  
  try {
    const params = new URLSearchParams({
      action: "check",
      device: deviceId,
      service: serviceId.toString(),
      username: username,
    });
    
    const response = await fetch(`${BASE_URL}?${params.toString()}`, {
      method: "GET",
      headers: HEADERS,
    });
    
    const result = await response.json();
    console.log("checkAccountServiceAvailability response:", JSON.stringify(result));
    
    if (result.success || result.status === 'success') {
      const allowed = result.data?.allowed || result.available || false;
      return { allowed, message: result.message || result.data?.message };
    }
    
    // Return actual message from API (includes cooldown info)
    const message = result.message || result.data?.message || "Service not available";
    const timeLeft = result.data?.timeLeft;
    return { allowed: false, message, timeLeft };
  } catch (error) {
    console.error("Error checking account service:", error);
    return { allowed: false, message: String(error) };
  }
}

// Check generic service availability
async function checkGenericServiceAvailability(serviceId: number, deviceId: string, username?: string): Promise<{ allowed: boolean; message?: string; timeLeft?: number }> {
  console.log(`[Step 1] Checking service availability for service ${serviceId}`);
  
  try {
    const params: Record<string, string> = {
      action: "check",
      device: deviceId,
      service: serviceId.toString(),
    };
    if (username) params.username = username;
    
    const searchParams = new URLSearchParams(params);
    
    const response = await fetch(`${BASE_URL}?${searchParams.toString()}`, {
      method: "GET",
      headers: HEADERS,
    });
    
    const result = await response.json();
    console.log("checkGenericServiceAvailability response:", JSON.stringify(result));
    
    if (result.success || result.status === 'success') {
      const allowed = result.data?.allowed || result.available || false;
      return { allowed, message: result.message || result.data?.message };
    }
    
    const message = result.message || result.data?.message || "Service not available";
    const timeLeft = result.data?.timeLeft;
    return { allowed: false, message, timeLeft };
  } catch (error) {
    console.error("Error checking service:", error);
    return { allowed: false, message: String(error) };
  }
}

// Place account order (followers)
async function placeAccountOrder(tiktokUrl: string, username: string, serviceId: number, deviceId: string): Promise<{ success: boolean; orderId?: string; error?: string }> {
  console.log(`[Step 3] Placing order for account ${username}`);
  
  try {
    const formData = new URLSearchParams();
    formData.append("service", serviceId.toString());
    formData.append("link", tiktokUrl);
    formData.append("uuid", deviceId);
    formData.append("username", username);
    
    const response = await fetch(`${BASE_URL}?action=order`, {
      method: "POST",
      headers: { ...HEADERS, "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body: formData.toString(),
    });
    
    const result = await response.json();
    console.log("placeAccountOrder response:", JSON.stringify(result));
    
    if (result.success) {
      return { success: true, orderId: result.data?.orderId || "N/A" };
    }
    
    return { success: false, error: result.message || "Failed to place order" };
  } catch (error) {
    console.error("Error placing account order:", error);
    return { success: false, error: String(error) };
  }
}

// Place Telegram/Facebook order
async function placeGenericOrder(url: string, serviceId: number, deviceId: string, username?: string): Promise<{ success: boolean; orderId?: string; error?: string }> {
  console.log(`[Step 2] Placing order for service ${serviceId}`);
  
  try {
    const formData = new URLSearchParams();
    formData.append("action", "order");
    formData.append("service", serviceId.toString());
    formData.append("link", url);
    formData.append("uuid", deviceId);
    if (username) formData.append("username", username);
    
    const response = await fetch(`${BASE_URL}?action=order`, {
      method: "POST",
      headers: { ...HEADERS, "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body: formData.toString(),
    });
    
    const result = await response.json();
    console.log("placeGenericOrder response:", JSON.stringify(result));
    
    if (result.success) {
      return { success: true, orderId: result.data?.orderId || "N/A" };
    }
    
    return { success: false, error: result.message || "Failed to place order" };
  } catch (error) {
    console.error("Error placing order:", error);
    return { success: false, error: String(error) };
  }
}

// Main boost functions - Helper to format time
function formatTimeLeft(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

// Translate French error messages to English
function translateMessage(message: string): string {
  const translations: Record<string, string> = {
    "Vous avez déjà utilisé ce service": "You have already used this service",
    "Attendez encore": "Wait another",
    "Service non disponible": "Service not available",
    "Erreur": "Error",
    "Veuillez réessayer": "Please try again",
    "Lien invalide": "Invalid link",
    "Utilisateur non trouvé": "User not found",
    "Vidéo non trouvée": "Video not found",
  };
  
  let translated = message;
  for (const [french, english] of Object.entries(translations)) {
    translated = translated.replace(new RegExp(french, 'gi'), english);
  }
  
  // Clean up time format (23h 19min -> 23h 19m)
  translated = translated.replace(/(\d+)h\s*(\d+)min/g, '$1h $2m');
  
  return translated;
}

async function boostTikTokViews(tiktokUrl: string): Promise<{ success: boolean; message: string; orderId?: string }> {
  const deviceId = generateDeviceId();
  
  // Step 1: Check video ID
  const videoCheck = await checkVideoId(tiktokUrl);
  if (!videoCheck.success || !videoCheck.videoId) {
    return { success: false, message: translateMessage(`Video check failed: ${videoCheck.error}`) };
  }
  
  // Step 2: Check service availability
  const availability = await checkVideoServiceAvailability(videoCheck.videoId, SERVICES.TIKTOK_VIEWS, deviceId);
  if (!availability.allowed) {
    const cooldown = availability.timeLeft ? ` (Wait ${formatTimeLeft(availability.timeLeft)})` : '';
    return { success: false, message: `Service unavailable${cooldown}: ${translateMessage(availability.message || 'Try again later')}` };
  }
  
  // Step 3: Place order
  const order = await placeVideoOrder(tiktokUrl, videoCheck.videoId, SERVICES.TIKTOK_VIEWS, deviceId);
  if (!order.success) {
    return { success: false, message: translateMessage(`Order failed: ${order.error}`) };
  }
  
  return { success: true, message: "TikTok Views boost order placed successfully!", orderId: order.orderId };
}

async function boostTikTokLikes(tiktokUrl: string): Promise<{ success: boolean; message: string; orderId?: string }> {
  const deviceId = generateDeviceId();
  
  const videoCheck = await checkVideoId(tiktokUrl);
  if (!videoCheck.success || !videoCheck.videoId) {
    return { success: false, message: translateMessage(`Video check failed: ${videoCheck.error}`) };
  }
  
  const availability = await checkVideoServiceAvailability(videoCheck.videoId, SERVICES.TIKTOK_LIKES, deviceId);
  if (!availability.allowed) {
    const cooldown = availability.timeLeft ? ` (Wait ${formatTimeLeft(availability.timeLeft)})` : '';
    return { success: false, message: `Service unavailable${cooldown}: ${translateMessage(availability.message || 'Try again later')}` };
  }
  
  const order = await placeVideoOrder(tiktokUrl, videoCheck.videoId, SERVICES.TIKTOK_LIKES, deviceId);
  if (!order.success) {
    return { success: false, message: translateMessage(`Order failed: ${order.error}`) };
  }
  
  return { success: true, message: "TikTok Likes boost order placed successfully!", orderId: order.orderId };
}

async function boostTikTokFollowers(tiktokUrl: string): Promise<{ success: boolean; message: string; orderId?: string; userInfo?: { nickname: string; followers: number } }> {
  const deviceId = generateDeviceId();
  
  const username = extractUsername(tiktokUrl);
  if (!username) {
    return { success: false, message: "Could not extract username from URL. Use format: tiktok.com/@username" };
  }
  
  // Step 1: Check username
  const userCheck = await checkUsernameProxy(username);
  if (!userCheck.success) {
    return { success: false, message: translateMessage(`User check failed: ${userCheck.error}`) };
  }
  
  // Step 2: Check service availability
  const availability = await checkAccountServiceAvailability(username, SERVICES.TIKTOK_FOLLOWERS, deviceId);
  if (!availability.allowed) {
    const cooldown = availability.timeLeft ? ` (Wait ${formatTimeLeft(availability.timeLeft)})` : '';
    return { 
      success: false, 
      message: `Service unavailable${cooldown}: ${translateMessage(availability.message || 'Try again later')}`,
      userInfo: { nickname: userCheck.nickname || "", followers: userCheck.followers || 0 }
    };
  }
  
  // Step 3: Place order
  const order = await placeAccountOrder(tiktokUrl, username, SERVICES.TIKTOK_FOLLOWERS, deviceId);
  if (!order.success) {
    return { success: false, message: translateMessage(`Order failed: ${order.error}`) };
  }
  
  return { 
    success: true, 
    message: "TikTok Followers boost order placed successfully!", 
    orderId: order.orderId,
    userInfo: { nickname: userCheck.nickname || "", followers: userCheck.followers || 0 }
  };
}

async function boostTelegramViews(telegramUrl: string): Promise<{ success: boolean; message: string; orderId?: string }> {
  const deviceId = generateDeviceId();
  
  const availability = await checkGenericServiceAvailability(SERVICES.TELEGRAM_VIEWS, deviceId);
  if (!availability.allowed) {
    const cooldown = availability.timeLeft ? ` (Wait ${formatTimeLeft(availability.timeLeft)})` : '';
    return { success: false, message: `Service unavailable${cooldown}: ${translateMessage(availability.message || 'Try again later')}` };
  }
  
  const order = await placeGenericOrder(telegramUrl, SERVICES.TELEGRAM_VIEWS, deviceId);
  if (!order.success) {
    return { success: false, message: translateMessage(`Order failed: ${order.error}`) };
  }
  
  return { success: true, message: "Telegram Views boost order placed successfully!", orderId: order.orderId };
}

async function boostFacebookShares(facebookUrl: string): Promise<{ success: boolean; message: string; orderId?: string }> {
  const deviceId = generateDeviceId();
  
  const availability = await checkGenericServiceAvailability(SERVICES.FACEBOOK_SHARES, deviceId, "share");
  if (!availability.allowed) {
    const cooldown = availability.timeLeft ? ` (Wait ${formatTimeLeft(availability.timeLeft)})` : '';
    return { success: false, message: `Service unavailable${cooldown}: ${translateMessage(availability.message || 'Try again later')}` };
  }
  
  const order = await placeGenericOrder(facebookUrl, SERVICES.FACEBOOK_SHARES, deviceId, "share");
  if (!order.success) {
    return { success: false, message: `Order failed: ${order.error}` };
  }
  
  return { success: true, message: "Facebook Shares boost order placed successfully!", orderId: order.orderId };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, url } = await req.json();
    
    console.log(`Boost request: action=${action}, url=${url}`);
    
    if (!action || !url) {
      return new Response(JSON.stringify({ success: false, error: "Missing action or url" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let result;
    
    switch (action) {
      case "tiktok_views":
        if (!url.includes("tiktok.com")) {
          return new Response(JSON.stringify({ success: false, error: "Invalid TikTok URL" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        result = await boostTikTokViews(url);
        break;
        
      case "tiktok_likes":
        if (!url.includes("tiktok.com")) {
          return new Response(JSON.stringify({ success: false, error: "Invalid TikTok URL" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        result = await boostTikTokLikes(url);
        break;
        
      case "tiktok_followers":
        if (!url.includes("tiktok.com")) {
          return new Response(JSON.stringify({ success: false, error: "Invalid TikTok URL" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        result = await boostTikTokFollowers(url);
        break;
        
      case "telegram_views":
        if (!url.includes("t.me") && !url.includes("telegram.me")) {
          return new Response(JSON.stringify({ success: false, error: "Invalid Telegram URL" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        result = await boostTelegramViews(url);
        break;
        
      case "facebook_shares":
        if (!url.includes("facebook.com")) {
          return new Response(JSON.stringify({ success: false, error: "Invalid Facebook URL" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        result = await boostFacebookShares(url);
        break;
        
      default:
        return new Response(JSON.stringify({ 
          success: false, 
          error: "Invalid action. Use: tiktok_views, tiktok_likes, tiktok_followers, telegram_views, facebook_shares" 
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ success: false, error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
