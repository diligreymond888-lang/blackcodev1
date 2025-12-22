import { ShoppingCart } from 'lucide-react';

const ActionButtons = () => {
  return (
    <div className="flex justify-center">
      <a
        href="https://t.me/egoistyato"
        target="_blank"
        rel="noopener noreferrer"
        className="neon-button flex items-center gap-2 px-8 py-3 rounded-lg 
                   font-display text-sm font-medium text-foreground
                   hover:scale-105 active:scale-95 transition-transform"
      >
        <ShoppingCart className="w-4 h-4" />
        Buy Key
      </a>
    </div>
  );
};

export default ActionButtons;
