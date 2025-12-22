const pricingData = [
  { duration: '1 Day Access', price: '₱20' },
  { duration: '3 Days Access', price: '₱50' },
  { duration: '7 Days Access', price: '₱100' },
  { duration: '15 Days Access', price: '₱150' },
  { duration: 'Lifetime Access', price: '₱250' },
];

const PricingTable = () => {
  return (
    <div className="w-full max-w-md mx-auto">
      <h2 className="text-2xl font-display font-bold text-center mb-6 glow-text text-foreground">
        Price List
      </h2>
      <div className="neon-border rounded-xl overflow-hidden bg-card/30 backdrop-blur-sm">
        {pricingData.map((item, index) => (
          <div key={index} className="pricing-row">
            <span className="text-muted-foreground font-medium">{item.duration}</span>
            <span className="text-foreground font-bold font-display">{item.price}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default PricingTable;
