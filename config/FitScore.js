const calculateFitScore = (offering, userProfile) => {
  let score = 0;
  let explanation = [];

  // 1. Risk compatibility (25%)
  const riskScore = calculateRiskScore(offering.risk, userProfile.riskTolerance);
  score += riskScore * 0.25;
  explanation.push(`Risk: ${riskScore}/100`);

  // 2. Expected return vs average (25%)
  const returnScore = calculateReturnScore(offering.returnPercentage, userProfile.averageReturn);
  score += returnScore * 0.25;
  explanation.push(`Return: ${returnScore}/100`);

  // 3. Sector overlap (20%)
  const sectorScore = calculateSectorScore(offering.sector, userProfile.preferredSectors);
  score += sectorScore * 0.20;
  explanation.push(`Sector: ${sectorScore}/100`);

  // 4. Liquidity (20%)
  const liquidityScore = calculateLiquidityScore(offering.liquidity);
  score += liquidityScore * 0.20;
  explanation.push(`Liquidity: ${liquidityScore}/100`);

  // 5. Min investment (10%)
  const investmentScore = calculateInvestmentScore(offering.minInvestment, userProfile.availableCapital);
  score += investmentScore * 0.10;
  explanation.push(`Affordability: ${investmentScore}/100`);

  return {
    score: Math.round(score),
    explanation: explanation.join(' | ')
  };
};

const calculateRiskScore = (offeringRisk, userRisk) => {
  const riskMap = { low: 1, medium: 2, high: 3 };
  const diff = Math.abs(riskMap[offeringRisk] - riskMap[userRisk]);
  if (diff === 0) return 100;
  if (diff === 1) return 60;
  return 20;
};

const calculateReturnScore = (offeringReturn, averageReturn) => {
  if (offeringReturn >= averageReturn * 1.5) return 100;
  if (offeringReturn >= averageReturn) return 80;
  if (offeringReturn >= averageReturn * 0.75) return 50;
  return 20;
};

const calculateSectorScore = (sector, preferredSectors) => {
  return preferredSectors.includes(sector) ? 100 : 40;
};

const calculateLiquidityScore = (liquidity) => {
  if (liquidity === 'high') return 100;
  if (liquidity === 'medium') return 60;
  return 30;
};

const calculateInvestmentScore = (minInvestment, availableCapital) => {
  const ratio = minInvestment / availableCapital;
  if (ratio <= 0.1) return 100;
  if (ratio <= 0.25) return 80;
  if (ratio <= 0.5) return 50;
  if (ratio <= 1) return 20;
  return 0;
};

module.exports = { calculateFitScore };