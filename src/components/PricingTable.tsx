import { Crown, Sparkles } from 'lucide-react';

const pricingData = [
  { duration: '1 Day Access', price: '₱40', popular: false },
  { duration: '3 Days Access', price: '₱100', popular: false },
  { duration: '7 Days Access', price: '₱200', popular: true },
  { duration: '15 Days Access', price: '₱350', popular: false },
  { duration: 'Lifetime Access', price: '₱450', popular: false, premium: true },
];

const PricingTable = () => {
  return (
    <div className="w-full max-w-md mx-auto">
      <h2 className="text-xl sm:text-2xl font-display font-bold text-center mb-6 glow-text text-foreground tracking-wide">
        Price List
      </h2>
      <div className="neon-border rounded-2xl overflow-hidden glass-panel">
        {pricingData.map((item, index) => (
          <div key={index} className={`pricing-row ${item.popular ? 'bg-primary/5' : ''}`}>
            <div className="flex items-center gap-2">
              {item.premium && <Crown className="w-3.5 h-3.5 text-warning" />}
              <span className="text-muted-foreground font-medium text-sm">{item.duration}</span>
              {item.popular && (
                <span className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-semibold uppercase tracking-wider">
                  <Sparkles className="w-2.5 h-2.5" />
                  Popular
                </span>
              )}
            </div>
            <span className="text-foreground font-bold font-display text-sm">{item.price}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default PricingTable;
