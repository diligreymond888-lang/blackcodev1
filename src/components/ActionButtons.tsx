import { Send, Users, ShoppingCart } from 'lucide-react';

const actions = [
  {
    label: 'Telegram Channel',
    href: 'https://t.me/channelniyato',
    icon: Send,
  },
  {
    label: 'Telegram Group',
    href: 'https://t.me/lapaganngsalitaniyato',
    icon: Users,
  },
  {
    label: 'Buy Key',
    href: 'https://t.me/egoistyato',
    icon: ShoppingCart,
  },
];

const ActionButtons = () => {
  return (
    <div className="flex flex-wrap justify-center gap-4">
      {actions.map((action, index) => (
        <a
          key={index}
          href={action.href}
          target="_blank"
          rel="noopener noreferrer"
          className="neon-button flex items-center gap-2 px-6 py-3 rounded-lg 
                     font-display text-sm font-medium text-foreground
                     hover:scale-105 active:scale-95 transition-transform"
        >
          <action.icon className="w-4 h-4" />
          {action.label}
        </a>
      ))}
    </div>
  );
};

export default ActionButtons;
