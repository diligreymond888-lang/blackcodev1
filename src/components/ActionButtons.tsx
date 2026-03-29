import { ShoppingCart, ExternalLink } from 'lucide-react';

const ActionButtons = () => {
  return (
    <div className="flex justify-center">
      <a
        href="https://t.me/BlackCodeHat"
        target="_blank"
        rel="noopener noreferrer"
        className="neon-button flex items-center gap-2.5 px-8 py-3.5 rounded-xl 
                   font-display text-sm font-semibold text-foreground
                   group"
      >
        <ShoppingCart className="w-4 h-4" />
        Buy Key
        <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-50 transition-opacity" />
      </a>
    </div>
  );
};

export default ActionButtons;
