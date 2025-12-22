import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export const useTelegramWebhook = () => {
  useEffect(() => {
    const setupWebhook = async () => {
      const webhookSetup = localStorage.getItem("telegram_webhook_setup");
      if (webhookSetup) return;

      try {
        const { data, error } = await supabase.functions.invoke("telegram-bot", {
          body: {},
          headers: {
            "Content-Type": "application/json",
          },
        });

        // Call setup endpoint
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
