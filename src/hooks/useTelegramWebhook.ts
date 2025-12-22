import { useEffect } from "react";

export const useTelegramWebhook = () => {
  useEffect(() => {
    const setupWebhook = async () => {
      const webhookSetup = localStorage.getItem("telegram_webhook_setup");
      if (webhookSetup) return;

      try {
        // Call setup endpoint directly
        const response = await fetch(
          `https://fokxdpkpdtwfhtpjrvdc.supabase.co/functions/v1/telegram-bot?setup=true`
        );
        const result = await response.json();
        
        if (result.ok) {
          localStorage.setItem("telegram_webhook_setup", "true");
          console.log("Telegram webhook setup successful");
        }
      } catch (error) {
        console.error("Telegram webhook setup error:", error);
      }
    };

    setupWebhook();
  }, []);
};
